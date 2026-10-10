import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), output=new URL('../dist/pages-preview/app/',import.meta.url);
await mkdir(output,{recursive:true});
const version=(await readFile(new URL('lib/directfuel-version.ts',root),'utf8')).match(/APP_VERSION\s*=\s*["']([^"']+)/)?.[1];
if(!version)throw Error('Versão do sistema ausente.');
for(const name of ['index.html','migration.css','app-start.mjs']){
 let content=await readFile(new URL(`migration/app/${name}`,root),'utf8');
 if(name==='index.html')content=content.replaceAll('231',version);
 await writeFile(new URL(name,output),content);
}
for(const name of ['config.mjs','gateway.mjs'])await copyFile(new URL(`migration/pages/${name}`,root),new URL(name,output));
for(const name of ['logo-vixpar.png','favicon.svg','directfuel-styles.css','directfuel-dashboard-v2.css','directfuel-price-saving.css','directfuel-geo.css','gekon-xlsx.js'])await copyFile(new URL(`public/${name}`,root),new URL(name,output));
const modules=['state-delta','import-rules','app','online','enhancements','reports-calculator','rc-sap','enterprise','enterprise-v2','enterprise-v3','security','dashboard-financial','dashboard-v2','access-control','access-log','geo','danfe-parser','layout-engine','reconciliation','invoices','layouts','sap-return','sap-return-ui','accounting-report','ticketlog','volume','storage-ui','completed-documents'];
for(const name of modules){
 let text=await readFile(new URL(`public/directfuel-${name}.js`,root),'utf8');
 if(name==='app'){
  const from=text.indexOf('const seed='),to=text.indexOf('\nlet db=load();');
  if(from<0||to<0)throw Error('Não foi possível remover os dados de demonstração.');
  const seed=vm.runInNewContext(text.slice(from,to)+'\nseed;',{}, {timeout:1000});
  for(const key of Object.keys(seed))if(Array.isArray(seed[key]))seed[key]=[];
  text=text.slice(0,from)+'const seed='+JSON.stringify(seed)+';'+text.slice(to);
 }
 if(name==='storage-ui'){
  text=text.replace('Um backup será criado antes da operação.','Um backup da base será criado e validado antes da operação. A exclusão de PDFs/XMLs é definitiva: o backup JSON não recupera esses arquivos.');
  text=text.replace('alert(`Concluído: ${done.notes} NF(s) tratadas e ${done.removedDocuments} documento(s) removidos.`);',"alert(`Concluído: ${done.notes} NF(s) tratadas e ${done.removedDocuments} documento(s) removidos.${done.cleanupPending ? ' '+done.cleanupPending+' limpeza(s) física(s) pendente(s); retome em Documentos.' : ''}`);");
  text=text.replace('atendem à política salva. Economia estimada:',"atendem à política salva. ${preview.missingDocuments ? esc(preview.missingDocuments)+' referência(s) sem arquivo migrado serão preservadas. ' : ''}Economia estimada:");
 }
 if(name==='geo'){
  text=text.replace('function scheduleAutomaticRoutes() {','function scheduleAutomaticRoutes() { if(!geo.data?.capabilities?.routing)return; if(geo.data.capabilities.manualOnly)return;');
  text=text.replace('geo.data = payload;','geo.data = payload; window.DIRECTFUEL_GEO_CAPABILITIES=payload.capabilities||{}; window.DIRECTFUEL_GEO_USAGE=payload.providerUsage;');
  text=text.replace('async function openSameRoadAnalysis(stationCode) {',"async function openSameRoadAnalysis(stationCode) { return toast('A identificação detalhada da rodovia ainda está em adaptação. Use as distâncias rodoviárias e a revisão manual dos postos.');");
  for(const declaration of ['async function geocodeForm() {','async function geocodeTicketlogStation(button) {','async function geocodeAllTicketlogStations() {','async function geocodeAllDirectFuelStations() {'])text=text.replace(declaration,declaration+" if(!geo.data?.capabilities?.geocoding||!geo.data.canManage)return toast('O proprietário precisa configurar a chave Geoapify e liberar a permissão de edição geográfica.');");
  text=text.replace('async function calculateRoutes(retryErrors = false) {',"async function calculateRoutes(retryErrors = false) { if(!geo.data?.capabilities?.routing||!geo.data.canManage)return toast('O proprietário precisa configurar a chave Geoapify e liberar a permissão de edição geográfica.');");
  text=text.replace('["Indicador", "Valor"],','["Indicador", "Valor"], ["Fonte de rotas e coordenadas", "Geoapify / OpenStreetMap — https://www.geoapify.com/ — https://www.openstreetmap.org/copyright"],');
  // Bulk updates must not silently replace station coordinates with a city/street centroid.
  const bulkStart=text.indexOf('  async function geocodeAllDirectFuelStations()'),bulkEnd=text.indexOf('  async function reprocessLinks()',bulkStart);
  if(bulkStart<0||bulkEnd<0)throw Error('Geocodificação em massa desconhecida.');
  let bulk=text.slice(bulkStart,bulkEnd);
  bulk=bulk.replace('index < pending.length;','index < Math.min(pending.length,20);');
  bulk=bulk.replace('if (!response.ok)\n            throw new Error(payload.error || "Falha na geocodificação");','if (!response.ok) { toast(payload.error || "Consulta interrompida"); break; }');
  bulk=bulk.replace('if (result) {',"const normalized=v=>String(v||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase(); if (result && ['building','amenity'].includes(result.resultType) && result.confidence>=0.95 && normalized(result.city)===normalized(station.municipio) && normalized(result.stateCode)===normalized(station.uf)) {");
  bulk=bulk.replaceAll('Geocodificação DirectFuel concluída','Etapa de geocodificação DirectFuel concluída (até 20 postos)');
  text=text.slice(0,bulkStart)+bulk+text.slice(bulkEnd);
  text=text.replace('stationCode: code, mode, targetId, reason }','stationCode: code, mode, targetId, reason, reviewedAt: previous?.reviewedAt || null }');
  text=text.replaceAll('As rotas rodoviárias são calculadas automaticamente.','Calcule as rotas pelo botão. Consultas externas têm limite diário e exigem a chave configurada pelo proprietário.');
  text=text.replaceAll('Geocodificação: Nominatim/OpenStreetMap. Rotas automáticas: OSRM/OpenStreetMap.','Coordenadas e rotas: Geoapify/OpenStreetMap, mediante configuração. Distâncias são estimativas para análise, sem validar restrições específicas de cada veículo.');
  text=text.replace("attribution: '&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>'", "attribution: '&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> | <a href=\"https://www.geoapify.com/\">Geoapify</a>'");
 }
 if(name==='online'){
  // Header identity must never seed or save business users before the first snapshot.
  const chipStart=text.indexOf('  function userChip('),chipEnd=text.indexOf('  async function readResponse(',chipStart);
  const seedStart=text.indexOf('    db.users = db.users || [];',chipStart),seedEnd=text.indexOf('    if (!header',seedStart);
  if(chipStart<0||seedStart<0||seedEnd<0||seedEnd>chipEnd)throw Error('Cabeçalho de identidade desconhecido.');
  text=text.slice(0,seedStart)+text.slice(seedEnd);

  text=text.replace('if (window.directFuelNormalizeInvoiceState?.()) pending = true;','// Incoming snapshots are preserved; normalization is performed only on explicit edits.');
  // Do not auto-save account enrichment during the initial read of the imported snapshot.
  const end=text.indexOf('  async function flushDanfes('),start=text.indexOf('  async function pull(');
  if(start<0||end<0)throw Error('Sincronização desconhecida.');
  text=text.slice(0,start)+text.slice(start,end).replaceAll('pending = true;','// Local identity enrichment does not trigger an automatic write.')+text.slice(end);
  text=text.replaceAll('Entre com a conta ChatGPT autorizada para este site.','Entre com a conta cadastrada para esta cópia de testes.').replaceAll('O acesso ao site exige uma conta ChatGPT autorizada.','O acesso à cópia de testes exige a conta vinculada no Supabase.');
 }
 text=text.replaceAll('O acesso ao site exige login no ChatGPT e e-mail corporativo @vix.com.br.','O proprietário libera cada acesso à cópia da nuvem. Use o painel do menu Usuários.');
 text=text.replaceAll('/gekon-xlsx.js','./gekon-xlsx.js').replaceAll('/logo-vixpar.png','./logo-vixpar.png');
 await writeFile(new URL(`directfuel-${name}.js`,output),text);
}
await copyFile(new URL('migration/app/document-migration.js',root),new URL('directfuel-document-migration.js',output));
await copyFile(new URL('migration/app/team-access.js',root),new URL('directfuel-team-access.js',output));
await copyFile(new URL('migration/app/geo-setup.js',root),new URL('directfuel-geo-setup.js',output));
await copyFile(new URL('migration/app/policy.js',root),new URL('directfuel-migration-policy.js',output));
let bootstrap=await readFile(new URL('public/directfuel-bootstrap.js',root),'utf8');
bootstrap=bootstrap.replace("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
const start=bootstrap.indexOf('    for(const name of [');const end=bootstrap.indexOf(') {',start);
if(start<0||end<0)throw Error('Ordem dos módulos desconhecida.');
bootstrap=bootstrap.slice(0,start)+`    for(const name of ${JSON.stringify([...modules,'document-migration','team-access','geo-setup','migration-policy'])}`+bootstrap.slice(end);
bootstrap=bootstrap.replace("    await load('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');","    try { await load('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'); } catch { window.DIRECTFUEL_MAP_AVAILABLE=false; }");
bootstrap=bootstrap.replace('`/directfuel-${name}', '`./directfuel-${name}');
await writeFile(new URL('directfuel-bootstrap.js',output),bootstrap);
console.log('Aplicação estática de testes gerada sem registros ou credenciais de serviço.');
