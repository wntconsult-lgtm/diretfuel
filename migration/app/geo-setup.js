(() => {
 const previous=render;
 render=function(){const result=previous.apply(this,arguments);if(route==='config'&&window.DIRECTFUEL_IS_OWNER)void panel();return result;};
 async function panel(){
  if(document.getElementById('migrationGeoSetup'))return;
  const section=document.createElement('section');section.id='migrationGeoSetup';section.className='panel';
  section.innerHTML='<h2>Mapas, rotas e coordenadas</h2><p>Cadastre uma chave Geoapify nos segredos do Supabase para ativar as consultas. Elas ocorrem somente ao clicar nos botões de cálculo ou busca, com limite local de 100 consultas por dia UTC. Resultados já consultados são reaproveitados.</p><ol><li>Crie sua conta no <a href="https://myprojects.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> e selecione o plano Free.</li><li>Crie um projeto e copie a chave em API Keys.</li><li>Abra <a href="https://supabase.com/dashboard/project/plafdeklnzrymswxjnhd/functions/secrets" target="_blank" rel="noopener noreferrer">Supabase → Funções de borda → Segredos</a>. Adicione o nome <strong>GEOAPIFY_API_KEY</strong> e cole a chave no campo de valor.</li><li>Volte ao DirectFuel e atualize a página. Na Análise Geográfica, use os botões para buscar coordenadas ou calcular rotas.</li></ol><p>A chave não deve ser colada no GitHub nem compartilhada no link de acesso. Enviamos ao provedor somente endereço ou coordenadas do posto; placas, motoristas, volumes e valores não acompanham as consultas. Confira pontos automáticos no mapa. A identificação detalhada de rodovia/corredor ainda está em adaptação.</p><p data-status role="status">Conferindo configuração…</p><button class="btn secondary" data-check>Conferir configuração</button>';
  document.querySelector('#view').append(section);
  const status=section.querySelector('[data-status]'),button=section.querySelector('[data-check]');
  async function check(){button.disabled=true;try{const response=await fetch('/api/geo-provider',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível conferir a configuração.');status.textContent=data.configured?`Chave configurada · ${data.requests}/${data.dailyLimit} consultas locais no dia UTC. Confira também a cota de créditos no Geoapify.`:'Aguardando a chave GEOAPIFY_API_KEY nos segredos do Supabase. Nenhuma consulta externa está ativada.';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}}
  button.onclick=check;await check();
 }
})();
