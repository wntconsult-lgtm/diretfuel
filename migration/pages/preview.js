import { config } from './config.mjs';
import { createAccess } from './auth.mjs';
import { createMigration, inspectBackup, MAX_BACKUP_BYTES } from './import.mjs';

const $ = id => document.getElementById(id);
let access, migration, selectedBackup, importVersion;
let importBusy=false;
function showLogin(message = '') {
  $('status').hidden = true; $('login').hidden = false;
  selectedBackup=null; $('backup-file').value=''; $('backup-confirm').checked=false;
  $('message').textContent = message; $('password').value = '';
}
function showStatus(data) {
  $('identity').textContent = `${data.user.name || data.user.email} · ${data.user.profile}`;
  $('records').textContent = (data.collections || []).reduce((sum, row) => sum + Number(row.records || 0), 0).toLocaleString('pt-BR');
  $('documents').textContent = Number(data.documents || 0).toLocaleString('pt-BR');
  $('backups').textContent = Number(data.backups || 0).toLocaleString('pt-BR');
  $('revision').textContent = `Dados v${data.revision || 0}`;
  $('checked').textContent = `Conexão verificada em ${new Date(data.checkedAt).toLocaleString('pt-BR')}.`;
  $('status-message').textContent = ''; $('login').hidden = true; $('status').hidden = false;
  $('migration').hidden=!data.user.isOwner;
  if(data.user.isOwner)checkImport().catch(error=>{$('import-message').textContent=error.message;});
}
async function checkImport() {
  if (importBusy) return;
  $('backup-file').disabled=true; $('backup-confirm').disabled=true; $('import-backup').disabled=true;
  const info=await migration('GET'); importVersion=info.version;
  $('backup-file').disabled=!info.canImport; $('backup-confirm').disabled=!info.canImport;
  $('import-message').textContent=info.canImport?'Selecione o backup geral para visualizar a quantidade de registros.':'A cópia já possui dados. A importação inicial está bloqueada para preservar a base.';
  updateImportButton();
}
function updateImportButton() {
  $('import-backup').disabled=importBusy || $('backup-file').disabled || !selectedBackup || !$('backup-confirm').checked;
}
async function start() {
  if (!window.supabase?.createClient) {
    showLogin('Não foi possível carregar o acesso. Recarregue a página.'); $('submit').disabled = true; return;
  }
  const client = window.supabase.createClient(config.url, config.publicKey, {
    auth: { storage: sessionStorage, storageKey: 'directfuel-migration-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  access = createAccess(client, config.url, config.publicKey);
  migration = createMigration(client, config.url, config.publicKey);
  $('backup-file').addEventListener('change',async()=>{
    selectedBackup=null; $('backup-confirm').checked=false; updateImportButton();
    const file=$('backup-file').files[0]; if (!file) return;
    try {
      if (file.size>MAX_BACKUP_BYTES) throw new Error('O backup excedeu o limite de envio.');
      const inspected=inspectBackup(await file.text());
      if ($('backup-file').files[0]!==file || $('status').hidden) return;
      selectedBackup=inspected.backup;
      $('backup-summary').textContent=`${inspected.total.toLocaleString('pt-BR')} registros em ${inspected.collections.length} coleções. PDFs e XMLs não estão incluídos.`;
      $('import-message').textContent='Confira o arquivo e confirme a importação.';
    } catch(error) { $('backup-summary').textContent=''; $('import-message').textContent=error.message; }
    updateImportButton();
  });
  $('backup-confirm').addEventListener('change',updateImportButton);
  $('import-backup').addEventListener('click',async()=>{
    if (!selectedBackup || !$('backup-confirm').checked || importBusy) return;
    importBusy=true; updateImportButton(); $('backup-file').disabled=true; $('backup-confirm').disabled=true; $('logout').disabled=true; $('refresh').disabled=true;
    $('import-message').textContent='Importando e validando o backup… Aguarde.';
    try {
      await migration('POST',{version:importVersion,backup:selectedBackup});
      selectedBackup=null; $('backup-file').value=''; $('backup-confirm').checked=false; $('backup-summary').textContent='';
      showStatus(await access.status());
      $('import-message').textContent='Registros importados e backup validado. Continue usando o sistema atual até a conclusão dos módulos.';
    } catch(error) {
      $('import-message').textContent=error.message+' Atualize a situação para verificar o resultado antes de tentar novamente.';
    } finally {
      importBusy=false; $('logout').disabled=false; $('refresh').disabled=false; updateImportButton();
    }
  });
  const clearStorage = () => sessionStorage.removeItem('directfuel-migration-auth');
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('submit').disabled = true; $('message').textContent = 'Verificando acesso…';
    try { await client.auth.startAutoRefresh(); showStatus(await access.login($('email').value, $('password').value)); $('password').value = ''; }
    catch (error) { showLogin(error.message); }
    finally { $('submit').disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    try { await access.logout(); } finally { clearStorage(); showLogin(); $('email').focus(); }
  });
  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;
    try { showStatus(await access.status()); }
    catch (error) {
      if ([401,403].includes(error.status)) { await access.logout(); clearStorage(); showLogin(error.message); }
      else $('status-message').textContent = error.message;
    } finally { $('refresh').disabled = false; }
  });
  try { const { data } = await client.auth.getSession(); if (data.session) showStatus(await access.status()); else showLogin(); }
  catch (error) {
    if ([401,403].includes(error.status)) { await access.logout(); clearStorage(); }
    showLogin(error.message);
  }
}
start().catch(() => showLogin('Acesso indisponível. Recarregue a página.'));
