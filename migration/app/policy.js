(() => {
 const unavailable=new Set([]);
 const apply=()=>{
  document.querySelectorAll('[data-route]').forEach(el=>{if(unavailable.has(el.dataset.route))el.remove();});
  for(const id of ['btnReset','clearAllData','fileImport','previewDocumentRetention','previewRetention','deleteCompletedDocuments'])document.getElementById(id)?.remove();
  // A legacy user record requires a separate, individual Supabase binding in the Users menu.
  if(route==='config'){
   document.querySelectorAll('#view h2').forEach(h=>{if(/Usuários e acesso|Dados de teste/.test(h.textContent)){const panel=h.closest('.panel');if(panel){panel.textContent='Gerencie os acessos à cópia da nuvem no menu Usuários. A limpeza completa permanece indisponível.';}}});
  }
  if(route==='analysis_geo'){
   if(!document.getElementById('migrationGeoNotice')){const notice=document.createElement('p');notice.id='migrationGeoNotice';notice.className='note';document.getElementById('view').prepend(notice);}
   const capabilities=window.DIRECTFUEL_GEO_CAPABILITIES||{},notice=document.getElementById('migrationGeoNotice');
   const message=capabilities.routing?'Rotas e coordenadas por Geoapify/OpenStreetMap. Consultas são iniciadas pelos botões, com cota local diária. Revise coordenadas automáticas. A identificação detalhada de rodovia/corredor continua em adaptação.':'Mapa, filtros e revisão manual disponíveis. Para ativar rotas e coordenadas, o proprietário deve configurar a chave em Configurações → Mapas, rotas e coordenadas.';
   if(notice.textContent!==message)notice.textContent=message;
   if(!capabilities.routing)document.querySelectorAll('#geoGeocodeAll,#geoGeocodeDirectFuel,#geoCalculatePending,#geoRetryRouteErrors,#gaGeocode,.geoGeocodeTicketlog').forEach(el=>{el.disabled=true;el.title='Aguardando a chave do provedor.';});
   document.querySelectorAll('#geoDetailSameRoad').forEach(el=>{el.disabled=true;el.title='Identificação detalhada de rodovia/corredor em adaptação.';});
  }
  const badge=document.getElementById('storageUsageBadge');if(badge){const text=badge.textContent.replace('Base:','Envio:').replace('limite de gravação','limite de sincronização');if(text!==badge.textContent)badge.textContent=text;}
  document.querySelectorAll('a[href^="/signout-with-chatgpt"]').forEach(a=>{a.href='../';a.setAttribute('data-migration-signout','');});
 };
 const originalNav=renderNav;renderNav=function(){originalNav.apply(this,arguments);apply();};
 const originalRender=render;render=function(){
  if(unavailable.has(route)){pageTitle('Módulo em migração');document.getElementById('view').textContent='Este módulo ainda não está disponível na cópia de testes.';renderNav();return;}
  const result=originalRender.apply(this,arguments);apply();queueMicrotask(apply);return result;
 };
 const resetButton=document.getElementById('btnReset');if(resetButton)resetButton.disabled=true;
 const file=document.getElementById('fileImport');if(file){file.onchange=null;file.disabled=true;}
 const observer=new MutationObserver(apply);observer.observe(document.getElementById('view'),{childList:true,subtree:true});
 window.directFuelMigrationApply=apply;
})();
