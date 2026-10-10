(() => {
 function rows(results){
  const data=key=>results[key]?.status==='fulfilled'?results[key].value:null;
  const docs=data('documents'),team=data('team'),security=data('security'),geo=data('geo');
  const files=Array.isArray(docs?.files)?docs.files:null,users=Array.isArray(team?.users)?team.users:null,backups=Array.isArray(security?.backups)?security.backups:null;
  const missing=files?.filter(f=>!f.present).length,enabled=users?.filter(u=>u.enabled),released=enabled?.filter(u=>u.released).length;
  return [
   {name:'PDFs e XMLs históricos',status:files?(missing?'Envio opcional':'Referências conferidas'):'Consulta indisponível — envio opcional',detail:files?`${files.length-missing} de ${files.length} arquivos referenciados presentes. ${missing} ainda no acervo original. Por decisão do proprietário, o envio dos arquivos históricos não é requisito para a produção; os dados das notas e suas referências são preservados. Para abrir um arquivo não migrado, consulte o original ou uma cópia local.`:'Não foi possível conferir os arquivos. O envio dos PDFs/XMLs históricos é opcional; isso não dispensa conferir os dados das notas.',target:'documentos'},
   {name:'Equipe',status:users?(released===enabled.length&&released>0?'Cadastros liberados':'Pendente'):'Não verificado',detail:users?`${released} de ${enabled.length} integrantes ativos liberados. Teste o login e as permissões de cada perfil antes da virada.`:'Não foi possível consultar os acessos.',target:'users'},
   {name:'Backup',status:backups?.length?'Disponível':backups?'Pendente':'Não verificado',detail:backups?.length?`${backups.length} backup(s) validado(s). Último: ${new Date(backups[0].created_at).toLocaleString('pt-BR')}. Gere outro imediatamente antes da virada. O JSON não inclui os PDFs/XMLs.`:'Confira os backups no menu Segurança.',target:'security'},
   {name:'Rotas e coordenadas',status:geo?(geo.configured?'Chave cadastrada':'Pendente'):'Não verificado',detail:geo?.configured?'A chave está cadastrada; faça uma consulta real para validar o provedor. A identificação detalhada de mesma rodovia/corredor ainda está indisponível.':'Configure GEOAPIFY_API_KEY na seção Mapas, rotas e coordenadas. O mapa e a revisão manual continuam disponíveis.'},
   {name:'Atualização final da base',status:'Conferência necessária',detail:'As bases não se sincronizam automaticamente. Defina o horário de encerramento dos lançamentos no original e reconcilie as alterações desde a cópia. Não importe um backup antigo sobre os dados novos.'},
   {name:'Validação operacional',status:'Conferência necessária',detail:'Na cópia: salvar uma alteração controlada e conferir após recarregar; anexar e abrir PDF/XML; conferir uma medição e as exportações RC/MIRO. A liberação de produção depende dessa conferência.'}
  ];
 }
 window.directFuelProductionRows=rows;
 const previous=render;
 render=function(){const result=previous.apply(this,arguments);if(route==='config'&&window.DIRECTFUEL_IS_OWNER)panel();return result;};
 function panel(){
  if(document.getElementById('productionReadiness'))return;
  const section=document.createElement('section');section.id='productionReadiness';section.className='panel';
  section.innerHTML='<h2>Preparação para produção</h2><p>Confira as pendências da nova base. Esta verificação não libera usuários, não altera registros e não troca o ambiente de trabalho.</p><button class="btn primary" data-check>Conferir pendências</button><p role="status" aria-live="polite" data-status></p><div data-results></div><p class="note">Mantenha o site original como ambiente de trabalho até concluir a conferência e combinar a virada com a equipe.</p>';
  document.getElementById('view').prepend(section);
  const button=section.querySelector('[data-check]'),status=section.querySelector('[data-status]'),body=section.querySelector('[data-results]');
  button.onclick=async()=>{
   button.disabled=true;status.textContent='Conferindo a nova base…';body.replaceChildren();
   const endpoints={documents:'/api/documents/manifest',team:'/api/team',security:'/api/security',geo:'/api/geo-provider'};
   try{
    const keys=Object.keys(endpoints),values=await Promise.allSettled(keys.map(async key=>{const response=await fetch(endpoints[key],{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Consulta indisponível.');return response.json();}));
    const results=Object.fromEntries(keys.map((key,i)=>[key,values[i]]));
    for(const row of rows(results)){
     const item=document.createElement('div');item.className='production-check';const title=document.createElement('strong');title.textContent=`${row.name} · ${row.status}`;const detail=document.createElement('p');detail.textContent=row.detail;item.append(title,detail);
     if(row.target){const action=document.createElement('button');action.className='btn secondary';action.textContent='Abrir '+({documentos:'Documentos',users:'Usuários',security:'Segurança'}[row.target]);action.onclick=()=>{route=row.target;render();};item.append(action);}
     body.append(item);
    }
    status.textContent=`Consulta concluída em ${new Date().toLocaleString('pt-BR')}. Pendências não verificadas precisam ser conferidas novamente.`;
   }catch{status.textContent='Não foi possível concluir a conferência. Tente novamente.';}finally{button.disabled=false;}
  };
 }
})();
