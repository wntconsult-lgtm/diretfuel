import { config } from './config.mjs';
import { createAccess } from './auth.mjs';

const $ = id => document.getElementById(id);
let access;
function showLogin(message = '') {
  $('status').hidden = true; $('login').hidden = false;
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
}
async function start() {
  if (!window.supabase?.createClient) {
    showLogin('Não foi possível carregar o acesso. Recarregue a página.'); $('submit').disabled = true; return;
  }
  const client = window.supabase.createClient(config.url, config.publicKey, {
    auth: { storage: sessionStorage, storageKey: 'directfuel-migration-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  access = createAccess(client, config.url, config.publicKey);
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
