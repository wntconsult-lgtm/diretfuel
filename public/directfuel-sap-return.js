(() => {
  const txt = value => String(value ?? "").trim();
  const code = value => txt(value).replace(/^0+(?=\d)/, "");
  const nf = value => txt(value).split("-").map(code).join("-");
  const nfNumber = value => code(txt(value).split("-")[0]);
  const signature = row => JSON.stringify([code(row.material), txt(row.centro), Number(row.quantidade), Number(row.preco)]);
  const noteKey = note => nf(`${note.numero}-${note.serie}`);
  const normalizeHeader = value => txt(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
  const isoDate = value => {
    let date = value;
    if (typeof date === "number") date = new Date(Date.UTC(1899, 11, 30) + date * 86400000);
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const raw = txt(date);
    const iso = /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw.split("/").reverse().join("-") : /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) ? raw.slice(0, 10) : "";
    if (iso) {
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso) return iso;
    }
    return "";
  };

  function invoiceDueDate(note = {}, measurement = {}) {
    const dates = [note.vencimento, ...(Array.isArray(note.parcelas) ? note.parcelas.map(item => item?.vencimento) : [])]
      .map(isoDate)
      .filter(Boolean)
      .sort();
    if (dates.length) return dates[0];
    return (measurement.notasFiscais || []).length <= 1 ? isoDate(measurement.vencimento) : "";
  }

  function matchesDueDate(invoice, from, to) {
    const start = isoDate(from), end = isoDate(to);
    if (!start && !end) return true;
    const due = isoDate(invoice?.dueDate);
    return Boolean(due && (!start || due >= start) && (!end || due <= end));
  }

  function invoices(state) {
    return (state.medicoes || []).flatMap(measurement => (measurement.notasFiscais || []).map(note => ({
      m: measurement,
      n: note,
      key: noteKey(note),
      number: nfNumber(note.numero),
      supplier: code((state.postos || []).find(station => station.id === measurement.postoId)?.sap),
      date: txt(note.emissao || note.dataEmissao).slice(0, 10),
      dueDate: invoiceDueDate(note, measurement),
      lines: (state.abastecimentos || [])
        .filter(fueling => (measurement.itens || []).includes(fueling.id) && ((note.abastecimentoIds || []).includes(fueling.id) || (measurement.notasFiscais || []).length === 1))
        .map(fueling => ({
          material: (state.produtos || []).find(product => product.id === fueling.produtoId)?.sap,
          centro: (state.unidades || []).find(unit => unit.id === (fueling.unidadeId || ((measurement.unidadeIds || []).length === 1 ? measurement.unidadeIds[0] : "")))?.centroSap,
          quantidade: fueling.qt,
          preco: fueling.preco,
        })),
    })));
  }

  function parsePurchaseReport(rows, sheet) {
    const required = ["documento de compras", "fornecedor do pedido", "nº da nota fiscal", "data do lancamento da nota fiscal"];
    const headerIndex = rows.findIndex(row => {
      const headers = row.map(normalizeHeader);
      return required.every(label => headers.includes(label));
    });
    if (headerIndex < 0) return null;
    const headers = rows[headerIndex].map(normalizeHeader);
    const at = label => headers.indexOf(label);
    const columns = {
      requestDate: at("data de criacao da requisicao"),
      requestItemStatus: at("status item material requisicao"),
      purchaseOrder: at("documento de compras"),
      purchaseOrderDate: at("data de criacao do pedido"),
      supplier: at("fornecedor do pedido"),
      purchaseOrderStatus: at("status do pedido"),
      materialDocument: at("documento do item de saida nft /entrada"),
      invoiceNumber: at("nº da nota fiscal"),
      postingDate: at("data do lancamento da nota fiscal"),
    };
    const parsed = rows.slice(headerIndex + 1).flatMap((row, index) => {
      if (!row.some(value => txt(value))) return [];
      const purchaseOrder = txt(row[columns.purchaseOrder]);
      const supplier = code(row[columns.supplier]);
      const invoiceNumber = nfNumber(row[columns.invoiceNumber]);
      const postingDateRaw = txt(row[columns.postingDate]);
      const postingDate = isoDate(row[columns.postingDate]);
      return [{
        sheet,
        row: index + headerIndex + 2,
        sourceRows: [index + headerIndex + 2],
        source: "sap-purchase-report",
        purchaseOrder,
        supplier,
        invoiceNumber,
        nf: invoiceNumber,
        postingDate,
        requestDate: isoDate(row[columns.requestDate]),
        requestItemStatus: txt(row[columns.requestItemStatus]),
        purchaseOrderDate: isoDate(row[columns.purchaseOrderDate]),
        purchaseOrderStatus: txt(row[columns.purchaseOrderStatus]),
        materialDocument: txt(row[columns.materialDocument]),
        status: purchaseOrder && supplier && invoiceNumber && (!postingDateRaw || postingDate) ? "success" : "error",
        message: purchaseOrder ? `Pedido de compra ${purchaseOrder}${postingDate ? ` · lançamento ${postingDate}` : " · aguardando MIRO"}` : "Linha SAP incompleta",
      }];
    });
    const unique = new Map();
    for (const row of parsed) {
      const key = JSON.stringify([row.purchaseOrder, row.supplier, row.invoiceNumber, row.postingDate]);
      const existing = unique.get(key);
      if (existing) existing.sourceRows.push(row.row);
      else unique.set(key, row);
    }
    return [...unique.values()];
  }

  function parseLegacyReturn(rows, sheet) {
    const header = rows.findIndex(row => txt(row[22]).toLowerCase() === "retorno" && txt(row[12]).toLowerCase().includes("nf"));
    if (header < 0) return null;
    return rows.slice(header + 1).flatMap((row, index) => {
      if (!row.some(value => txt(value))) return [];
      const date = isoDate(row[13]);
      const message = txt(row[22]);
      const match = message.match(/^Requisi[çc][ãa]o de compra criada sob n[º°o.]?\s*(\d+)\s*$/i);
      return [{sheet, row: index + header + 2, material: txt(row[1]), quantidade: Number(row[3]), preco: Number(row[4]), centro: txt(row[5]), supplier: code(row[7]), nf: nf(row[12]), date, message, requisition: match?.[1] || "", status: match ? "success" : "error"}];
    });
  }

  function parse(rows, sheet) {
    const result = parsePurchaseReport(rows, sheet) ?? parseLegacyReturn(rows, sheet);
    if (!result) throw Error(`Aba ${sheet}: cabeçalhos do relatório SAP não encontrados.`);
    return result;
  }

  function purchasePreview(state, rows) {
    const notes = invoices(state);
    const seen = (state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder);
    return rows.map(row => {
      let issue = "";
      const identity = notes.filter(note => note.m.status === "Aprovada" && note.supplier === row.supplier && note.number === row.invoiceNumber && (!row.measurementId || String(note.m.id) === String(row.measurementId)));
      const match = identity.length === 1 ? identity[0] : undefined;
      if (row.status !== "success") issue = "Pedido, fornecedor ou NF ausente";
      else if (!identity.length) issue = "NF não encontrada pelo fornecedor e número";
      else if (identity.length > 1) issue = `NF ambígua: o SAP não informa a série e há ${identity.length} notas compatíveis. Confira ${[...new Set(identity.map(note => note.m.numero || note.m.id))].join(", ")}.`;
      const record = {...row, measurementId: match?.m.id || "", invoiceKey: match?.key || ""};
      if (!issue) {
        const duplicate = seen.some(saved => saved.measurementId === record.measurementId && saved.invoiceKey === record.invoiceKey && String(saved.purchaseOrder) === String(record.purchaseOrder) && saved.postingDate === record.postingDate);
        if (duplicate) issue = "Já importado";
        else {
          const posted = seen.find(saved => saved.measurementId === record.measurementId && saved.invoiceKey === record.invoiceKey && isoDate(saved.postingDate));
          if (posted) {
            const postedDate = isoDate(posted.postingDate).split("-").reverse().join("/");
            issue = `NF já lançada no SAP em ${postedDate}; nova carga bloqueada`;
          }
        }
      }
      if (!issue) seen.push(record);
      return {...record, issue};
    });
  }

  function legacyPreview(state, rows) {
    const notes = invoices(state), seen = (state.sapReturns || []).filter(record => !record.voided);
    return rows.map(row => {
      let issue = "";
      const identity = notes.filter(note => note.supplier === row.supplier && note.key === row.nf && note.date === row.date && (!row.measurementId || String(note.m.id) === String(row.measurementId)));
      const approved = identity.filter(note => note.m.status === "Aprovada");
      const candidates = approved.filter(note => note.lines.some(line => signature(line) === signature(row)));
      const match = candidates.length === 1 ? candidates[0] : undefined;
      if (!row.message) issue = "Sem retorno";
      else if (!identity.length) issue = "NF não encontrada";
      else if (!approved.length) issue = "Medição não aprovada";
      else if (!candidates.length) issue = "Material, centro, quantidade ou preço divergente";
      else if (candidates.length !== 1) issue = `NF ambígua: mais de um vínculo compatível em ${[...new Set(candidates.map(value => value.m.numero || value.m.id))].join(", ")}.`;
      const record = {...row, measurementId: match?.m.id || "", invoiceKey: match?.key || "", signature: signature(row)};
      if (!issue) {
        const same = seen.filter(saved => saved.requisition && saved.requisition === row.requisition);
        if (same.some(saved => saved.measurementId !== record.measurementId || saved.invoiceKey !== record.invoiceKey)) issue = "Requisição já vinculada a outra NF";
        else if (seen.some(saved => saved.measurementId === record.measurementId && saved.invoiceKey === record.invoiceKey && saved.signature === record.signature && saved.message === row.message)) issue = "Já importado";
        else if (row.status === "success" && seen.filter(saved => saved.status === "success" && saved.measurementId === record.measurementId && saved.invoiceKey === record.invoiceKey && saved.signature === record.signature).length >= match.lines.filter(line => signature(line) === record.signature).length) issue = "Linha já possui requisição; conferir duplicidade no SAP";
      }
      if (!issue) seen.push(record);
      return {...record, issue};
    });
  }

  function preview(state, rows) {
    return rows.some(row => row.source === "sap-purchase-report" || row.purchaseOrder) ? purchasePreview(state, rows) : legacyPreview(state, rows);
  }

  function purchaseOutcome(row) {
    if (row.issue) return `Bloqueado — ${row.issue}`;
    return row.postingDate ? "Lançada no SAP" : "Pedido vinculado — aguardando MIRO";
  }

  function status(state, invoice) {
    const all = (state.sapReturns || []).filter(record => !record.voided && record.measurementId === invoice.m.id && record.invoiceKey === invoice.key && !record.purchaseOrder);
    const success = all.filter(record => record.status === "success");
    if (invoice.lines.length && invoice.lines.every(line => success.filter(record => record.signature === signature(line)).length >= invoice.lines.filter(value => signature(value) === signature(line)).length)) return "RC criada";
    return success.length ? "Parcial" : all.length ? "Erro" : "Sem retorno";
  }

  function purchaseOrders(state, invoice) {
    return [...new Set((state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && record.measurementId === invoice.m.id && record.invoiceKey === invoice.key).map(record => txt(record.purchaseOrder)).filter(Boolean))];
  }

  function postingStatus(state, invoice) {
    const records = (state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && record.measurementId === invoice.m.id && record.invoiceKey === invoice.key);
    if (records.some(record => isoDate(record.postingDate))) return "Lançada no SAP";
    return records.length ? "Pedido vinculado — aguardando MIRO" : "Sem pedido";
  }

  function manualPurchase(state, target, purchaseOrder, postingDate, reason, confirmed) {
    const matches = invoices(state).filter(invoice => String(invoice.m.id) === String(target.measurementId) && invoice.key === target.invoiceKey);
    if (matches.length !== 1) throw Error("NF não encontrada ou ambígua. Atualize a tela.");
    const invoice = matches[0];
    if (invoice.m.status !== "Aprovada") throw Error("A medição precisa estar aprovada.");
    if (!invoice.supplier || !/^\d+$/.test(invoice.supplier)) throw Error("Cadastre o código SAP do fornecedor no posto.");
    if (!/^\d{1,20}$/.test(txt(purchaseOrder))) throw Error("Informe um Pedido de Compra válido, somente com dígitos.");
    const postedAt = txt(postingDate);
    if (postedAt && (!isoDate(postedAt) || isoDate(postedAt) !== postedAt)) throw Error("Informe uma data de lançamento válida.");
    if (txt(reason).length < 5) throw Error("Informe uma observação com pelo menos 5 caracteres.");
    if (confirmed !== true) throw Error("Confirme que os dados informados foram conferidos no SAP.");
    const active = (state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && record.measurementId === invoice.m.id && record.invoiceKey === invoice.key);
    if (active.some(record => isoDate(record.postingDate))) throw Error("Esta NF já possui lançamento no SAP. Confira o Histórico SAP.");
    const orders = [...new Set(active.map(record => txt(record.purchaseOrder)).filter(Boolean))];
    if (orders.length && (orders.length > 1 || orders[0] !== txt(purchaseOrder))) throw Error(`Esta NF já está vinculada ao pedido ${orders.join(", ")}.`);
    if (active.some(record => txt(record.purchaseOrder) === txt(purchaseOrder) && txt(record.postingDate) === postedAt)) throw Error(postedAt ? "Este pedido e lançamento já estão vinculados à NF." : "Este pedido já está vinculado à NF.");
    return {source:"manual-purchase", measurementId:invoice.m.id, invoiceKey:invoice.key, invoiceNumber:invoice.number, nf:invoice.number, supplier:invoice.supplier, purchaseOrder:txt(purchaseOrder), postingDate:postedAt, status:"success", reason:txt(reason), confirmed:true, sheet:"Vínculo manual", row:1, sourceRows:[1], filename:"Vínculo manual", message:`Pedido de compra ${txt(purchaseOrder)}${postedAt ? ` · lançamento ${postedAt}` : " · aguardando MIRO"} · ${txt(reason)}`};
  }

  function batch(state, targets, requisition, reason) {
    if (!/^\d{1,20}$/.test(requisition)) throw Error("Informe uma RC SAP válida, somente com dígitos.");
    if (txt(reason).length < 5) throw Error("Informe uma observação com pelo menos 5 caracteres.");
    if (!targets.length) throw Error("Selecione ao menos uma NF.");
    const current = invoices(state), selected = targets.map(target => {
      const matches = current.filter(invoice => invoice.m.id === target.measurementId && invoice.key === target.invoiceKey);
      if (matches.length !== 1) throw Error("NF não encontrada ou ambígua.");
      return matches[0];
    });
    if (new Set(targets.map(target => JSON.stringify([target.measurementId, target.invoiceKey]))).size !== targets.length) throw Error("NF selecionada mais de uma vez.");
    return selected.flatMap(invoice => {
      if (invoice.m.status !== "Aprovada" || status(state, invoice) !== "Sem retorno") throw Error(`NF ${invoice.key}: somente Sem Lançamento pode ser vinculada em lote.`);
      if (!invoice.lines.length || !invoice.supplier || !invoice.date) throw Error(`NF ${invoice.key}: faltam dados para vincular a RC.`);
      return invoice.lines.map((line, index) => ({...line, measurementId: invoice.m.id, invoiceKey: invoice.key, nf: invoice.key, supplier: invoice.supplier, date: invoice.date, signature: signature(line), lineKey: String(index), sheet: "Vínculo em lote", row: index + 1, message: `Requisição de compra criada sob nº ${requisition}`, requisition, status: "success", source: "manual-batch", reason: txt(reason), confirmed: true, filename: "Vínculo manual em lote"}));
    });
  }

  window.DirectFuelSapReturn = {invoices, parse, preview, purchasePreview, purchaseOutcome, status, postingStatus, purchaseOrders, batch, nfNumber, manualPurchase, invoiceDueDate, matchesDueDate};
})();

(() => {
 const txt=v=>String(v??'').trim();
 function build(state,invoices,orders={}){
  const errors=[],rows=[],seen=new Set(),p=state.config?.params||{},category=txt(p.miroCategoriaNF??'Z1').toUpperCase(),cfop=txt(p.miroCFOP).replace(/\./g,'');
  if(!/^[A-Z0-9]{1,4}$/.test(category))errors.push('Configure a Categoria NF do layout MIRO.');
  if(!/^[123567]\d{3}$/.test(cfop))errors.push('Configure o CFOP do layout MIRO com quatro dígitos.');
  for(const invoice of invoices){
   const {m,n}=invoice,label=invoice.key;
   const sapStatus=window.DirectFuelSapReturn.postingStatus(state,invoice);
   if(m.status!=='Aprovada'||sapStatus==='Lançada no SAP'){errors.push(`${label}: somente NF aprovada e ainda não lançada no SAP.`);continue;}
   const linkedOrders=window.DirectFuelSapReturn.purchaseOrders(state,invoice),fallback=txt(orders[`${m.id}|${invoice.key}`]??n.miroPedido??''),order=linkedOrders.length===1?linkedOrders[0]:fallback;
   const key=txt(n.chave||n.chaveAcesso).replace(/\s/g,''),number=txt(n.numero),series=txt(n.serie),date=txt(n.emissao||n.dataEmissao).slice(0,10),value=Number(n.valorTotal??n.total),supplier=txt((state.postos||[]).find(s=>s.id===m.postoId)?.sap);
   if(!/^\d{44}$/.test(key))errors.push(`${label}: chave DANFE deve conter 44 dígitos.`);
   if(!/^\d+$/.test(number)||!/^\d+$/.test(series))errors.push(`${label}: informe número e série da NF.`);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)errors.push(`${label}: emissão inválida.`);
   if(!(value>0&&Number.isFinite(value)))errors.push(`${label}: valor total da NF inválido.`);
   if(linkedOrders.length>1)errors.push(`${label}: existem múltiplos pedidos vinculados. Revise o Histórico SAP.`);
   if(!/^\d{1,20}$/.test(order))errors.push(`${label}: pedido de compra não vinculado. Importe o relatório SAP ou use Vincular pedido.`);
   if(!supplier)errors.push(`${label}: fornecedor sem código SAP.`);
   const identity=key||`${supplier}|${number}|${series}`;
   if(seen.has(identity)){errors.push(`${label}: NF duplicada na seleção.`);continue;}seen.add(identity);
   rows.push({'Pedido de compra':order,'Data emissão NF':date.split('-').reverse().join('/'),'Número da NF':`${number}-${series}`,'Valor total da NF':value,'Chave DANFE':key,'Código numérico da chave':key.slice(-9,-1),'Categoria NF':category,'CFOP':cfop,'Fornecedor SAP':supplier});
  }
  if(!invoices.length)errors.push('Marque as NFs sem lançamento que deseja exportar.');
  return {rows,errors,total:rows.reduce((s,r)=>s+r['Valor total da NF'],0)};
 }
 window.DirectFuelMiro={build};
})();
