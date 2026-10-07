(() => {
 const unavailable=new Set(['analysis_geo','ticketlog_import','audit','users','report_ticketlog']);
 const apply=()=>{
  document.querySelectorAll('[data-route]').forEach(el=>{if(unavailable.has(el.dataset.route)||el.dataset.route.includes('ticketlog'))el.remove();});
  for(const id of ['btnReset','clearAllData','fileImport','previewDocumentRetention','previewRetention','executeDocumentRetention','analyzeDocumentRetention','saveDocumentRetention','deleteCompletedDocuments'])document.getElementById(id)?.remove();
  // A legacy JSON user record does not provision a Supabase account; account management remains in the portal.
  if(route==='config'){
   document.querySelectorAll('#view h2').forEach(h=>{if(/Usuários e acesso|Dados de teste/.test(h.textContent)){const panel=h.closest('.panel');if(panel){panel.textContent='A gestão de contas e a limpeza completa ainda não estão disponíveis nesta cópia.';}}});
  }
  const panel=document.getElementById('dashboardAudit');if(panel && panel.dataset.migration!=='blocked'){panel.dataset.migration='blocked';panel.innerHTML='<h2>Auditoria de capacidade</h2><p class="note">Este módulo ainda não está disponível na cópia de testes.</p>';} 
  const badge=document.getElementById('storageUsageBadge');if(badge){const text=badge.textContent.replace('Base:','Envio:').replace('limite de gravação','limite de sincronização');if(text!==badge.textContent)badge.textContent=text;}
  document.querySelectorAll('a[href^="/signout-with-chatgpt"]').forEach(a=>{a.href='../';a.setAttribute('data-migration-signout','');});
 };
 const originalNav=renderNav;renderNav=function(){originalNav.apply(this,arguments);apply();};
 const originalRender=render;render=function(){
  if(unavailable.has(route)||route.includes('ticketlog')){pageTitle('Módulo em migração');document.getElementById('view').textContent='Este módulo ainda não está disponível na cópia de testes.';renderNav();return;}
  const result=originalRender.apply(this,arguments);apply();queueMicrotask(apply);return result;
 };
 const resetButton=document.getElementById('btnReset');if(resetButton)resetButton.disabled=true;
 const file=document.getElementById('fileImport');if(file){file.onchange=null;file.disabled=true;}
 const observer=new MutationObserver(apply);observer.observe(document.getElementById('view'),{childList:true,subtree:true});
 window.directFuelMigrationApply=apply;
})();
