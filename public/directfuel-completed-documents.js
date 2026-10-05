(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mb=n=>`${(Number(n)/1000000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} MB`;
  let removed=new Set(),loading=false;
  const mark=()=>{
    document.querySelectorAll('a[href*="/api/documents/"]').forEach(link=>{
      const url=new URL(link.href,location.origin),id=decodeURIComponent(url.pathname.split('/').pop()),type=url.searchParams.get('type')==='xml'?'xml':'pdf';
      if(removed.has(`${id}.${type}`)){
        const label=document.createElement('span');label.className='note';label.textContent=`${type.toUpperCase()}: Arquivo removido · dados preservados`;link.replaceWith(label);
      }
    });
  };
  const updateRemoved=data=>{removed=new Set((data.removed||[]).map(r=>r.object_key.split('/').pop()));mark();};
  async function loadStatus(){if(loading)return;loading=true;try{const r=await fetch('/api/documents/completed?status=1',{cache:'no-store'});if(r.ok)updateRemoved(await r.json());}catch{}finally{loading=false;}}
  const original=documentos;
  documentos=function(){
    original();void loadStatus();
    if(!window.DIRECTFUEL_IS_OWNER)return;
    const panel=document.createElement('section');panel.className='panel';panel.innerHTML=`<h2>Excluir arquivos de NFs concluídas no SAP</h2><p>Somente arquivos com pedido e lançamento SAP confirmados em todas as NFs vinculadas. Os dados das NFs, medições e vínculos serão preservados.</p><button class="btn secondary" data-analyze>Analisar arquivos elegíveis</button><div data-result role="status"></div>`;
    document.querySelector('#view').prepend(panel);
    const button=panel.querySelector('[data-analyze]'),result=panel.querySelector('[data-result]');
    button.onclick=async()=>{
      button.disabled=true;result.textContent='Conferindo vínculos e tamanhos dos arquivos…';
      try {
        const response=await fetch('/api/documents/completed',{cache:'no-store'}),preview=await response.json();if(!response.ok)throw Error(preview.error);
        updateRemoved(preview);const files=preview.files.filter(f=>f.eligible),protectedFiles=preview.files.filter(f=>!f.eligible);
        result.innerHTML=`<p><strong>${files.length} arquivo(s) elegível(is) · ${mb(preview.bytes)} a liberar</strong></p><p>${protectedFiles.length} arquivo(s) preservado(s) por pendência ou referência protegida.</p>${files.length?`<div class="table-wrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>Arquivo</th><th>Tipo</th><th>Medições / NFs</th><th>Tamanho</th></tr></thead><tbody>${files.map(f=>`<tr><td>${esc(f.references.find(r=>r.name)?.name||f.id)}</td><td>${esc(f.type.toUpperCase())}</td><td>${f.references.map(r=>`${esc(r.measurement)} / ${esc(r.invoice)}`).join('<br>')}</td><td>${mb(f.bytes)}</td></tr>`).join('')}</tbody></table></div><p><strong>A exclusão dos arquivos é definitiva.</strong> O backup da base não inclui os PDFs/XMLs separados. Confirme somente se já possui as cópias que precisa guardar.</p><button class="btn danger" data-execute>Excluir ${files.length} arquivo(s) elegível(is)</button>`:'<p>Nenhum arquivo elegível para exclusão.</p>'}`;
        const execute=result.querySelector('[data-execute]');if(!execute)return;
        execute.onclick=async()=>{
          if(!confirm(`Excluir definitivamente ${files.length} arquivo(s), liberando até ${mb(preview.bytes)}?\nOs registros serão preservados. O backup da base não recupera esses arquivos.`))return;
          execute.disabled=true;button.disabled=true;
          let count=0,bytes=0;const failures=[];
          for(const file of files){
            execute.textContent=`Processando ${count+failures.length+1} de ${files.length}…`;
            try{const response=await fetch('/api/documents/completed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:file.id,type:file.type,etag:file.etag,version:preview.version,confirmation:'EXCLUIR SOMENTE ARQUIVOS'})}),data=await response.json();if(!response.ok)throw Error(data.error);count++;bytes+=data.bytes;removed.add(`${file.id}.${file.type}`);mark();}
            catch(error){failures.push(`${file.id}: ${error.message}`);break;}
          }
          result.innerHTML=`<p><strong>${count} arquivo(s) removido(s) · ${mb(bytes)} liberados.</strong> Dados das NFs e medições preservados.</p>${failures.length?`<p role="alert">Execução interrompida: ${esc(failures[0])} Analise novamente para conferir os arquivos restantes e tentar de novo.</p>`:''}`;
          button.disabled=false;void loadStatus();
        };
      }catch(error){result.textContent=error.message;}finally{button.disabled=false;}
    };
  };
  new MutationObserver(()=>mark()).observe(document.body,{childList:true,subtree:true});
  void loadStatus();
})();
