(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const digits = value => String(value || "").replace(/\D/g, "");
  const fiscalCode = value => String(value || "").trim().toUpperCase();
  const records = value => Array.isArray(value) ? value : [];
  const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
  const now = () => new Date().toISOString();
  const isConfirmed = status => ["Confirmado", "Aprovada"].includes(String(status));
  const isAdmin = () => window.DIRECTFUEL_IS_OWNER || ["Master", "Administrador"].includes(window.DIRECTFUEL_CURRENT_PROFILE);
  const params = () => {
    db.config ||= { modules:{}, params:{}, required:{} };
    db.config.params ||= {};
    const p = db.config.params;
    if (p.medicaoToleranciaVolume == null) p.medicaoToleranciaVolume = .01;
    if (p.medicaoToleranciaValor == null) p.medicaoToleranciaValor = 10;
    if (p.medicaoToleranciaPercentual == null) p.medicaoToleranciaPercentual = .1;
    if (!p.medicaoToleranciaRegra) p.medicaoToleranciaRegra = "maior";
    return p;
  };
  params();
  window.directFuelNormalizeInvoiceState = () => {
    let changed=false;
    if(!Array.isArray(db.nfPendencias)){db.nfPendencias=[];changed=true;}
    const fuelings=new Map(records(db.abastecimentos).map(item=>[String(item.id),item]));
    for(const measurement of records(db.medicoes).filter(item=>item.status==="Confirmado"))for(const id of records(measurement.itens).map(String)){const fueling=fuelings.get(id);if(fueling&&!fueling.medicaoId){fueling.medicaoId=measurement.id;changed=true;}}
    return changed;
  };
  window.directFuelNormalizeInvoiceState();

  function noteList(measurement) {
    if (Array.isArray(measurement.notasFiscais)) return measurement.notasFiscais;
    if (!measurement.nf) return [];
    return [{ id:measurement.documentoId || measurement.id, numero:measurement.nf, serie:measurement.serie || "", chave:measurement.chave || "", emissao:measurement.emissao || "", vencimento:measurement.vencimento || "", quantidadeTotal:Number(measurement.qtNf || 0), valorTotal:Number(measurement.valorNf || 0), itensFiscais:[], parcelas:[], documentoPdfId:measurement.documentoId || measurement.id, pdfNome:measurement.danfeNome || "", origemLeitura:"Legado", postoId:measurement.postoId, postoStatus:"IDENTIFICADO" }];
  }

  function tolerance(expected) {
    const p = params(), fixed = Math.max(0, Number(p.medicaoToleranciaValor || 0)), percentage = Math.abs(expected) * Math.max(0, Number(p.medicaoToleranciaPercentual || 0)) / 100;
    if (p.medicaoToleranciaRegra === "fixa") return fixed;
    if (p.medicaoToleranciaRegra === "percentual") return percentage;
    if (p.medicaoToleranciaRegra === "menor") return Math.min(fixed, percentage);
    return Math.max(fixed, percentage);
  }
  window.directFuelMeasurementTolerance = tolerance;
  function volumeTolerance() { const value=Number(params().medicaoToleranciaVolume);return Number.isFinite(value)&&value>=0?value:.01; }
  window.directFuelVolumeTolerance = volumeTolerance;

  function noteQuantity(note) {
    const itemTotal = records(note.itensFiscais).reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
    return Number((note.quantidadeTotal ?? note.qt ?? itemTotal) || 0);
  }

  function noteValue(note) { return Number(note.valorTotal ?? note.valor ?? 0); }
  function fiscalIdentity(note) {
    const key = digits(note.chave || note.chaveNfe);
    if (key) return "chave:" + key;
    return [digits(note.cnpjEmitente), note.numero || "", note.serie || "", String(note.emissao || "").slice(0,10), noteValue(note).toFixed(2)].join("|");
  }
  function duplicateOwner(note, measurementId) {
    const identity = fiscalIdentity(note);
    if (!identity.replace(/[|0.]/g, "")) return null;
    for (const measurement of db.medicoes || []) {
      if (measurement.status === "Devolvida para pendentes") continue;
      for (const existing of noteList(measurement)) if (measurement.id !== measurementId && fiscalIdentity(existing) === identity) return measurement;
    }
    return null;
  }

  function measurementResult(measurement) {
    const fuelings = (db.abastecimentos || []).filter(item => records(measurement.itens).includes(item.id));
    const notes = noteList(measurement), expectedQuantity = fuelings.reduce((sum, item) => sum + Number(item.qt || 0), 0), expectedValue = fuelings.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const invoiceQuantity = notes.reduce((sum, note) => sum + noteQuantity(note), 0), invoiceValue = notes.reduce((sum, note) => sum + noteValue(note), 0);
    const quantityDifference = invoiceQuantity - expectedQuantity, valueDifference = invoiceValue - expectedValue, limit = tolerance(expectedValue);
    const unidentifiedStation = notes.some(note => note.postoStatus === "POSTO NÃO IDENTIFICADO" || (note.postoId && note.postoId !== measurement.postoId));
    const unidentifiedProducts = notes.reduce((sum, note) => sum + records(note.itensFiscais).filter(item => !item.produtoDirectFuelId).length, 0);
    let status = "AGUARDANDO NF";
    if (notes.some(note => note.processando)) status = "PROCESSANDO";
    else if (notes.some(note => note.duplicada)) status = "NF DUPLICADA";
    else if (!notes.length) status = "AGUARDANDO NF";
    else if (unidentifiedStation) status = "POSTO NÃO IDENTIFICADO";
    else if (unidentifiedProducts) status = "PRODUTO NÃO IDENTIFICADO";
    else if (Math.abs(quantityDifference) > volumeTolerance()+.000001 || Math.abs(valueDifference) > limit) status = "DIVERGENTE";
    else if (Math.abs(valueDifference) > .010001) status = "CONCILIADO COM TOLERÂNCIA";
    else status = "CONCILIADO";
    if (isConfirmed(measurement.status)) status = "CONFIRMADO";
    return { fuelings, notes, expectedQuantity, expectedValue, invoiceQuantity, invoiceValue, quantityDifference, valueDifference, limit, status, unidentifiedProducts };
  }

  function addHistory(measurement, action, detail) {
    measurement.historico ||= [];
    measurement.historico.unshift({ id:uid("HIS"), data:now(), usuario:window.DIRECTFUEL_CURRENT_EMAIL || "Sistema", acao:action, detalhe:detail || "" });
    measurement.historico = measurement.historico.slice(0, 200);
  }

  function findStation(cnpj) { const clean = digits(cnpj); return clean ? (db.postos || []).filter(station => digits(station.cnpj) === clean) : []; }
  function agreementsAt(stationId, invoiceDate) {
    const date=invoiceDate || window.DirectFuelImportRules.todayIso();
    return (db.acordos || []).filter(agreement => {
      const start=agreement.inicio || "",end=agreement.fim || "9999-12-31",status=String(agreement.status || "Vigente").toLowerCase();
      return agreement.postoId === stationId && status !== "cancelado" && status !== "em aprovação" && !!start && date >= start && date <= end;
    }).sort((a,b)=>String(b.inicio || "").localeCompare(String(a.inicio || "")));
  }
  function agreementFor(stationId, productId, invoiceDate) { return agreementsAt(stationId,invoiceDate).find(agreement => agreement.produtoId === productId); }
  function mappingFor(stationId, code, invoiceDate) {
    for (const agreement of agreementsAt(stationId,invoiceDate)) {
      const mapping = records(agreement.fiscalProductMappings).find(item => item.ativo !== false && fiscalCode(item.codigoProdutoFiscal) === fiscalCode(code));
      if (mapping) return { agreement, mapping };
    }
    return null;
  }

  const firstText = (node, name) => node?.getElementsByTagNameNS("*", name)?.[0]?.textContent?.trim() || "";
  function parseXml(text, filename) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("O XML está inválido ou incompleto.");
    const info = xml.getElementsByTagNameNS("*", "infNFe")[0];
    if (!info) throw new Error("O arquivo não contém uma NF-e reconhecível.");
    const ide = info.getElementsByTagNameNS("*", "ide")[0], emit = info.getElementsByTagNameNS("*", "emit")[0], total = info.getElementsByTagNameNS("*", "ICMSTot")[0];
    const cnpj = firstText(emit, "CNPJ"), stations = findStation(cnpj), emission=(firstText(ide,"dhEmi") || firstText(ide,"dEmi")).slice(0,10);
    const note = { id:uid("NF"), arquivoNome:filename, xmlNome:filename, origemLeitura:"XML NF-e", chave:digits(info.getAttribute("Id") || "").slice(-44), numero:firstText(ide,"nNF"), serie:firstText(ide,"serie"), cnpjEmitente:cnpj, razaoSocial:firstText(emit,"xNome"), emissao:emission, dataSaida:(firstText(ide,"dhSaiEnt") || firstText(ide,"dSaiEnt")).slice(0,10), valorTotal:Number(firstText(total,"vNF") || 0), itensFiscais:[], parcelas:[], xmlDocumento:true, postoId:stations.length === 1 ? stations[0].id : "", postoStatus:stations.length === 1 ? "IDENTIFICADO" : "POSTO NÃO IDENTIFICADO" };
    note.itensFiscais = [...info.getElementsByTagNameNS("*", "det")].map(det => {
      const product = det.getElementsByTagNameNS("*", "prod")[0], code = firstText(product,"cProd"), mapped = mappingFor(note.postoId, code, emission);
      return { id:uid("NFI"), codigoProdutoFiscal:code, descricao:firstText(product,"xProd"), unidade:firstText(product,"uCom"), quantidade:Number(firstText(product,"qCom") || 0), valorUnitario:Number(firstText(product,"vUnCom") || 0), valorTotal:Number(firstText(product,"vProd") || 0), produtoDirectFuelId:mapped?.mapping.produtoDirectFuelId || "", acordoId:mapped?.agreement.id || "", associacaoSomenteMedicao:false };
    });
    note.quantidadeTotal = note.itensFiscais.reduce((sum,item) => sum + Number(item.quantidade || 0), 0);
    note.parcelas = [...info.getElementsByTagNameNS("*", "dup")].map(dup => ({ id:uid("PAR"), numero:firstText(dup,"nDup"), vencimento:firstText(dup,"dVenc"), valor:Number(firstText(dup,"vDup") || 0) }));
    note.vencimento = note.parcelas.map(item => item.vencimento).filter(Boolean).sort()[0] || "";
    return note;
  }

  async function pdfPages(file, progress) {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data:await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      pages.push({pageNumber,text:window.DirectFuelDanfeParser.textFromItems(content.items)});
      if (progress) progress(pageNumber,pdf.numPages);
    }
    return pages;
  }

  window.directFuelReadPdfPages=pdfPages;

  async function parsePdf(file, progress, expectedStationId="", existingDocumentId="") {
    if (!window.DirectFuelDanfeParser) throw new Error("O leitor de DANFE não foi carregado. Recarregue o sistema.");
    const pages=await pdfPages(file,progress),documentId=existingDocumentId || uid("DOC"),parsed=window.DirectFuelLayouts.read(pages,db.fiscalLayouts||[]);
    const notes=parsed.map(raw => {
      const stations=findStation(raw.cnpjEmitente),stationId=stations.length === 1 ? stations[0].id : "";
      const items=raw.itensFiscais.map(item=>{const mapped=mappingFor(stationId,item.codigoProdutoFiscal,raw.emissao);return {...item,id:uid("NFI"),produtoDirectFuelId:mapped?.mapping.produtoDirectFuelId||"",acordoId:mapped?.agreement.id||"",associacaoSomenteMedicao:false};});
      const first=raw.paginas[0],last=raw.paginas.at(-1);
      return {layoutId:raw.layoutId,layoutVersion:raw.layoutVersion,layoutFingerprint:raw.layoutFingerprint,layoutName:raw.layoutName,layoutStatus:raw.layoutStatus,id:uid("NF"),arquivoNome:`${file.name} · ${first===last?`página ${first}`:`páginas ${first}-${last}`}`,pdfNome:file.name,origemLeitura:"PDF DANFE digital",chave:raw.chave,numero:raw.numero,serie:raw.serie,cnpjEmitente:raw.cnpjEmitente,razaoSocial:raw.razaoSocial||"",emissao:raw.emissao,vencimento:raw.vencimento,dataSaida:"",quantidadeTotal:items.reduce((sum,item)=>sum+Number(item.quantidade||0),0),valorTotal:raw.valorTotal,itensFiscais:items,parcelas:raw.vencimento?[{id:uid("PAR"),numero:"",vencimento:raw.vencimento,valor:raw.valorTotal}]:[],pdfDocumento:true,documentoPdfId:documentId,pdfPaginaInicial:first,pdfPaginaFinal:last,postoId:stationId,postoStatus:stationId?"IDENTIFICADO":"POSTO NÃO IDENTIFICADO",leituraParcial:raw.errosLeitura.length>0,errosLeitura:raw.errosLeitura};
    });
    return {documentId,pageCount:pages.length,notes};
  }

  async function uploadDocument(id, type, file) {
    const response = await fetch(`/api/documents/${encodeURIComponent(id)}?type=${type}`, { method:"POST", headers:{"content-type":type === "pdf" ? "application/pdf" : "application/xml"}, body:file });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível enviar o documento.");
    return result;
  }

  function mappingManager(agreement) {
    agreement.fiscalProductMappings ||= [];
    const originalMappings = JSON.stringify(agreement.fiscalProductMappings);
    const draft = structuredClone(agreement.fiscalProductMappings).map(item=>({...item,produtoDirectFuelId:agreement.produtoId}));
    modal(`De/Para Produto Fiscal · ${esc(agreement.numero || agreement.id)}`, `<p class="note">Cadastre os códigos usados pelo posto para o produto <strong>${esc(produtoNome(agreement.produtoId))}</strong>. O vínculo pertence a este acordo e é aplicado somente às NFs emitidas entre ${dateBR(agreement.inicio)} e ${agreement.fim?dateBR(agreement.fim):"31/12/9999"}.</p><div id="fiscalMappings"></div><button type="button" class="btn secondary" id="addFiscalMapping">+ Adicionar código fiscal</button>`, back => {
      const invalid = draft.some(item => !String(item.codigoProdutoFiscal || "").trim());
      if (invalid) return toast("Informe o código da NF em todas as linhas.");
      const codes=draft.map(item=>fiscalCode(item.codigoProdutoFiscal));
      if (new Set(codes).size !== codes.length) return toast("O mesmo código fiscal não pode aparecer duas vezes no acordo.");
      const currentAgreement=ent("acordos",agreement.id);
      if(!currentAgreement||currentAgreement.produtoId!==agreement.produtoId||JSON.stringify(currentAgreement.fiscalProductMappings||[])!==originalMappings)return toast("Este acordo foi alterado enquanto a janela estava aberta. Feche e reabra o De/Para para conferir os dados atuais.");
      currentAgreement.fiscalProductMappings = draft;
      audit("Alteração", "De/Para Produto Fiscal", agreement.numero || agreement.id);
      save("De/Para fiscal salvo"); back.remove(); render();
    });
    const draw = () => {
      $("#fiscalMappings").innerHTML = draft.map((item,index) => `<div class="panel fiscal-map-row" data-map="${index}"><div class="form-grid"><div class="field"><label>Produto do acordo</label><input value="${esc(produtoNome(agreement.produtoId))}" readonly></div><div class="field"><label>Código do produto na NF</label><input data-key="codigoProdutoFiscal" value="${esc(item.codigoProdutoFiscal)}"></div><div class="field"><label>Descrição na NF</label><input data-key="descricaoProdutoFiscal" value="${esc(item.descricaoProdutoFiscal)}"></div><div class="field"><label>Unidade</label><input data-key="unidade" value="${esc(item.unidade || "L")}"></div><div class="field"><label>Ativo</label><select data-key="ativo"><option value="true" ${item.ativo!==false?"selected":""}>Sim</option><option value="false" ${item.ativo===false?"selected":""}>Não</option></select></div><div class="field"><label>&nbsp;</label><button type="button" class="btn small danger removeFiscalMap">${agreement.fiscalProductMappings.some(saved=>saved.id===item.id)?"Desativar":"Remover"}</button></div></div></div>`).join("") || '<p class="muted">Nenhum código fiscal relacionado.</p>';
      $$("[data-map]").forEach(row => { const item=draft[Number(row.dataset.map)]; row.querySelectorAll("[data-key]").forEach(input => input.onchange=()=>{item[input.dataset.key]=input.dataset.key==="ativo"?input.value==="true":input.value;}); row.querySelector(".removeFiscalMap").onclick=()=>{const index=Number(row.dataset.map);if(agreement.fiscalProductMappings.some(saved=>saved.id===draft[index].id)){draft[index].ativo=false;}else{draft.splice(index,1);}draw();}; });
    };
    $("#addFiscalMapping").onclick=()=>{draft.push({id:uid("DPF"),produtoDirectFuelId:agreement.produtoId,codigoProdutoFiscal:"",descricaoProdutoFiscal:"",unidade:"L",ativo:true});draw();}; draw();
  }

  const baseAgreements = acordos;
  acordos = function () {
    baseAgreements();
    $$(".editA").forEach(button => {
      const cell=button.closest("td"), agreement=ent("acordos",button.dataset.id);
      if (!cell || !agreement || cell.querySelector(".fiscalMap")) return;
      const fiscal=document.createElement("button"); fiscal.className="btn small secondary fiscalMap"; fiscal.textContent="De/Para fiscal"; fiscal.onclick=()=>mappingManager(agreement); cell.append(" ",fiscal);
    });
  };

  const baseConfig = config;
  config = function () {
    baseConfig(); const p=params();
    $('#view').insertAdjacentHTML('beforeend',`<div class="panel"><h2>Layout MIRO</h2><div class="form-grid"><div class="field"><label for="miroCategory">Categoria NF</label><input id="miroCategory" maxlength="4" value="${esc(p.miroCategoriaNF??'Z1')}"></div><div class="field"><label for="miroCfop">CFOP</label><input id="miroCfop" placeholder="Informe o CFOP" value="${esc(p.miroCFOP||'')}"></div></div><p class="note">Parâmetros comuns a todas as NFs do layout. Confirme os códigos com sua equipe fiscal.</p><button class="btn primary" id="saveMiroSettings">Salvar parâmetros MIRO</button></div>`);
    $('#saveMiroSettings').onclick=()=>{const category=$('#miroCategory').value.trim().toUpperCase(),cfop=$('#miroCfop').value.trim().replace(/\./g,'');if(!/^[A-Z0-9]{1,4}$/.test(category)||!/^[123567]\d{3}$/.test(cfop))return toast('Informe Categoria NF e CFOP válido com quatro dígitos.');p.miroCategoriaNF=category;p.miroCFOP=cfop;audit('Alteração','Configurações','Layout MIRO: '+category+' / '+cfop);save('Parâmetros MIRO salvos');};
    $("#view").insertAdjacentHTML("beforeend",`<div class="panel"><h2>Códigos IVA SAP</h2><div class="field"><label for="ivaSapCodes">Códigos permitidos (um por linha)</label><textarea id="ivaSapCodes" rows="5" placeholder="Ex.: L6, DP — um código por linha">${esc((p.ivaSapCodigos||[]).join('\n'))}</textarea><small>Dois caracteres alfanuméricos. Defina o código de cada posto/produto no acordo, conforme orientação fiscal.</small></div><button type="button" class="btn primary" id="saveIvaSap">Salvar códigos IVA</button></div>`);
    $('#saveIvaSap').onclick=()=>{const codes=[...new Set($('#ivaSapCodes').value.toUpperCase().split(/[\s,;]+/).filter(Boolean))];if(codes.some(code=>! /^[A-Z0-9]{2}$/.test(code)))return toast('Cada IVA deve ter dois caracteres alfanuméricos.');const used=[...new Set((db.acordos||[]).map(a=>a.ivaSap).filter(Boolean))];if(used.some(code=>!codes.includes(code)))return toast('Mantenha os códigos utilizados nos acordos: '+used.filter(code=>!codes.includes(code)).join(', '));p.ivaSapCodigos=codes;audit('Alteração','Configurações','Códigos IVA SAP: '+codes.join(', '));save('Códigos IVA salvos');};
    $("#view").insertAdjacentHTML("beforeend",'<div class="panel"><h2>Medição semanal por acordo</h2><p>Configure o dia de fechamento e o prazo para medir em Cadastros → Acordos → Editar. Cada ciclo permanece em andamento até o fim do dia de fechamento. Acordos sem calendário aparecem como Programação não definida.</p></div>');

    $("#view").insertAdjacentHTML("beforeend", `<div class="panel"><h2>Alertas de vencimento das NFs</h2><div class="field"><label for="nfDueAlertDays">Prazo de alerta de vencimento de NF (dias)</label><input id="nfDueAlertDays" type="number" min="0" max="3650" step="1" value="${window.DirectFuelDashboardFinancial.alertDays(db)}"><small>Dashboard: NFs com vencimento entre hoje e este prazo, inclusive. Padrão: 7 dias.</small></div><button type="button" class="btn primary" id="saveNfDueAlertDays">Salvar prazo</button></div>`);
    $("#saveNfDueAlertDays").onclick=()=>{const raw=$("#nfDueAlertDays").value,value=Number(raw);if(!raw.trim()||!Number.isInteger(value)||value<0||value>3650)return toast("Informe um número inteiro entre 0 e 3650 dias.");params().nfDueAlertDays=value;audit("Alteração","Configurações",`Prazo de alerta de vencimento de NF: ${value} dias`);save("Prazo de alerta salvo");};

    $("#view").insertAdjacentHTML("beforeend", `<div class="panel"><h2>Conciliação fiscal da medição</h2><p class="note">As tolerâncias de valor e volume são independentes e valem para mais ou para menos, por NF e no total da medição. A tolerância financeira incide no valor total, não no preço por litro.</p><div class="form-grid"><div class="field"><label>Tolerância de volume (L)</label><input id="fiscalTolVolume" type="number" min="0" step="0.001" value="${p.medicaoToleranciaVolume}"><small>Limite absoluto para mais ou para menos. Zero exige volumes iguais.</small></div><div class="field"><label>Tolerância fixa (R$)</label><input id="fiscalTolValue" type="number" min="0" step="0.01" value="${p.medicaoToleranciaValor}"></div><div class="field"><label>Tolerância percentual (%)</label><input id="fiscalTolPercent" type="number" min="0" step="0.01" value="${p.medicaoToleranciaPercentual}"></div><div class="field"><label>Regra aplicada</label><select id="fiscalTolRule"><option value="fixa">Somente fixa em R$</option><option value="percentual">Somente percentual</option><option value="menor">Menor entre as duas</option><option value="maior">Maior entre as duas</option></select></div></div><div class="toolbar" style="margin-top:14px"><button class="btn primary" id="saveFiscalTolerance">Salvar tolerância</button></div></div>`);
    const accounts=window.DirectFuelRcSap.accountsFor(db), buyerGroups=p.rcSapGruposCompradores||{}, categories=p.rcSapCategoriasContabeis||{}, products=records(db.produtos);
    const codes=[...new Set([...Object.keys(accounts), ...Object.keys(buyerGroups), ...Object.keys(categories), ...products.map(product=>String(product.sap||"").trim()).filter(Boolean)])];
    $("#saveFiscalTolerance").closest(".panel").insertAdjacentHTML("beforeend", `<h3 style="margin-top:24px">Conta Contábil por código SAP</h3><div class="table-wrap"><table><thead><tr><th>Código SAP</th><th>Produto</th><th>Categoria Contábil</th><th>Conta Contábil</th><th>Grupo comprador SAP</th></tr></thead><tbody>${codes.map((code,index)=>`<tr><td>${esc(code)}</td><td>${esc(products.filter(product=>String(product.sap||"").trim()===code).map(product=>product.descricao||product.curta).join(" / ")||({"35012674":"Arla","35036604":"Diesel S10 Aditivado"}[code]||"Produto não cadastrado"))}</td><td><input id="rcCategory${index}" data-rc-category="${esc(code)}" aria-label="Categoria Contábil do material ${esc(code)}" type="text" autocomplete="off" value="${esc(categories[code]||"")}"></td><td><input id="rcAccount${index}" data-rc-account="${esc(code)}" aria-label="Conta Contábil do SAP ${esc(code)}" inputmode="numeric" value="${esc(accounts[code]||"")}"></td><td><input id="rcBuyerGroup${index}" data-rc-buyer-group="${esc(code)}" aria-label="Grupo comprador SAP do material ${esc(code)}" type="text" autocomplete="off" value="${esc(buyerGroups[code]||"")}"></td></tr>`).join("")}</tbody></table></div><p class="note">A RC usa a categoria, conta e grupo comprador de cada material e o depósito da unidade Vixpar. Complete os cadastros antes de gerar.</p><div class="form-grid"><div class="field"><label>Forma de Pagamento SAP</label><p class="note">Definida pelo acordo: Boleto = B; Depósito em conta = T.</p></div><div class="field"><label>Centro de Custo Transitório SAP</label><input id="rcTransient" inputmode="numeric" value="${esc(p.rcSapCentroCustoTransitorio||'')}" placeholder="Ex.: 300316000"></div></div><button class="btn primary" id="saveRcAccounts">Salvar parâmetros por material</button>`);
    $("#saveRcAccounts").onclick=()=>{const transient=$("#rcTransient").value.trim();if(transient&&!/^\d+$/.test(transient))return toast("Informe somente números no centro de custo transitório.");const next={};for(const input of $$("[data-rc-account]")){const value=input.value.trim();if(value&&!/^\d+$/.test(value))return toast(`Informe somente números na Conta Contábil do SAP ${input.dataset.rcAccount}.`);next[input.dataset.rcAccount]=value;}const groups={};for(const input of $$("[data-rc-buyer-group]"))groups[input.dataset.rcBuyerGroup]=input.value.trim();const categoryValues={};for(const input of $$("[data-rc-category]"))categoryValues[input.dataset.rcCategory]=input.value.trim();params().rcSapCentroCustoTransitorio=transient;params().rcSapCategoriasContabeis=categoryValues;params().rcSapContasContabeis=next;params().rcSapGruposCompradores=groups;audit("Alteração","Configurações","Categorias, contas contábeis e grupos compradores SAP por material");save("Parâmetros por material salvos");render();};
    $("#fiscalTolRule").value=p.medicaoToleranciaRegra;
    $("#saveFiscalTolerance").onclick=()=>{const raw=$("#fiscalTolVolume").value,volume=Number(raw);if(!raw.trim()||!Number.isFinite(volume)||volume<0)return toast("Informe uma tolerância de volume válida, igual ou maior que zero.");params().medicaoToleranciaVolume=volume;params().medicaoToleranciaValor=Math.max(0,Number($("#fiscalTolValue").value||0));params().medicaoToleranciaPercentual=Math.max(0,Number($("#fiscalTolPercent").value||0));params().medicaoToleranciaRegra=$("#fiscalTolRule").value;audit("Alteração","Configurações",`Tolerâncias da medição · volume: ±${volume} L`);save("Tolerância salva");render();};
  };

  window.directFuelInvoiceIssue = measurement => {
    const result=measurementResult(measurement);
    if (!result.notes.length) return "Adicione ao menos uma NF.";
    if (result.notes.some(note=>digits(note.chave).length!==44 || !String(note.numero||"").trim() || !(note.vencimento || records(note.parcelas).some(item=>item.vencimento)) || !(Number(note.valorTotal||0)>0) || !records(note.itensFiscais).length)) return "Complete os dados das NFs sinalizadas com erro de leitura.";
    if (result.status === "POSTO NÃO IDENTIFICADO") return "Identifique o posto de todas as NFs.";
    if (result.status === "PRODUTO NÃO IDENTIFICADO") return "Identifique todos os produtos fiscais.";
    if (result.status === "NF DUPLICADA") return "Remova a NF duplicada.";
    if (measurement.conferenciaNfAtivada && result.notes.some(note=>!note.conferenciaConfirmada)) return "Confirme a conferência de todas as NFs antes de concluir a medição.";
    if (result.status === "DIVERGENTE" && !(measurement.divergenciaAceita && String(measurement.divergenciaJustificativa || "").trim().length >= 5)) return "Trate a divergência antes de confirmar.";
    return "";
  };

  window.directFuelInvoiceEditor = (selectedIds, existing) => {
    const fuelings=(db.abastecimentos || []).filter(item=>selectedIds.includes(item.id)), stationIds=[...new Set(fuelings.map(item=>item.postoId))];
    if (!fuelings.length || stationIds.length !== 1) return toast("Selecione abastecimentos de um único posto.");
    if (fuelings.some(item=>item.medicaoId && item.medicaoId !== existing?.id)) return toast("Há abastecimento já incluído em outra medição.");
    const dates=fuelings.map(item=>item.data).filter(Boolean).sort(), measurement=existing ? structuredClone(existing) : { id:uid("M"), numero:`MED-${new Date().getFullYear()}-${String((db.medicoes || []).length+1).padStart(4,"0")}`, postoId:stationIds[0], itens:[...selectedIds], status:"Aguardando NF", historico:[] };
    measurement.notasFiscais=structuredClone(noteList(measurement));
    measurement.conferenciaNfAtivada=true;
    const pendingFiles=new Map(), removedDocuments=[], importPreview={files:0,pages:0,found:0,valid:0,duplicates:0,errors:[]};
    const sourcePendingId=existing?.nfPendenciaId || "";
    modal(existing ? `Conferência · ${esc(measurement.numero)}` : "Criar medição e conferir NFs", `<div class="measurement-head"><div><strong>${esc(postoNome(measurement.postoId))}</strong><span>${fuelings.length} abastecimentos · ${dateBR(dates[0])} a ${dateBR(dates.at(-1))}</span></div><div class="field"><label>Número da medição</label><input id="fiscalMeasurementNumber" value="${esc(measurement.numero)}"></div></div><div class="toolbar fiscal-actions"><label class="btn primary">+ Adicionar NF<input id="fiscalFiles" type="file" accept=".xml,.pdf,application/xml,text/xml,application/pdf" multiple hidden></label><span class="muted">PDF simples ou composto, ou XML · até 20 MB</span><button type="button" class="btn secondary" id="manualFiscalNote">Adicionar manualmente</button><button type="button" class="btn secondary" id="reprocessFiscal">Reprocessar conferência</button></div><div id="fiscalProcessing" class="note" hidden></div><div id="fiscalSummary"></div><div id="fiscalNotes"></div><div id="fiscalNotesSummary"></div><div id="fiscalTreatment"></div><div id="fiscalHistory"></div><div class="toolbar" style="margin-top:16px"><button type="button" class="btn primary" id="confirmMeasurement">Medir todas</button><button type="button" class="btn secondary" id="saveValidInvoices">Gravar somente NFs OK</button><button type="button" class="btn danger" id="cancelMeasurement">Cancelar medição</button></div><p class="note">“Gravar somente NFs OK” cria a medição realizada apenas com as NFs conformes e seus abastecimentos vinculados. NFs com erro e abastecimentos ainda sem NF permanecem em Medições pendentes.</p>`, back => persist("draft",back));

    $("#fiscalProcessing").insertAdjacentHTML("afterend",'<div id="fiscalImportPreview"></div>');
    function currentImportErrors(note) {
      if(note.arquivada)return [];
      const errors=[];
      if (note.duplicada) errors.push("NF duplicada em outra medição");
      if (digits(note.chave).length!==44) errors.push("Chave de acesso não identificada");
      if (!String(note.numero||"").trim()) errors.push("Número da NF não identificado");
      if (!note.emissao) errors.push("Data de emissão não identificada");
      if (!(note.vencimento || records(note.parcelas).some(item=>item.vencimento))) errors.push("Vencimento não identificado no quadro Fatura/Duplicata");
      if (!(Number(note.valorTotal||0)>0)) errors.push("Valor total da NF não identificado");
      if (!records(note.itensFiscais).length) errors.push("Itens da NF não identificados");
      if (note.postoStatus !== "IDENTIFICADO") errors.push("CNPJ emitente sem posto identificado");
      const unmapped=[...new Set(records(note.itensFiscais).filter(item=>!item.produtoDirectFuelId).map(item=>item.codigoProdutoFiscal||"sem código"))];
      if (unmapped.length) errors.push(`Produto sem De/Para no acordo: ${unmapped.join(", ")}`);
      return errors;
    }
    function applyAutomaticLinks() {
      if(!window.DirectFuelReconciliation)return;
      const links=window.DirectFuelReconciliation.automaticLinks(measurement.notasFiscais,fuelings,volumeTolerance()+.000001);
      for(const note of measurement.notasFiscais)if(!note.vinculoManual&&!note.conferenciaConfirmada)note.abastecimentoIds=links.get(note)||[];
    }
    function noteConference(note) {
      if(note.arquivada){const linked=records(note.abastecimentoIds).map(id=>fuelings.find(item=>String(item.id)===String(id))).filter(Boolean),quantityFueling=linked.reduce((sum,item)=>sum+Number(item.qt||0),0),valueFueling=linked.reduce((sum,item)=>sum+Number(item.total||0),0),quantityInvoice=noteQuantity(note),valueInvoice=noteValue(note);return {linked,quantityFueling,valueFueling,quantityInvoice,valueInvoice,quantityDifference:quantityInvoice-quantityFueling,valueDifference:valueInvoice-valueFueling,errors:[],ok:true};}
      const linked=records(note.abastecimentoIds).map(id=>fuelings.find(item=>String(item.id)===String(id))).filter(Boolean),quantityFueling=linked.reduce((sum,item)=>sum+Number(item.qt||0),0),valueFueling=linked.reduce((sum,item)=>sum+Number(item.total||0),0),quantityInvoice=noteQuantity(note),valueInvoice=noteValue(note),quantityDifference=quantityInvoice-quantityFueling,valueDifference=valueInvoice-valueFueling,products=new Set(records(note.itensFiscais).map(item=>item.produtoDirectFuelId).filter(Boolean)),errors=currentImportErrors(note);
      if(!linked.length)errors.push("Nenhum abastecimento DirectFuel vinculado");
      for(const fueling of linked){const check=window.directFuelAgreementCheck?.(fueling);if(check?.unresolved)errors.push(`${fueling.id} · ${dateBR(fueling.data)} · ${fueling.placa}: ${check.code}. Preço abastecido ${money(fueling.preco)}; acordo ${check.agreement?.numero||check.agreement?.id||"não encontrado"} (${check.agreement?.inicio||"-"} a ${check.agreement?.fim||"-"}): ${check.agreedPrice==null?"não disponível":money(check.agreedPrice)}. Confira o cadastro ou registre a justificativa em Ajustar abastecimentos.`);}

      if(linked.some(item=>measurement.notasFiscais.some(other=>other!==note&&records(other.abastecimentoIds).map(String).includes(String(item.id)))))errors.push("Existe abastecimento vinculado também a outra NF");
      if(linked.some(item=>note.emissao&&item.data&&item.data>note.emissao))errors.push("Existe abastecimento posterior à emissão da NF");
      if(linked.some(item=>!products.has(item.produtoId)))errors.push("Produto do abastecimento diferente do produto da NF");
      if(Math.abs(quantityDifference)>volumeTolerance()+.000001)errors.push(`Diferença de volume: ${num(quantityDifference)} L · tolerância: ±${num(volumeTolerance())} L`);
      const justified=measurement.divergenciaAceita&&String(measurement.divergenciaJustificativa||"").trim().length>=5;
      if(Math.abs(valueDifference)>tolerance(valueFueling)&&!justified)errors.push(`Diferença de valor acima da tolerância: ${money(valueDifference)}`);
      return {linked,quantityFueling,valueFueling,quantityInvoice,valueInvoice,quantityDifference,valueDifference,errors:[...new Set(errors)],ok:errors.length===0};
    }
    function resetNoteConference(note,automatic=false){note.conferenciaConfirmada=false;delete note.conferidaPor;delete note.conferidaEm;if(automatic){note.vinculoManual=false;note.abastecimentoIds=[];}}
    function availableForMeasurement(item) {
      return item.postoId===measurement.postoId && (!item.medicaoId || item.medicaoId===measurement.id) && !records(db.medicoes).some(other=>other.id!==measurement.id && other.status!=="Devolvida para pendentes" && records(other.itens).map(String).includes(String(item.id)));
    }
    function adjustFuelingLinks(note) {
      const products=new Set(records(note.itensFiscais).map(item=>item.produtoDirectFuelId).filter(Boolean)),usedElsewhere=new Set(measurement.notasFiscais.filter(item=>item!==note).flatMap(item=>records(item.abastecimentoIds).map(String))),selected=new Set(records(note.abastecimentoIds).map(String));
      const candidates=records(db.abastecimentos).filter(availableForMeasurement).filter(item=>(!products.size||products.has(item.produtoId))&&(!note.emissao||!item.data||item.data<=note.emissao) ).sort((a,b)=>String(b.data||" ").localeCompare(String(a.data||" "))||Math.abs(Number(a.qt)-noteQuantity(note))-Math.abs(Number(b.qt)-noteQuantity(note)));
      modal(`Abastecimentos da NF ${esc(note.numero||"")}`, `<p class="note">Selecione os registros DirectFuel que compõem o volume desta NF. Inclui os pendentes de medição deste posto. Um abastecimento só pode pertencer a uma NF.</p><div class="toolbar"><div class="field"><label>Data inicial</label><input type="date" id="linkDateStart"></div><div class="field"><label>Data final</label><input type="date" id="linkDateEnd" value="${esc(note.emissao||'')}" max="${esc(note.emissao||'')}"></div><button type="button" class="btn secondary" id="clearLinkDates">Limpar período</button></div><label class="toolbar"><input type="checkbox" id="selectAllFuelingLinks"> Marcar todos do período</label><p class="note" id="linkSelectionSummary"></p><div class="table-wrap link-picker"><table><thead><tr><th>Usar</th><th>ID</th><th>Data</th><th>Placa</th><th>Produto</th><th>Quantidade</th><th>Valor</th></tr></thead><tbody>${candidates.map(item=>`<tr data-link-date="${esc(item.data||'')}"><td><input type="checkbox" data-fueling-id="${esc(item.id)}" ${selected.has(String(item.id))?"checked":""}></td><td><strong>${esc(item.id)}</strong>${usedElsewhere.has(String(item.id))?`<small class="bad-text"> · Vinculado à NF ${esc(measurement.notasFiscais.filter(other=>other!==note&&records(other.abastecimentoIds).map(String).includes(String(item.id))).map(other=>other.numero||"sem número").join(", "))} nesta conferência</small>`:fuelings.some(row=>row.id===item.id)?"":'<small class="muted"> · Pendente de medição</small>'}</td><td>${dateBR(item.data)}</td><td>${esc(item.placa||"-")}</td><td>${esc(produtoNome(item.produtoId))}</td><td>${num(item.qt)} L</td><td>${money(item.total)}</td></tr>`).join("")||'<tr><td colspan="7" class="muted">Nenhum abastecimento elegível para o produto e a data desta NF.</td></tr>'}</tbody></table></div>`, back=>{
        const chosen=$$("[data-fueling-id]",back).filter(input=>input.checked).map(input=>input.dataset.fuelingId);
        const added=chosen.map(id=>records(db.abastecimentos).find(item=>String(item.id)===id));
        if(added.some(item=>!item||!availableForMeasurement(item)))return toast("Um abastecimento não está mais disponível. Reabra a seleção.");
        const transfers=measurement.notasFiscais.filter(other=>other!==note&&records(other.abastecimentoIds).some(id=>chosen.includes(String(id))));
        if(transfers.length&&!confirm(`Transferir os abastecimentos selecionados das NFs ${transfers.map(other=>other.numero||"sem número").join(", ")} para a NF ${note.numero}? As NFs afetadas precisarão ser conferidas novamente.`))return;
        for(const other of transfers){other.abastecimentoIds=records(other.abastecimentoIds).filter(id=>!chosen.includes(String(id)));other.vinculoManual=true;resetNoteConference(other);addHistory(measurement,"Abastecimento transferido entre NFs",`NF ${other.numero} → NF ${note.numero}`);}
        for(const item of added)if(!fuelings.some(row=>row.id===item.id)){fuelings.push(item);measurement.itens.push(item.id);}
        note.abastecimentoIds=chosen;note.vinculoManual=true;resetNoteConference(note);addHistory(measurement,"Vínculo NF × abastecimento ajustado",`NF ${note.numero||"-"} · ${note.abastecimentoIds.length} registros`);back.remove();draw();
      });
      const linkDialog=$$(".modal-back").at(-1);
      function filterLinks(){
        const start=$("#linkDateStart",linkDialog).value,end=$("#linkDateEnd",linkDialog).value;
        let visible=0;
        $$("[data-link-date]",linkDialog).forEach(row=>{row.hidden=!!((start&&row.dataset.linkDate<start)||(end&&row.dataset.linkDate>end));if(!row.hidden)visible++;});
        const visibleInputs=$$("[data-fueling-id]",linkDialog).filter(input=>!input.closest("tr").hidden),all=$("#selectAllFuelingLinks",linkDialog),checked=visibleInputs.filter(input=>input.checked).length;
        all.disabled=!visibleInputs.length;all.checked=!!visibleInputs.length&&checked===visibleInputs.length;all.indeterminate=checked>0&&checked<visibleInputs.length;
        const chosen=$$("[data-fueling-id]",linkDialog).filter(input=>input.checked).map(input=>candidates.find(item=>String(item.id)===input.dataset.fuelingId));
        $("#linkSelectionSummary",linkDialog).textContent=`${visible} abastecimento(s) no período · ${chosen.length} selecionado(s) · ${num(chosen.reduce((sum,item)=>sum+Number(item.qt||0),0))} L · ${money(chosen.reduce((sum,item)=>sum+Number(item.total||0),0))}${start&&end&&start>end?" · A data inicial deve ser anterior à final.":""}`;
      }
      $$("#linkDateStart, #linkDateEnd",linkDialog).forEach(input=>{input.oninput=filterLinks;input.onchange=filterLinks;});
      $("#clearLinkDates",linkDialog).onclick=()=>{$("#linkDateStart",linkDialog).value="";$("#linkDateEnd",linkDialog).value="";filterLinks();};
      $$("[data-fueling-id]",linkDialog).forEach(input=>input.onchange=filterLinks);
      $("#selectAllFuelingLinks",linkDialog).onchange=event=>{$$("[data-fueling-id]",linkDialog).filter(input=>!input.closest("tr").hidden).forEach(input=>input.checked=event.target.checked);filterLinks();};
      filterLinks();
      $$("[data-fueling-id]",linkDialog).forEach(input=>{const item=candidates.find(candidate=>String(candidate.id)===String(input.dataset.fuelingId)),label=input.closest("tr")?.querySelector("td:nth-child(2) strong");if(!item||!label)return;const button=document.createElement("button");button.type="button";button.className="fueling-id-link";button.textContent=item.id;button.title="Editar este abastecimento e voltar à medição";button.setAttribute("aria-label",`Editar abastecimento ${item.id}`);label.replaceWith(button);button.onclick=()=>{if(typeof window.directFuelingForm!=="function")return toast("A edição do abastecimento não está disponível");window.directFuelingForm(item,{fromMeasurement:true,measurementId:measurement.id,measurementNumber:measurement.numero,measurementStatus:measurement.status,invoiceNumber:note.numero,onBeforeSave:(_updated,justification)=>{resetNoteConference(note);addHistory(measurement,"Abastecimento corrigido na conferência",`${item.id} · NF ${note.numero||"-"} · ${justification}`);},onSaved:()=>{measurement.status=measurementResult(measurement).status;delete measurement.confirmadoPor;delete measurement.confirmadoEm;linkDialog?.remove();draw();setTimeout(()=>{const index=measurement.notasFiscais.indexOf(note),card=document.querySelector(`[data-fiscal-note="${index}"]`);if(!card)return;card.scrollIntoView({behavior:"smooth",block:"start"});card.classList.add("fiscal-note-target");card.focus({preventScroll:true});setTimeout(()=>card.classList.remove("fiscal-note-target"),2400);},0);}});};});
    }
    function registerNote(note,type,documentId,file) {
      const sameDocument=measurement.notasFiscais.find(item=>note.chave && item.chave===note.chave);
      if (sameDocument && type==="pdf" && !sameDocument.pdfDocumento) {
        Object.assign(sameDocument,{pdfDocumento:true,pdfNome:file.name,documentoPdfId:documentId,pdfPaginaInicial:note.pdfPaginaInicial,pdfPaginaFinal:note.pdfPaginaFinal});
        return "associated";
      }
      const owner=duplicateOwner(note,measurement.id),localDuplicate=!!sameDocument;
      if (owner || localDuplicate) {
        note.duplicada=true;note.duplicadaMedicao=owner?.numero || measurement.numero;importPreview.duplicates++;
      }
      const importErrors=currentImportErrors(note);
      measurement.notasFiscais.push(note);
      if (!note.duplicada && !importErrors.length) importPreview.valid++;
      if (importErrors.length) importPreview.errors.push({arquivo:file.name,paginas:[note.pdfPaginaInicial,note.pdfPaginaFinal].filter(Boolean),nf:note.numero||"",mensagens:importErrors});
      return note.duplicada ? "duplicate" : "added";
    }
    async function readFiles(fileList) {
      const status=$("#fiscalProcessing"); status.hidden=false;
      for (const file of fileList) {
        status.textContent=`Lendo ${file.name}…`;
        importPreview.files++;
        try {
          const lowerName=file.name.toLowerCase();
          if (!lowerName.endsWith(".xml") && !lowerName.endsWith(".pdf")) throw new Error("Envie os DANFEs descompactados, em arquivos PDF ou XML.");
          if (file.size > MAX_DOCUMENT_BYTES) throw new Error("O documento deve ter no máximo 20 MB.");
          const type=lowerName.endsWith(".xml") || file.type.includes("xml") ? "xml" : "pdf";
          if (type==="xml") {
            const note=parseXml(await file.text(),file.name);importPreview.pages++;importPreview.found++;
            registerNote(note,type,note.id,file);pendingFiles.set(`${note.id}:xml`,file);
            addHistory(measurement,"NF adicionada",`${file.name} · leitura XML`);
          } else {
            const parsed=await parsePdf(file,(page,total)=>{status.textContent=`Lendo ${file.name} · página ${page} de ${total}…`;},measurement.postoId);
            importPreview.pages+=parsed.pageCount;importPreview.found+=parsed.notes.length;
            parsed.notes.forEach(note=>registerNote(note,type,parsed.documentId,file));
            if (parsed.notes.length) pendingFiles.set(`${parsed.documentId}:pdf`,file);
            addHistory(measurement,"PDF composto processado",`${file.name} · ${parsed.pageCount} páginas · ${parsed.notes.length} NFs`);
          }
        } catch(error) { importPreview.errors.push({arquivo:file.name,paginas:[],nf:"",mensagens:[error.message]}); }
      }
      status.hidden=true; draw();
    }

    function itemRows(note,noteIndex) {
      if (!records(note.itensFiscais).length) return `<div class="note">Nenhum item foi extraído automaticamente. Use “Adicionar item” para completar a conferência.</div>`;
      return `<div class="table-wrap"><table><thead><tr><th>Código NF</th><th>Descrição</th><th>Un.</th><th>Quantidade</th><th>Valor unit.</th><th>Total</th><th>Produto DirectFuel</th><th>Uso do vínculo</th></tr></thead><tbody>${note.itensFiscais.map((item,itemIndex)=>`<tr data-fiscal-item="${noteIndex}:${itemIndex}"><td><input data-item-key="codigoProdutoFiscal" value="${esc(item.codigoProdutoFiscal)}"></td><td><input data-item-key="descricao" value="${esc(item.descricao)}"></td><td><input data-item-key="unidade" value="${esc(item.unidade||"L")}"></td><td><input data-item-key="quantidade" type="number" step="0.001" value="${Number(item.quantidade||0)}"></td><td><input data-item-key="valorUnitario" type="number" step="0.0001" value="${Number(item.valorUnitario||0)}"></td><td><input data-item-key="valorTotal" type="number" step="0.01" value="${Number(item.valorTotal||0)}"></td><td><select data-item-key="produtoDirectFuelId"><option value="">Produto não identificado</option>${(db.produtos||[]).map(product=>`<option value="${esc(product.id)}" ${product.id===item.produtoDirectFuelId?"selected":""}>${esc(product.curta||product.descricao)} · SAP ${esc(product.sap||"-")}</option>`).join("")}</select></td><td><select data-item-key="mappingMode"><option value="measurement" ${item.associacaoSomenteMedicao?"selected":""}>Somente nesta medição</option><option value="save" ${!item.associacaoSomenteMedicao?"selected":""}>Salvar De/Para</option></select></td></tr>`).join("")}</tbody></table></div>`;
    }

    function conferenceHtml(note,noteIndex) {
      const check=noteConference(note),status=note.conferenciaConfirmada&&check.ok?"NF confirmada":check.ok?"Pronta para confirmar":"Conferir",tone=note.conferenciaConfirmada&&check.ok?"conference-confirmed":check.ok?"conference-ready":"conference-error";
      const rowsHtml=check.linked.map(item=>`<tr><td><strong>${esc(item.id)}</strong></td><td>${dateBR(item.data)}</td><td>${esc(item.placa||"-")}</td><td>${esc(produtoNome(item.produtoId))}</td><td>${num(item.qt)} L</td><td>${money(item.total)}</td></tr>`).join("")||'<tr><td colspan="6" class="muted">Nenhum abastecimento vinculado automaticamente.</td></tr>';
      return `<div class="nf-conference ${tone}"><div class="toolbar"><div><h4>Conferência NF × abastecimentos</h4><p class="note">${check.linked.length} registro(s) DirectFuel vinculado(s)</p></div><strong>${status}</strong></div><div class="conference-kpis"><div><span>Volume NF</span><strong>${num(check.quantityInvoice)} L</strong></div><div><span>Volume DirectFuel</span><strong>${num(check.quantityFueling)} L</strong></div><div><span>Diferença</span><strong>${num(check.quantityDifference)} L</strong></div><div><span>Valor NF</span><strong>${money(check.valueInvoice)}</strong></div><div><span>Valor DirectFuel</span><strong>${money(check.valueFueling)}</strong></div><div><span>Diferença</span><strong>${money(check.valueDifference)}</strong></div></div><div class="table-wrap"><table><thead><tr><th>ID abastecimento</th><th>Data</th><th>Placa</th><th>Produto</th><th>Quantidade</th><th>Valor</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${check.errors.length?`<p class="note bad-text">${esc(check.errors.join(" · "))}</p>`:""}<div class="toolbar conference-actions"><button type="button" class="btn small secondary adjustFuelingLinks" data-note-index="${noteIndex}">Ajustar abastecimentos</button>${note.vinculoManual?`<button type="button" class="btn small secondary automaticFuelingLinks" data-note-index="${noteIndex}">Usar vínculo automático</button>`:""}<button type="button" class="btn small ${note.conferenciaConfirmada?"secondary":"primary"} confirmFiscalNote" data-note-index="${noteIndex}" ${check.ok?"":"disabled"}>${note.conferenciaConfirmada?"Desfazer confirmação":"Confirmar esta NF"}</button></div></div>`;
    }

    function draw() {
      applyAutomaticLinks();
      const result=measurementResult(measurement), tone=result.status==="CONFIRMADO"||result.status.startsWith("CONCILIADO")?"price-good":result.status==="AGUARDANDO NF"?"":"price-bad";
      const errorCount=importPreview.errors.length,errorRows=importPreview.errors.slice(0,30).map(item=>`<li><strong>${esc(item.nf?`NF ${item.nf}`:item.arquivo)}</strong>${item.paginas.length?` · página${item.paginas[0]===item.paginas.at(-1)?"":"s"} ${item.paginas[0]}${item.paginas[0]===item.paginas.at(-1)?"":`-${item.paginas.at(-1)}`}`:""}: ${esc(item.mensagens.join("; "))}</li>`).join("");
      $("#fiscalImportPreview").innerHTML=(importPreview.pages||errorCount)?`<div class="panel fiscal-import-preview"><div class="preview-summary"><strong>${num(importPreview.pages)} páginas analisadas</strong><strong>${num(importPreview.found)} NFs encontradas</strong><strong>${num(importPreview.valid)} válidas</strong><strong class="${importPreview.duplicates?"bad-text":""}">${num(importPreview.duplicates)} duplicadas</strong><strong class="${errorCount?"bad-text":""}">${num(errorCount)} com erro</strong></div>${errorRows?`<details open><summary>NFs que precisam de conferência (${errorCount})</summary><ol>${errorRows}</ol>${errorCount>30?`<p class="muted">Exibindo os primeiros 30 erros.</p>`:""}</details>`:""}</div>`:"";
      const noteChecks=measurement.notasFiscais.map(note=>noteConference(note)),readyCount=noteChecks.filter(check=>check.ok).length,confirmedCount=measurement.notasFiscais.filter((note,index)=>note.conferenciaConfirmada&&noteChecks[index].ok).length,allLinkedIds=measurement.notasFiscais.flatMap(note=>records(note.abastecimentoIds).map(String)),uniqueLinked=new Set(allLinkedIds),unlinkedCount=fuelings.filter(item=>!uniqueLinked.has(String(item.id))).length,coverageComplete=uniqueLinked.size===fuelings.length&&allLinkedIds.length===uniqueLinked.size,allReady=noteChecks.length>0&&noteChecks.every(check=>check.ok)&&coverageComplete,workflowStatus=allReady?(confirmedCount===noteChecks.length?"NFs CONFIRMADAS":"PRONTO PARA MEDIR"):result.status;
      $("#fiscalSummary").innerHTML=`<div class="panel fiscal-summary"><div class="toolbar"><div><h2>Conferência da medição</h2><p class="note">${readyCount} de ${noteChecks.length} NFs conformes · ${confirmedCount} confirmadas individualmente · ${unlinkedCount} abastecimentos sem NF</p></div><strong class="${tone}">${esc(workflowStatus)}</strong></div><div class="kpi-list"><div class="mini"><span>Quantidade abastecida</span><strong>${num(result.expectedQuantity)} L</strong></div><div class="mini"><span>Quantidade nas NFs</span><strong>${num(result.invoiceQuantity)} L</strong></div><div class="mini"><span>Diferença quantidade</span><strong>${num(result.quantityDifference)} L</strong></div><div class="mini"><span>Valor esperado</span><strong>${money(result.expectedValue)}</strong></div><div class="mini"><span>Valor das NFs</span><strong>${money(result.invoiceValue)}</strong></div><div class="mini"><span>Diferença total</span><strong>${money(result.valueDifference)}</strong></div></div><p class="note">Tolerância de volume: ±${num(volumeTolerance())} L. Tolerância financeira aplicada ao total: ±${money(result.limit)}. O preço por litro é apenas diagnóstico.</p></div>`;
      $("#fiscalNotes").innerHTML=measurement.notasFiscais.map((note,index)=>{const pdfId=note.documentoPdfId||note.id,pdfPending=pendingFiles.has(`${pdfId}:pdf`);return `<section class="panel fiscal-note" data-fiscal-note="${index}"><div class="toolbar"><div><h3>NF ${esc(note.numero||`${index+1} · completar`)}</h3>${note.arquivada?`<p class="note">DANFE arquivado em ${new Date(note.arquivadaEm).toLocaleDateString("pt-BR")}. Consulte externamente pela chave NF-e.</p>`:""}${note.layoutStatus?`<p class="note">${note.layoutStatus==="recognized"?`Layout ${esc(note.layoutName)} · versão ${esc(note.layoutVersion)}`:"Layout não cadastrado ou inativo: confira a leitura e cadastre em Postos → Layouts de NF."}</p>`:""}<p class="note">${esc(note.origemLeitura||"Entrada manual")} · ${esc(note.arquivoNome||"")}</p>${currentImportErrors(note).length?`<p class="note bad-text">Conferir: ${esc(currentImportErrors(note).join("; "))}</p>`:""}</div>${note.arquivada?"":'<button type="button" class="btn small danger removeFiscalNote">Remover da medição</button>'}</div><div class="form-grid"><div class="field"><label>Número</label><input data-note-key="numero" value="${esc(note.numero)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Série</label><input data-note-key="serie" value="${esc(note.serie)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Chave NF-e</label><input data-note-key="chave" maxlength="44" value="${esc(note.chave)}" ${note.arquivada?"readonly":""}></div><div class="field"><label>CNPJ emitente</label><input data-note-key="cnpjEmitente" value="${esc(note.cnpjEmitente)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Razão social</label><input data-note-key="razaoSocial" value="${esc(note.razaoSocial)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Posto identificado</label><select data-note-key="postoId" ${note.arquivada?"disabled":""}><option value="">Posto não identificado</option>${(db.postos||[]).map(station=>`<option value="${esc(station.id)}" ${station.id===note.postoId?"selected":""}>${esc(station.codigo||station.id)} · ${esc(station.fantasia||station.razao)}</option>`).join("")}</select></div><div class="field"><label>Emissão</label><input data-note-key="emissao" type="date" value="${esc(note.emissao)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Saída</label><input data-note-key="dataSaida" type="date" value="${esc(note.dataSaida)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Quantidade total</label><input data-note-key="quantidadeTotal" type="number" step="0.001" value="${noteQuantity(note)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Valor total da NF</label><input data-note-key="valorTotal" type="number" step="0.01" value="${noteValue(note)}" ${note.arquivada?"disabled":""}></div><div class="field"><label>Vencimento principal</label><input data-note-key="vencimento" type="date" value="${esc(note.vencimento)}" ${note.arquivada?"disabled":""}>${note.arquivada?"":'<button type="button" class="btn small secondary replicateDueDate">Aplicar a todas as NFs</button><small>Aplica também às parcelas desta medição.</small>'}</div></div>${note.arquivada?"":`<div class="section-title">Itens da NF</div>${itemRows(note,index)}<button type="button" class="btn small secondary addFiscalItem">+ Adicionar item</button>${records(note.parcelas).length?`<details><summary>Parcelas e vencimentos (${note.parcelas.length})</summary><div class="table-wrap"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${note.parcelas.map(item=>`<tr><td>${esc(item.numero||"-")}</td><td>${dateBR(item.vencimento)}</td><td>${money(item.valor)}</td></tr>`).join("")}</tbody></table></div></details>`:""}${conferenceHtml(note,index)}`}<div class="toolbar fiscal-doc-links">${note.pdfDocumento?`<a class="btn small secondary viewFiscalPdf" target="_blank" data-document-id="${esc(pdfId)}" data-page="${note.pdfPaginaInicial||1}" href="/api/documents/${encodeURIComponent(pdfId)}?type=pdf#page=${note.pdfPaginaInicial||1}">${pdfPending?"Visualizar PDF (prévia)":"Visualizar PDF"}</a>`:""}${note.xmlDocumento?`<a class="btn small secondary" href="/api/documents/${encodeURIComponent(note.id)}?type=xml">Baixar XML</a>`:""}</div></section>`;}).join("") || '<div class="panel empty-state"><h3>Aguardando NF</h3><p>Adicione um XML de NF-e ou PDF DANFE para iniciar a conferência.</p></div>';
      const grouped={confirmed:[],ok:[],duplicate:[],error:[]};measurement.notasFiscais.forEach((note,index)=>{const entry={index,number:note.numero||`Sem número ${index+1}`,errors:noteChecks[index].errors};if(note.conferenciaConfirmada&&noteChecks[index].ok)grouped.confirmed.push(entry);else if(noteChecks[index].ok)grouped.ok.push(entry);else if(note.duplicada)grouped.duplicate.push(entry);else grouped.error.push(entry);});
      const summaryGroup=(title,items,className)=>`<section class="nf-summary-group ${className}"><div><strong>${title}</strong><span>${items.length}</span></div><div class="nf-number-list">${items.map(item=>`<button type="button" class="nf-summary-link" data-go-note-index="${item.index}" title="${esc(item.errors.length?item.errors.join(" · "):"Ir para o quadro desta NF")}" aria-label="Ir para o quadro da NF ${esc(item.number)}">NF ${esc(item.number)}</button>`).join("")||'<em>Nenhuma</em>'}</div></section>`;
      $("#fiscalNotesSummary").innerHTML=measurement.notasFiscais.length?`<div class="panel nf-final-summary"><h2>Resumo final das NFs</h2><p class="note">Clique no número da NF para ir diretamente ao quadro correspondente. NFs duplicadas não são contadas novamente como erro.</p><div class="nf-summary-grid">${summaryGroup("NF OK",grouped.ok,"summary-ok")}${summaryGroup("NFs confirmadas na medição",grouped.confirmed,"summary-confirmed")}${summaryGroup("NFs duplicadas",grouped.duplicate,"summary-duplicate")}${summaryGroup("NFs com erro",grouped.error,"summary-error")}</div></div>`:"";
      const showTreatment=result.status==="DIVERGENTE" || measurement.divergenciaAceita;
      $("#fiscalTreatment").innerHTML=showTreatment?`<div class="panel"><h2>Tratar divergência</h2><div class="form-grid"><div class="field"><label>Motivo</label><select id="fiscalReason">${["Quantidade divergente","Valor divergente","NF incorreta","Abastecimento incorreto","Abastecimento ausente","Produto incorreto","Posto incorreto","Documento duplicado","Arredondamento","Crédito/desconto","Acréscimo","Outro"].map(item=>`<option ${measurement.divergenciaMotivo===item?"selected":""}>${item}</option>`).join("")}</select></div><div class="field"><label>Decisão</label><select id="fiscalDecision"><option>Corrigir medição</option><option>Substituir NF</option><option ${measurement.divergenciaAceita?"selected":""}>Aceitar divergência</option><option>Cancelar medição</option></select></div><div class="field span-2"><label>Justificativa</label><textarea id="fiscalJustification">${esc(measurement.divergenciaJustificativa||"")}</textarea></div></div></div>`:"";
      $("#fiscalHistory").innerHTML=`<div class="panel"><details><summary>Histórico da medição (${records(measurement.historico).length})</summary>${records(measurement.historico).map(item=>`<p><strong>${new Date(item.data).toLocaleString("pt-BR")}</strong> — ${esc(item.usuario)} · ${esc(item.acao)}${item.detalhe?` · ${esc(item.detalhe)}`:""}</p>`).join("")||'<p class="muted">O histórico será iniciado ao salvar.</p>'}</details></div>`;
      const measureAll=$("#confirmMeasurement"),saveValid=$("#saveValidInvoices"),hasErrors=noteChecks.some(check=>!check.ok),hasPendingFuelings=unlinkedCount>0;measureAll.disabled=!allReady;measureAll.title=allReady?"Confirmar todas as NFs e concluir a medição":"Corrija as NFs sinalizadas antes de medir todas";saveValid.disabled=!(readyCount>0&&(hasErrors||hasPendingFuelings));saveValid.title=readyCount>0&&(hasErrors||hasPendingFuelings)?`Gravar ${readyCount} NF(s) conforme(s) e manter ${unlinkedCount} abastecimento(s) sem NF pendente(s)`:"Disponível quando houver NF conforme e outra NF com erro ou abastecimento sem NF";
      bindFields();
    }

    function changeDueDate(note,date) {
      const previous=note.vencimento||"";
      note.vencimentoOriginal ??= previous;
      note.vencimentoAjustado=date;
      note.vencimento=date;
      records(note.parcelas).forEach(item=>{item.vencimentoOriginal ??= item.vencimento||"";item.vencimento=date;});
      resetNoteConference(note);
      if(previous!==date)addHistory(measurement,"Vencimento alterado",`NF ${note.numero||"-"}: ${previous?dateBR(previous):"não informado"} → ${dateBR(date)}`);
    }

    function bindFields() {
      $$("[data-fiscal-note]").forEach(card=>{
        card.tabIndex=-1;
        const note=measurement.notasFiscais[Number(card.dataset.fiscalNote)];
        if(note.arquivada)return;
        card.querySelectorAll("[data-note-key]").forEach(input=>input.onchange=()=>{if(input.dataset.noteKey==="vencimento"){if(!input.value||!input.checkValidity()){input.value=note.vencimento||"";return toast("Informe um vencimento válido.");}changeDueDate(note,input.value);draw();return;}note[input.dataset.noteKey]=input.type==="number"?Number(input.value||0):input.value.trim();if(input.dataset.noteKey==="postoId")note.postoStatus=input.value?"IDENTIFICADO":"POSTO NÃO IDENTIFICADO";resetNoteConference(note,true);draw();});
        card.querySelector(".replicateDueDate").onmousedown=event=>event.preventDefault();
        card.querySelector(".replicateDueDate").onclick=()=>{
          const input=card.querySelector('[data-note-key="vencimento"]'),date=input.value;
          if(!date||!input.checkValidity())return toast("Informe um vencimento válido antes de aplicar.");
          measurement.notasFiscais.forEach(item=>changeDueDate(item,date));
          addHistory(measurement,"Vencimento aplicado a todas as NFs",`${dateBR(date)} · ${measurement.notasFiscais.length} NF(s), incluindo parcelas`);
          draw();toast("Vencimento aplicado a todas as NFs desta medição.");
        };
        card.querySelectorAll("[data-fiscal-item]").forEach(row=>{const [ni,ii]=row.dataset.fiscalItem.split(":").map(Number),item=measurement.notasFiscais[ni].itensFiscais[ii];row.querySelectorAll("[data-item-key]").forEach(input=>input.onchange=()=>{if(input.dataset.itemKey==="mappingMode")item.associacaoSomenteMedicao=input.value==="measurement";else item[input.dataset.itemKey]=input.type==="number"?Number(input.value||0):input.value;resetNoteConference(note,true);draw();});});
        card.querySelector(".addFiscalItem").onclick=()=>{note.itensFiscais ||= [];note.itensFiscais.push({id:uid("NFI"),codigoProdutoFiscal:"",descricao:"",unidade:"L",quantidade:0,valorUnitario:0,valorTotal:0,produtoDirectFuelId:"",associacaoSomenteMedicao:true});resetNoteConference(note,true);draw();};
        card.querySelector(".removeFiscalNote").onclick=()=>{if(isConfirmed(measurement.status)&&!(window.directFuelCanAction("medicoes","editar")))return alert("É necessária permissão de editar medições para remover NF de uma medição confirmada.");if(!confirm(`Remover a NF ${note.numero||"sem número"} desta medição?`))return;const documentId=note.documentoPdfId||note.id,shared=measurement.notasFiscais.some(item=>item!==note&&(item.documentoPdfId||item.id)===documentId);if(note.pdfDocumento&&!shared)removedDocuments.push({id:documentId,type:"pdf"});if(note.xmlDocumento)removedDocuments.push({id:note.id,type:"xml"});measurement.notasFiscais.splice(Number(card.dataset.fiscalNote),1);addHistory(measurement,"NF removida",note.numero||note.arquivoNome);draw();};
      });
      $$(".adjustFuelingLinks").forEach(button=>button.onclick=()=>adjustFuelingLinks(measurement.notasFiscais[Number(button.dataset.noteIndex)]));
      $$(".automaticFuelingLinks").forEach(button=>button.onclick=()=>{const note=measurement.notasFiscais[Number(button.dataset.noteIndex)];resetNoteConference(note,true);addHistory(measurement,"Vínculo automático restaurado",`NF ${note.numero||"-"}`);draw();});
      $$(".confirmFiscalNote").forEach(button=>button.onclick=()=>{const note=measurement.notasFiscais[Number(button.dataset.noteIndex)],check=noteConference(note);if(!check.ok)return alert(check.errors.join("\n"));note.conferenciaConfirmada=!note.conferenciaConfirmada;if(note.conferenciaConfirmada){note.conferidaPor=window.DIRECTFUEL_CURRENT_EMAIL;note.conferidaEm=now();addHistory(measurement,"NF confirmada",`NF ${note.numero||"-"} · ${check.linked.length} abastecimentos`);}else{delete note.conferidaPor;delete note.conferidaEm;addHistory(measurement,"Confirmação da NF desfeita",`NF ${note.numero||"-"}`);}draw();});
      $$("[data-go-note-index]").forEach(button=>button.onclick=()=>{const card=document.querySelector(`[data-fiscal-note="${Number(button.dataset.goNoteIndex)}"]`);if(!card)return;document.querySelectorAll(".fiscal-note-target").forEach(item=>item.classList.remove("fiscal-note-target"));card.scrollIntoView({behavior:"smooth",block:"start"});card.classList.add("fiscal-note-target");card.focus({preventScroll:true});setTimeout(()=>card.classList.remove("fiscal-note-target"),2400);});
      $$(".viewFiscalPdf").forEach(link=>link.onclick=event=>{const file=pendingFiles.get(`${link.dataset.documentId}:pdf`);if(!file)return;event.preventDefault();const previewUrl=URL.createObjectURL(file);window.open(`${previewUrl}#page=${link.dataset.page||1}`,"_blank","noopener");setTimeout(()=>URL.revokeObjectURL(previewUrl),300000);});
      if($("#fiscalReason"))$("#fiscalReason").onchange=event=>{measurement.divergenciaMotivo=event.target.value;};
      if($("#fiscalDecision"))$("#fiscalDecision").onchange=event=>{measurement.divergenciaAceita=event.target.value==="Aceitar divergência";draw();};
      if($("#fiscalJustification")){$("#fiscalJustification").oninput=event=>{measurement.divergenciaJustificativa=event.target.value;};$("#fiscalJustification").onchange=()=>draw();}
    }

    async function persist(mode,back) {
      if(fuelings.some(item=>!availableForMeasurement(item)))return alert("Um abastecimento já está vinculado a outra medição. Reabra a conferência antes de salvar.");
      measurement.numero=$("#fiscalMeasurementNumber").value.trim(); if(!measurement.numero)return toast("Informe o número da medição.");
      if($("#fiscalReason")){measurement.divergenciaMotivo=$("#fiscalReason").value;measurement.divergenciaJustificativa=$("#fiscalJustification").value.trim();const decision=$("#fiscalDecision").value;measurement.divergenciaAceita=decision==="Aceitar divergência";if(measurement.divergenciaAceita&&measurement.divergenciaJustificativa.length<5)return alert("Informe uma justificativa para aceitar a divergência.");if(measurement.divergenciaAceita&&!window.directFuelCanAction("medicoes","editar"))return alert("Somente usuários autorizados podem aceitar divergências acima da tolerância.");if(decision==="Cancelar medição")mode="cancel";}
      if(mode==="draft"){
        const checks=measurement.notasFiscais.map(note=>noteConference(note)),validChecks=checks.filter(check=>check.ok),invalidCount=checks.length-validChecks.length,validIds=new Set(validChecks.flatMap(check=>check.linked.map(fueling=>String(fueling.id)))),pendingCount=fuelings.filter(item=>!validIds.has(String(item.id))).length;
        if(validChecks.length&&(invalidCount||pendingCount)){
          if(!confirm(`Há ${validChecks.length} NF(s) conforme(s) e ${pendingCount} abastecimento(s) que devem permanecer pendentes. Gravar somente as NFs conformes e seus abastecimentos vinculados?`))return;
          mode="partial";
        }
      }
      let pendingBatch=null;
      if(mode==="partial"){
        const checked=measurement.notasFiscais.map(note=>({note,check:noteConference(note)})),valid=checked.filter(item=>item.check.ok),invalid=checked.filter(item=>!item.check.ok);
        const validIds=[...new Set(valid.flatMap(item=>item.check.linked.map(fueling=>String(fueling.id))))],validSet=new Set(validIds),pendingIds=fuelings.map(item=>String(item.id)).filter(id=>!validSet.has(id));
        if(!valid.length||(!invalid.length&&!pendingIds.length))return alert("A gravação parcial exige uma NF OK e outra NF com erro ou abastecimento ainda sem NF.");
        const candidate=structuredClone(measurement);candidate.notasFiscais=valid.map(item=>structuredClone(item.note));candidate.itens=validIds;candidate.status="Confirmado";candidate.notasFiscais.forEach(note=>{note.conferenciaConfirmada=true;note.conferidaPor=window.DIRECTFUEL_CURRENT_EMAIL;note.conferidaEm=now();});
        const issue=window.directFuelInvoiceIssue(candidate);if(issue)return alert(issue);
        for(const note of candidate.notasFiscais){const owner=duplicateOwner(note,candidate.id);if(owner)return alert(`NF já cadastrada na medição ${owner.numero}.`);for(const item of records(note.itensFiscais))if(item.produtoDirectFuelId&&!item.associacaoSomenteMedicao&&!agreementFor(candidate.postoId,item.produtoDirectFuelId,note.emissao))return alert(`Não existe acordo válido na data da NF para ${produtoNome(item.produtoDirectFuelId)} neste posto.`);}
        if(invalid.length)pendingBatch={id:uid("NFP"),origemMedicaoId:measurement.id,numeroMedicaoOrigem:measurement.numero,postoId:measurement.postoId,abastecimentoIds:pendingIds,notasFiscais:invalid.map(item=>structuredClone(item.note)),status:"Pendente de correção",criadoPor:window.DIRECTFUEL_CURRENT_EMAIL||"Sistema",criadoEm:now(),motivos:invalid.map(item=>({nf:item.note.numero||"Sem número",erros:item.check.errors}))};
        measurement.notasFiscais=candidate.notasFiscais;measurement.itens=validIds;measurement.status="Confirmado";measurement.confirmadoPor=window.DIRECTFUEL_CURRENT_EMAIL;measurement.confirmadoEm=now();addHistory(measurement,"Gravação parcial das NFs OK",`${valid.length} NF(s) realizada(s) · ${invalid.length} NF(s) com erro · ${pendingIds.length} abastecimento(s) liberado(s) para medição futura`);
      }
      for(const note of measurement.notasFiscais){const owner=duplicateOwner(note,measurement.id);if(owner)return alert(`NF já cadastrada na medição ${owner.numero}.`);for(const item of records(note.itensFiscais)){if(item.produtoDirectFuelId&&!item.associacaoSomenteMedicao){const agreement=agreementFor(measurement.postoId,item.produtoDirectFuelId,note.emissao);if(!agreement)return alert(`Não existe acordo válido na data da NF para ${produtoNome(item.produtoDirectFuelId)} neste posto.`);agreement.fiscalProductMappings ||= [];const existingMap=agreement.fiscalProductMappings.find(map=>fiscalCode(map.codigoProdutoFiscal)===fiscalCode(item.codigoProdutoFiscal));const data={id:existingMap?.id||uid("DPF"),produtoDirectFuelId:item.produtoDirectFuelId,codigoProdutoFiscal:String(item.codigoProdutoFiscal||"").trim(),descricaoProdutoFiscal:item.descricao||"",unidade:item.unidade||"L",ativo:true};if(existingMap)Object.assign(existingMap,data);else agreement.fiscalProductMappings.push(data);item.acordoId=agreement.id;}}
      }
      const result=measurementResult(measurement);
      if(mode==="confirm") {const issue=window.directFuelInvoiceIssue(measurement);if(issue)return alert(issue);measurement.status="Confirmado";measurement.confirmadoPor=window.DIRECTFUEL_CURRENT_EMAIL;measurement.confirmadoEm=now();addHistory(measurement,"Medição confirmada",result.status);}
      else if(mode==="cancel"){if(isConfirmed(measurement.status)&&!(window.directFuelCanAction("medicoes","editar")))return alert("É necessária permissão de editar medições para cancelar uma medição confirmada.");measurement.status="Cancelada";measurement.canceladoPor=window.DIRECTFUEL_CURRENT_EMAIL;measurement.canceladoEm=now();addHistory(measurement,"Medição cancelada",measurement.divergenciaJustificativa||"");}
      else if(mode!=="partial") {measurement.status=result.status==="AGUARDANDO NF"?"Aguardando NF":result.status;addHistory(measurement,existing?"Medição atualizada":"Medição criada",result.status);}
      const button=back.querySelector("#modalSave")||back.querySelector(".btn.primary");if(button)button.disabled=true;
      try {for(const [key,file] of pendingFiles){const [id,type]=key.split(":");await uploadDocument(id,type,file);for(const note of measurement.notasFiscais){const belongs=type==="pdf"?(note.documentoPdfId||note.id)===id:note.id===id;if(belongs){note[type+"Documento"]=true;note[type+"Nome"]=file.name;}}}for(const item of removedDocuments)await fetch(`/api/documents/${encodeURIComponent(item.id)}?type=${item.type}`,{method:"DELETE"});
        const finalResult=measurementResult(measurement),finalFuelings=finalResult.fuelings;Object.assign(measurement,{qt:finalResult.expectedQuantity,valor:finalResult.expectedValue,qtNf:finalResult.invoiceQuantity,valorNf:finalResult.invoiceValue,nf:measurement.notasFiscais.map(note=>note.numero).filter(Boolean).join("; "),emissao:measurement.notasFiscais.map(note=>note.emissao).filter(Boolean).sort()[0]||"",vencimento:measurement.notasFiscais.flatMap(note=>[note.vencimento,...records(note.parcelas).map(item=>item.vencimento)]).filter(Boolean).sort()[0]||"",inicio:finalFuelings.map(item=>item.data).filter(Boolean).sort()[0]||dates[0],fim:finalFuelings.map(item=>item.data).filter(Boolean).sort().at(-1)||dates.at(-1),unidadeIds:[...new Set(finalFuelings.map(item=>item.unidadeId))],produtoIds:[...new Set(finalFuelings.map(item=>item.produtoId))],salvoPor:window.DIRECTFUEL_CURRENT_EMAIL,salvoEm:now()});delete measurement.nfPendenciaId;
        const nextPending=records(db.nfPendencias).slice();if(pendingBatch)nextPending.push(pendingBatch);if(sourcePendingId){const source=nextPending.find(item=>item.id===sourcePendingId);if(source){source.status="Resolvida";source.resolvidaPor=window.DIRECTFUEL_CURRENT_EMAIL||"Sistema";source.resolvidaEm=now();source.medicaoDestinoId=measurement.id;}}db.nfPendencias=nextPending;const original=(db.medicoes||[]).find(item=>item.id===measurement.id);if(original)Object.assign(original,measurement);else db.medicoes.push(measurement);const measuredIds=new Set(records(measurement.itens).map(String));fuelings.forEach(item=>item.medicaoId=mode==="cancel"||!measuredIds.has(String(item.id))?null:measurement.id);audit(mode==="confirm"?"Confirmação":mode==="partial"?"Gravação parcial":mode==="cancel"?"Cancelamento":existing?"Edição":"Criação","Medição",`${measurement.numero} · ${finalResult.status}`);save(mode==="confirm"?"Medição confirmada":mode==="partial"?"NFs OK gravadas; demais mantidas pendentes":mode==="cancel"?"Medição cancelada":"Medição salva");back.remove();render();
      }catch(error){alert(error.message);if(button)button.disabled=false;}
    }
    $("#fiscalFiles").onchange=event=>readFiles([...event.target.files]);
    $("#manualFiscalNote").onclick=()=>{measurement.notasFiscais.push({id:uid("NF"),origemLeitura:"Entrada manual",numero:"",serie:"",chave:"",cnpjEmitente:"",razaoSocial:"",emissao:"",dataSaida:"",vencimento:"",quantidadeTotal:0,valorTotal:0,itensFiscais:[],parcelas:[],postoId:measurement.postoId,postoStatus:"IDENTIFICADO"});draw();};
    $("#reprocessFiscal").onclick=async()=>{
      const button=$("#reprocessFiscal"),status=$("#fiscalProcessing"),documentIds=[...new Set(measurement.notasFiscais.filter(note=>note.pdfDocumento&&note.documentoPdfId).map(note=>note.documentoPdfId))];
      button.disabled=true;status.hidden=false;importPreview.pages=0;importPreview.found=0;importPreview.valid=0;importPreview.duplicates=0;importPreview.errors=[];
      try {
        for (const documentId of documentIds) {
          const oldNotes=measurement.notasFiscais.filter(note=>note.documentoPdfId===documentId),firstIndex=measurement.notasFiscais.findIndex(note=>note.documentoPdfId===documentId),pending=pendingFiles.get(`${documentId}:pdf`);
          let file=pending;
          if (!file) {
            const response=await fetch(`/api/documents/${encodeURIComponent(documentId)}?type=pdf`);
            if (!response.ok) throw new Error(`Não foi possível abrir ${oldNotes[0]?.pdfNome || "o PDF salvo"}.`);
            const blob=await response.blob();file=new File([blob],oldNotes[0]?.pdfNome || "DANFE.pdf",{type:"application/pdf"});
          }
          const parsed=await parsePdf(file,(page,total)=>{status.textContent=`Relendo ${file.name} · página ${page} de ${total}…`;},measurement.postoId,documentId);
          for(const note of parsed.notes){const previous=oldNotes.find(old=>digits(old.chave).length===44&&digits(old.chave)===digits(note.chave))||oldNotes.find(old=>old.numero&&old.numero===note.numero&&old.serie===note.serie);if(previous?.vencimentoAjustado){note.vencimentoOriginal=previous.vencimentoOriginal;changeDueDate(note,previous.vencimentoAjustado);}}
          measurement.notasFiscais=measurement.notasFiscais.filter(note=>note.documentoPdfId!==documentId);
          measurement.notasFiscais.splice(Math.max(0,firstIndex),0,...parsed.notes);
          importPreview.pages+=parsed.pageCount;importPreview.found+=parsed.notes.length;
          for (const note of parsed.notes) {
            const errors=currentImportErrors(note);if(errors.length)importPreview.errors.push({arquivo:file.name,paginas:[note.pdfPaginaInicial,note.pdfPaginaFinal].filter(Boolean),nf:note.numero||"",mensagens:errors});else importPreview.valid++;
          }
        }
        for(const note of measurement.notasFiscais.filter(note=>!note.pdfDocumento)){const matches=findStation(note.cnpjEmitente);if(matches.length===1){note.postoId=matches[0].id;note.postoStatus="IDENTIFICADO";}for(const item of records(note.itensFiscais)){const mapped=mappingFor(measurement.postoId,item.codigoProdutoFiscal,note.emissao);if(mapped){item.produtoDirectFuelId=mapped.mapping.produtoDirectFuelId;item.acordoId=mapped.agreement.id;}}}
        addHistory(measurement,"PDFs e De/Para reprocessados",`${importPreview.found} NFs`);
      } catch(error) { importPreview.errors.push({arquivo:"Reprocessamento",paginas:[],nf:"",mensagens:[error.message]}); }
      finally {button.disabled=false;status.hidden=true;draw();}
    };
    $("#confirmMeasurement").onclick=()=>{const checks=measurement.notasFiscais.map(note=>noteConference(note)),invalid=checks.find(check=>!check.ok),linked=measurement.notasFiscais.flatMap(note=>records(note.abastecimentoIds).map(String));if(invalid)return alert(invalid.errors.join("\n"));if(new Set(linked).size!==fuelings.length||linked.length!==new Set(linked).size)return alert("Todos os abastecimentos devem estar vinculados uma única vez às NFs.");for(const note of measurement.notasFiscais){note.conferenciaConfirmada=true;note.conferidaPor=window.DIRECTFUEL_CURRENT_EMAIL;note.conferidaEm=now();}addHistory(measurement,"Todas as NFs confirmadas",`${measurement.notasFiscais.length} NFs`);persist("confirm",document.querySelector(".modal-back"));};
    $("#saveValidInvoices").onclick=()=>{const checks=measurement.notasFiscais.map(note=>noteConference(note)),validChecks=checks.filter(check=>check.ok),valid=validChecks.length,invalid=checks.length-valid,validIds=new Set(validChecks.flatMap(check=>check.linked.map(fueling=>String(fueling.id)))),pendingCount=fuelings.filter(item=>!validIds.has(String(item.id))).length;if(!valid||(!invalid&&!pendingCount))return alert("É necessário ter uma NF OK e outra NF com erro ou abastecimento ainda sem NF.");if(confirm(`Gravar ${valid} NF(s) OK com somente os abastecimentos vinculados e manter ${pendingCount} abastecimento(s) disponível(is) em Medições pendentes?`))persist("partial",document.querySelector(".modal-back"));};
    $("#cancelMeasurement").onclick=()=>{if(confirm("Cancelar a medição e liberar os abastecimentos?"))persist("cancel",document.querySelector(".modal-back"));};draw();
  };

  const baseDocuments = documentos;
  documentos = function () {
    baseDocuments();
    const documentRows=(db.medicoes||[]).flatMap(measurement=>noteList(measurement).filter(note=>note.pdfDocumento||note.xmlDocumento||note.documentoPdfId).map(note=>`<tr><td>${esc(measurement.numero)}</td><td>${esc(postoNome(measurement.postoId))}</td><td>${esc(note.numero||"-")}</td><td>${esc(note.pdfNome||note.xmlNome||note.danfeNome||"-")}</td><td>${note.pdfDocumento||note.documentoPdfId?`<a class="btn small secondary" target="_blank" href="/api/documents/${encodeURIComponent(note.documentoPdfId||note.id)}?type=pdf#page=${note.pdfPaginaInicial||1}">PDF</a>`:""} ${note.xmlDocumento?`<a class="btn small secondary" href="/api/documents/${encodeURIComponent(note.id)}?type=xml">XML</a>`:""}</td></tr>`));
    if(documentRows.length)$("#view").insertAdjacentHTML("beforeend",`<div class="panel"><h2>Notas fiscais por medição</h2><div class="table-wrap"><table><thead><tr><th>Medição</th><th>Posto</th><th>NF</th><th>Documento</th><th>Ações</th></tr></thead><tbody>${documentRows.join("")}</tbody></table></div></div>`);
  };
})();
