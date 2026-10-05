(() => {
  const mb = bytes => `${(Number(bytes || 0)/1000000).toLocaleString('pt-BR',{maximumFractionDigits:2})} MB`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const names = {abastecimentos:'Abastecimentos',medicoes:'Medições e histórico',sapReturns:'Vínculos SAP e histórico',frota:'Frota',audit:'Auditoria recente',acordos:'Acordos',postos:'Postos',rede:'Rede',nfPendencias:'Pendências de NF',fiscalLayouts:'Layouts fiscais',bases:'Bases',users:'Usuários',config:'Configurações',distribuidores:'Distribuidores',produtos:'Produtos',unidades:'Unidades',stationReviews:'Revisões de postos',accountingAdjustments:'Ajustes contábeis',geoParams:'Parâmetros geográficos',docs:'Referências de documentos',geoStations:'Postos geográficos'};
  const currentPolicy = () => {
    const value=db.config?.params?.documentRetentionPolicy || {};
    return {removePdf:value.removePdf!==false,removeXml:value.removeXml!==false,compactFiscalDetails:value.compactFiscalDetails!==false};
  };
  window.directFuelStorageUsage = usage => {
    if (!usage || !window.DIRECTFUEL_IS_OWNER) return;
    let badge = document.getElementById('storageUsageBadge');
    if (!badge) { badge=document.createElement('span');badge.id='storageUsageBadge';badge.setAttribute('role','status');document.querySelector('.header-actions')?.append(badge); }
    badge.className = `badge ${usage.level === 'critical' ? 'bad' : usage.level === 'warning' ? 'warn' : 'ok'}`;
    badge.textContent = `Base: ${usage.percent.toFixed(1).replace('.',',')}% do limite de gravação`;
    badge.title = `${mb(usage.bytes)} de ${mb(usage.limitBytes)}. Atenção a partir de 70%; crítico a partir de 90%. Não representa a capacidade total da nuvem.`;
  };
  async function show() {
    if (!window.DIRECTFUEL_IS_OWNER || route !== 'config' || document.getElementById('storageConsumption')) return;
    const panel=document.createElement('div');panel.className='panel';panel.id='storageConsumption';panel.innerHTML='<h2>Consumo e capacidade</h2><p role="status">Consultando consumo…</p>';
    document.querySelector('#view').prepend(panel);
    try {
      const response=await fetch('/api/storage',{cache:'no-store'}),data=await response.json();if(!response.ok)throw Error(data.error);
      if (!panel.isConnected) return;
      const bytes=Number(data.state?.bytes || 0),percent=bytes/data.limitBytes*100,retention=Number(db.config?.params?.documentRetentionDays || 180),policy=currentPolicy();
      window.directFuelStorageUsage({bytes,limitBytes:data.limitBytes,percent,level:percent>=90?'critical':percent>=70?'warning':'normal'});
      panel.innerHTML=`
        <h2>Consumo e capacidade</h2>
        <div class="grid cards">
          <div class="card"><div class="label">Base operacional</div><div class="value">${mb(bytes)}</div><p>${percent.toFixed(1).replace('.',',')}% de ${mb(data.limitBytes)} por gravação</p></div>
          <div class="card"><div class="label">DANFEs e XMLs</div><div class="value">${mb(data.documents?.bytes)}</div><p>${Number(data.documents?.count || 0)} arquivos separados</p></div>
          <div class="card"><div class="label">Backups registrados</div><div class="value">${Number(data.backups?.count || 0)} cópias</div><p>Retenção automática · últimos 5 backups</p><p>${mb(data.backups?.bytes)} ocupados</p></div>
          <div class="card"><div class="label">Situação da base</div><div class="value">${percent>=90?'Crítico':percent>=70?'Atenção':'Normal'}</div><p>Atenção: 70% · Crítico: 90%</p></div>
        </div>
        <p class="note">A base operacional, os documentos e os backups são medidos separadamente.</p>
        <div class="panel" style="margin:18px 0 0">
          <h3>Política de retenção dos documentos fiscais</h3>
          <p class="note">O prazo começa na Data de Lançamento da NF no SAP. Somente NFs aprovadas, contabilizadas e com chave válida são elegíveis.</p>
          <div class="form-grid two"><div class="field"><label>Prazo após lançamento SAP (dias)</label><input id="documentRetentionDays" type="number" min="7" max="3650" step="1" value="${retention}"><small>Mínimo: 7 dias.</small></div><div class="field"><label>O que fazer após o prazo</label><small>Marcado: excluir ou compactar. Desmarcado: manter sempre.</small></div></div>
          <label class="switch-row"><span><strong>PDF do DANFE</strong><small style="display:block">Remove o arquivo; a chave continua disponível.</small></span><input type="checkbox" data-retention-policy="removePdf" ${policy.removePdf?'checked':''}></label>
          <label class="switch-row"><span><strong>XML da NF-e</strong><small style="display:block">Remove o arquivo XML armazenado.</small></span><input type="checkbox" data-retention-policy="removeXml" ${policy.removeXml?'checked':''}></label>
          <label class="switch-row"><span><strong>Detalhes da leitura fiscal</strong><small style="display:block">Compacta itens, parcelas e informações temporárias; mantém os totais e vínculos.</small></span><input type="checkbox" data-retention-policy="compactFiscalDetails" ${policy.compactFiscalDetails?'checked':''}></label>
          <div class="toolbar" style="margin-top:14px"><button class="btn secondary" id="saveDocumentRetention">Salvar política</button><button class="btn primary" id="analyzeDocumentRetention">Analisar economia</button></div><div id="retentionResult" class="note" role="status"></div>
        </div>
        <div class="panel" style="margin:18px 0 0"><h3>Dados mantidos independentemente do prazo</h3><p class="note">Estes dados sustentam relatórios, auditoria e vínculos. Não são excluídos pela política acima.</p><div class="grid cards">
          <div class="card"><div class="label">Abastecimentos</div><strong>Manter sempre</strong></div><div class="card"><div class="label">Medições e totais das NFs</div><strong>Manter sempre</strong></div><div class="card"><div class="label">Chave NF-e e dados essenciais</div><strong>Manter sempre</strong></div><div class="card"><div class="label">Acordos, postos e cadastros</div><strong>Manter sempre</strong></div><div class="card"><div class="label">Vínculos SAP e auditoria</div><strong>Manter sempre</strong></div><div class="card"><div class="label">Layouts fiscais</div><strong>Manter sempre</strong></div>
        </div></div>
        <div class="table-wrap"><table><thead><tr><th>Grupo de dados</th><th>Registros</th><th>Tamanho</th><th>Política</th></tr></thead><tbody>${data.collections.map(row=>`<tr><td>${esc(names[row.name] || row.name)}</td><td>${row.records == null ? '—' : Number(row.records)}</td><td>${mb(row.bytes)}</td><td>${row.name==='medicoes'?'Somente documentos fiscais conforme seleção':'Manter sempre'}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted">Medição em ${esc(new Date(data.measuredAt).toLocaleString('pt-BR'))} · Dados v${Number(data.state?.version || 0)}</p>`;
      panel.querySelector('#saveDocumentRetention').onclick=()=>{
        const days=Math.round(Number(panel.querySelector('#documentRetentionDays').value));if(days<7||days>3650)return toast('Informe um prazo entre 7 e 3.650 dias.');
        db.config=db.config||{};db.config.params=db.config.params||{};db.config.params.documentRetentionDays=days;
        db.config.params.documentRetentionPolicy=Object.fromEntries([...panel.querySelectorAll('[data-retention-policy]')].map(input=>[input.dataset.retentionPolicy,input.checked]));
        save('Política de retenção salva');render();
      };
      panel.querySelector('#analyzeDocumentRetention').onclick=async event=>{
        const button=event.currentTarget,result=panel.querySelector('#retentionResult');button.disabled=true;result.textContent='Analisando documentos elegíveis…';
        try {
          const response=await fetch('/api/storage/retention',{cache:'no-store'}),preview=await response.json();if(!response.ok)throw Error(preview.error);
          result.innerHTML=preview.notes?`<strong>${preview.notes} NF(s) em ${preview.measurements} medição(ões)</strong> atendem à política salva. Economia estimada: <strong>${mb(preview.stateBytesSaved)}</strong> na base e <strong>${mb(preview.documentBytes)}</strong> em ${preview.documents} arquivo(s). Data-limite: ${esc(new Date(preview.cutoff+'T12:00:00').toLocaleDateString('pt-BR'))}. <button class="btn danger small" id="executeDocumentRetention">Executar limpeza segura</button>`:`Nenhuma NF atende à política salva até ${esc(new Date(preview.cutoff+'T12:00:00').toLocaleDateString('pt-BR'))}.`;
          const execute=result.querySelector('#executeDocumentRetention');if(execute)execute.onclick=async()=>{if(!confirm(`Aplicar a política em ${preview.notes} NF(s) e ${preview.documents} arquivo(s)? Um backup será criado antes da operação.`))return;execute.disabled=true;try{const response=await fetch('/api/storage/retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:preview.version,confirmation:'ARQUIVAR DANFES'})}),done=await response.json();if(!response.ok)throw Error(done.error);alert(`Concluído: ${done.notes} NF(s) tratadas e ${done.removedDocuments} documento(s) removidos.`);location.reload();}catch(error){result.textContent=error.message;execute.disabled=false;}};
        } catch(error){result.textContent=error.message;} finally{button.disabled=false;}
      };
    } catch(error) { panel.innerHTML=`<h2>Consumo e capacidade</h2><p role="alert">${esc(error.message)}</p>`; }
  }
  const previous=render;render=function(){previous();void show();};
})();
