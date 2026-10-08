(() => {
 const original=documentos;
 documentos=function(){
  original();
  if(!window.DIRECTFUEL_IS_OWNER)return;
  const panel=document.createElement('section');panel.className='panel';
  panel.innerHTML='<h2>Migrar PDFs e XMLs antigos</h2><p>Selecione os arquivos salvos do sistema atual. Confira a NF vinculada a cada arquivo antes de enviar. Arquivos já presentes serão preservados.</p><p>O backup geral JSON contém as referências, mas não os arquivos. PDFs/XMLs ficam no armazenamento privado da nova base.</p><button class="btn secondary" data-manifest>Conferir arquivos faltantes</button> <input type="file" data-files multiple accept=".pdf,.xml,application/pdf,application/xml" aria-label="Selecionar PDFs e XMLs para migração"><div data-status role="status"></div><div data-preview></div>';
  document.querySelector('#view').prepend(panel);
  const status=panel.querySelector('[data-status]'),preview=panel.querySelector('[data-preview]'),picker=panel.querySelector('[data-files]'),refresh=panel.querySelector('[data-manifest]');let manifest=[],rows=[],loading=false,cleanupPending=[];
  const load=async()=>{const response=await fetch('/api/documents/manifest',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível conferir os arquivos.');manifest=data.files;cleanupPending=data.cleanupPending||[];const present=manifest.filter(f=>f.present).length;status.textContent=`${manifest.length} referências · ${present} arquivos presentes · ${manifest.length-present} faltantes.${cleanupPending.length?' '+cleanupPending.length+' limpeza(s) física(s) pendente(s).':''}`;
   panel.querySelector('[data-missing]')?.remove();
   const missing=manifest.filter(f=>!f.present);
   if(missing.length){const details=document.createElement('details');details.dataset.missing='';const summary=document.createElement('summary');summary.textContent=`Ver ${missing.length} arquivo(s) faltante(s) e abrir no sistema original`;details.append(summary);const note=document.createElement('p');note.textContent='Entre no site original antes de abrir os links. Salve cada arquivo e selecione-o aqui para migrar. Se o arquivo não estiver disponível lá, use sua cópia local. Os links consultam o original sem alterar seus dados.';details.append(note);let rendered=false;details.ontoggle=()=>{if(!details.open||rendered)return;rendered=true;const list=document.createElement('ul');for(const file of missing){const item=document.createElement('li'),link=document.createElement('a');link.href=`https://directfuel-vixpar.espa-o-de-tr-3403.chatgpt.site/api/documents/${encodeURIComponent(file.id)}?type=${file.type==='xml'?'xml':'pdf'}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${file.type.toUpperCase()} · ${file.references.map(r=>r.measurement+' / '+r.invoice).join(' · ')} · ${file.id}`;item.append(link);list.append(item);}details.append(list);};panel.insertBefore(details,preview);}
   panel.querySelector('[data-cleanup]')?.remove();
   if(cleanupPending.length){const button=document.createElement('button');button.dataset.cleanup='';button.className='btn secondary';button.textContent='Concluir limpezas pendentes';panel.append(button);button.onclick=async()=>{
    if(!confirm('Concluir a limpeza física dos arquivos já removidos da nova base? Esta ação é definitiva.'))return;
    button.disabled=true;let count=0;try{for(const file of cleanupPending){const r=await fetch('/api/documents/completed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cleanup_pending',id:file.id,type:file.type,confirmation:'EXCLUIR SOMENTE ARQUIVOS'})}),data=await r.json();if(!r.ok)throw Error(data.error);count++;}await load();}catch(e){status.textContent=`${count} limpeza(s) concluída(s). ${e.message}`;}finally{button.disabled=false;}
   };}
  };
  refresh.onclick=async()=>{refresh.disabled=true;try{await load();}catch(e){status.textContent=e.message;}finally{refresh.disabled=false;}};
  picker.onchange=async()=>{
   if(loading)return;preview.replaceChildren();refresh.disabled=true;
   try{await load();rows=[];
    const table=document.createElement('table');table.className='table';const head=document.createElement('tr');for(const label of ['Arquivo','Vínculo da NF','Situação']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
    for(const file of picker.files){
     const type=file.name.toLowerCase().endsWith('.xml')?'xml':file.name.toLowerCase().endsWith('.pdf')?'pdf':'';
     const options=manifest.filter(f=>f.type===type&&!f.present),tr=document.createElement('tr'),name=document.createElement('td'),target=document.createElement('td'),message=document.createElement('td'),select=document.createElement('select');name.textContent=file.name;
     const blank=document.createElement('option');blank.value='';blank.textContent='Selecione a NF correspondente';select.append(blank);
     for(const candidate of options){const option=document.createElement('option');option.value=candidate.id;option.textContent=`${candidate.type.toUpperCase()} · ${candidate.references.map(r=>r.measurement+' / '+r.invoice).join(' · ')} · ${candidate.id}`;select.append(option);}
     const normalized=file.name.toLocaleLowerCase('pt-BR'),exact=options.filter(f=>normalized===`${f.id}.${type}`.toLocaleLowerCase('pt-BR')),byName=options.filter(f=>f.references.some(r=>r.name&&r.name.toLocaleLowerCase('pt-BR')===normalized)),matches=exact.length?exact:byName;
     if(matches.length===1)select.value=matches[0].id;
     if(!type||file.size>20*1024*1024||!file.size){select.disabled=true;message.textContent='Arquivo inválido ou maior que 20 MB.';}else message.textContent=select.value?'Vínculo identificado; confira antes de enviar.':'Identificação manual necessária.';
     target.append(select);tr.append(name,target,message);table.append(tr);rows.push({file,type,select,message});
    }
    const wrap=document.createElement('div');wrap.className='table-wrap';wrap.append(table);preview.append(wrap);const send=document.createElement('button');send.className='btn primary';send.textContent='Enviar arquivos com vínculo selecionado';preview.append(send);
    send.onclick=async()=>{
     if(loading)return;const selected=rows.filter(r=>!r.select.disabled&&r.select.value),keys=selected.map(r=>r.select.value+':'+r.type);
     if(!selected.length){status.textContent='Selecione ao menos um vínculo válido.';return;}
     if(new Set(keys).size!==keys.length){status.textContent='Há arquivos escolhidos para o mesmo vínculo. Corrija a seleção.';return;}
     if(!confirm(`Enviar ${selected.length} arquivo(s) para a nova base privada, nos vínculos selecionados?`))return;
     loading=true;send.disabled=true;picker.disabled=true;refresh.disabled=true;rows.forEach(r=>r.select.disabled=true);let saved=0;
     try{
      for(const row of selected){row.message.textContent='Enviando…';const response=await fetch(`/api/documents/${encodeURIComponent(row.select.value)}?type=${row.type}&migration=1`,{method:'POST',headers:{'content-type':row.type==='pdf'?'application/pdf':'application/xml'},body:row.file}),data=await response.json();if(!response.ok){row.message.textContent=data.error||'Falha no envio.';throw Error(row.message.textContent);}row.message.textContent='Enviado e vinculado.';row.sent=true;saved++;}
      status.textContent=`${saved} arquivo(s) migrado(s). Clique em Conferir arquivos faltantes para atualizar.`;
     }catch(e){status.textContent=`${saved} arquivo(s) enviado(s). Execução interrompida: ${e.message} Os envios concluídos foram preservados.`;}
     finally{loading=false;send.disabled=false;picker.disabled=false;refresh.disabled=false;rows.forEach(r=>r.select.disabled=Boolean(r.sent||!r.type||r.file.size>20*1024*1024||!r.file.size));}
    };
   }catch(e){status.textContent=e.message;}finally{refresh.disabled=false;}
  };
 };
})();
