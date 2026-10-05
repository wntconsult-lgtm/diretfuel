(() => {
  const relationLabel = record => record.purchaseOrder || record.requisition || "Registro SAP";
  const relationKey = record => JSON.stringify([String(record.measurementId), String(record.invoiceKey), String(relationLabel(record)), String(record.postingDate || "")]);
  window.DirectFuelBulkRc = {
    groups(state, notes) {
      const wanted = new Map(notes.map(note => [JSON.stringify([String(note.m.id), String(note.key)]), note])), groups = new Map();
      for (const record of state.sapReturns || []) {
        const note = wanted.get(JSON.stringify([String(record.measurementId), String(record.invoiceKey)]));
        if (!note || record.voided) continue;
        const key = relationKey(record);
        if (!groups.has(key)) groups.set(key, {key, measurementId: record.measurementId, measurementNumber: note.m.numero || note.m.id, invoiceKey: record.invoiceKey, label: relationLabel(record), postingDate: record.postingDate || "", records: []});
        groups.get(key).records.push(record);
      }
      return [...groups.values()];
    },
    records(state, groups) {
      const keys = new Set(groups.map(group => group.key));
      return (state.sapReturns || []).filter(record => !record.voided && keys.has(relationKey(record)));
    },
  };

  const api = window.DirectFuelSapReturn;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
  const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value).split("-").reverse().join("/") : String(value || "—");
  const nfRecords = invoice => (db.sapReturns || []).filter(record => record.measurementId === invoice.m.id && record.invoiceKey === invoice.key);

  async function ensureExcel() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/gekon-xlsx.js";
      script.onload = resolve;
      script.onerror = () => reject(Error("Não foi possível carregar o Excel."));
      document.head.append(script);
    });
  }

  async function load(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast("Selecione um arquivo de até 20 MB.");
    try {
      await ensureExcel();
      const book = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
      const rows = book.SheetNames.flatMap(name => {
        const values = XLSX.utils.sheet_to_json(book.Sheets[name], {header: 1, defval: "", raw: true});
        try { return api.parse(values, name).filter(row => row.source === "sap-purchase-report"); }
        catch { return []; }
      });
      if (!rows.length) throw Error("O arquivo não contém o layout esperado: Documento de Compras, Fornecedor do Pedido, Nº da Nota Fiscal e Data do Lançamento da Nota Fiscal. A data pode estar vazia antes da MIRO.");
      const preview = api.purchasePreview(db, rows);
      const sourceCount = rows.reduce((total, row) => total + (row.sourceRows || [row.row]).length, 0);
      const repeatedCount = sourceCount - rows.length;
      modal("Conferir pedidos e lançamentos SAP", `<p><strong>${preview.filter(row => !row.issue).length} vínculo(s) apto(s)</strong> de ${preview.length}. ${sourceCount} linha(s) lida(s), ${repeatedCount} repetição(ões) consolidada(s). Fornecedor, NF e pedido são obrigatórios na mesma linha. Sem data de lançamento, o pedido fica aguardando MIRO; com a data, a NF passa para Lançada no SAP.</p><div class="table-wrap"><table><thead><tr><th>Aba / linha(s)</th><th>Fornecedor</th><th>NF informada na planilha</th><th>NF localizada no DirectFuel</th><th>Pedido de Compra</th><th>Data Lançamento NF SAP</th><th>Situação após importar</th><th>Conferência</th></tr></thead><tbody>${preview.map(row => `<tr><td>${esc(row.sheet)} / ${esc((row.sourceRows || [row.row]).join(", "))}</td><td>${esc(row.supplier || "—")}</td><td>${esc(row.invoiceNumber || "—")}</td><td>${esc(row.invoiceKey || "—")}</td><td>${esc(row.purchaseOrder || "—")}</td><td>${esc(dateBR(row.postingDate))}</td><td>${esc(api.purchaseOutcome(row))}</td><td>${esc(row.issue || `Apto — NF ${row.invoiceKey} informada e localizada`)}</td></tr>`).join("")}</tbody></table></div>`, back => {
        if (!window.directFuelCanAction("medicoes", "incluir")) return toast("Seu acesso não permite importar lançamentos SAP.");
        const fresh = api.purchasePreview(db, rows);
        if (JSON.stringify(fresh) !== JSON.stringify(preview)) { back.remove(); return toast("Os dados foram alterados. Importe o arquivo novamente para conferir."); }
        const valid = fresh.filter(row => !row.issue);
        if (!valid.length) return toast("Nenhum pedido ou lançamento novo apto para gravação.");
        const importedAt = new Date().toISOString(), importedBy = window.DIRECTFUEL_CURRENT_EMAIL || "";
        db.sapReturns = [...(db.sapReturns || []), ...valid.map(({issue, ...row}) => ({...row, id: uid("SAPPOST"), filename: file.name, importedAt, importedBy}))];
        audit("Importação", "Lançamentos SAP", `${file.name} · ${valid.length} vínculo(s)`);
        save("Pedidos e lançamentos SAP vinculados às NFs");
        back.remove();
        render();
      });
      const back = document.querySelector(".modal-back:last-child");
      back.querySelector(".save").textContent = "Gravar vínculos aptos";
      back.querySelector(".save").disabled = !preview.some(row => !row.issue);
    } catch (error) { toast(error.message); }
  }

  function manualLink(invoice) {
    if (!window.directFuelCanAction("medicoes", "incluir")) return toast("Seu acesso não permite criar vínculos SAP.");
    const existingOrders = api.purchaseOrders(db, invoice), existingOrder = existingOrders.length === 1 ? existingOrders[0] : "";
    modal(`Vincular pedido · NF ${esc(invoice.key)}`, `<p><strong>Posto:</strong> ${esc(postoNome(invoice.m.postoId))}<br><strong>Fornecedor SAP:</strong> ${esc(invoice.supplier || 'Não informado')}<br><strong>Medição:</strong> ${esc(invoice.m.numero || invoice.m.id)}</p><p class="note">Informe o pedido antes da MIRO. A data de lançamento é opcional: deixe-a vazia para manter a NF como Pedido vinculado — aguardando MIRO; informe-a somente depois do lançamento da NF no SAP.</p><div class="form-grid two"><div class="field"><label for="manualPurchaseOrder">Pedido de Compra</label><input id="manualPurchaseOrder" inputmode="numeric" maxlength="20" autocomplete="off" placeholder="Número do pedido SAP" value="${esc(existingOrder)}" ${existingOrder ? "readonly" : ""}></div><div class="field"><label for="manualPostingDate">Data Lançamento NF SAP (opcional)</label><input id="manualPostingDate" type="date"></div></div><div class="field" style="margin-top:12px"><label for="manualPurchaseReason">Observação</label><textarea id="manualPurchaseReason" minlength="5" maxlength="2000" placeholder="Informe a referência da conferência ou o motivo do vínculo manual."></textarea></div><label style="display:flex;gap:8px;margin-top:14px"><input type="checkbox" id="manualPurchaseConfirmed"> Conferi no SAP os dados informados acima.</label>`, back => {
      if (!window.directFuelCanAction("medicoes", "incluir")) return toast("Seu acesso não permite criar vínculos SAP.");
      try {
        const current = api.invoices(db).find(item=>item.m.id===invoice.m.id && item.key===invoice.key);
        if (!current || current.supplier!==invoice.supplier || current.date!==invoice.date) throw Error("Os dados da NF foram alterados. Feche e reabra o vínculo manual.");
        const record = api.manualPurchase(db,{measurementId:invoice.m.id,invoiceKey:invoice.key},back.querySelector('#manualPurchaseOrder').value,back.querySelector('#manualPostingDate').value,back.querySelector('#manualPurchaseReason').value,back.querySelector('#manualPurchaseConfirmed').checked);
        db.sapReturns = [...(db.sapReturns || []), {...record,id:uid("SAPPOST"),importedAt:new Date().toISOString(),importedBy:window.DIRECTFUEL_CURRENT_EMAIL || ""}];
        audit("Vínculo manual", "Lançamentos SAP", `NF ${invoice.key} · Medição ${invoice.m.numero} · Pedido ${record.purchaseOrder}${record.postingDate ? ` · lançamento ${record.postingDate}` : " · aguardando MIRO"} · ${record.reason}`);
        save(record.postingDate ? "Lançamento SAP registrado" : "Pedido vinculado para a MIRO"); back.remove(); render();
      } catch(error) { toast(error.message); }
    });
    document.querySelector('.modal-back:last-child .save').textContent=existingOrder?'Registrar lançamento SAP':'Vincular pedido';
  }

  function deleteMarkedLinks(invoice, groups, marked, historyDialog) {
    if (!window.directFuelCanAction("medicoes", "excluir")) return toast("Seu acesso não permite esta ação.");
    const selected = marked.map(index => groups[index]).filter(Boolean), targets = selected.flatMap(group => group.records), ids = new Set(targets.map(record => String(record.id))), snapshots = new Map(targets.map(record => [String(record.id), JSON.stringify(record)]));
    if (!targets.length) return toast("Marque ao menos um vínculo SAP.");
    modal("Eliminar vínculos SAP marcados", `<p><strong>${selected.length} vínculo(s)</strong> ${invoice ? `da NF <strong>${esc(invoice.key)}</strong>` : `de <strong>${new Set(selected.map(group => JSON.stringify([group.measurementId, group.invoiceKey]))).size} NF(s)</strong>`} serão eliminados.</p><ul>${selected.map(group => `<li>NF ${esc(group.invoiceKey)} · Medição ${esc(group.measurementNumber)} · ${group.records.some(record => record.purchaseOrder) ? "Pedido" : "RC legada"} ${esc(group.label)}${group.postingDate ? ` · ${esc(dateBR(group.postingDate))}` : ""}</li>`).join("")}</ul><p>O histórico no DirectFuel será preservado. Nenhum documento será alterado no SAP.</p><div class="field"><label for="bulkDeleteSapReason">Motivo da eliminação</label><input id="bulkDeleteSapReason" minlength="5" placeholder="Informe o motivo do ajuste"></div>`, back => {
      if (!window.directFuelCanAction("medicoes", "excluir")) return toast("Seu acesso não permite esta ação.");
      const reason = back.querySelector("#bulkDeleteSapReason").value.trim();
      if (reason.length < 5) return toast("Informe o motivo com pelo menos 5 caracteres.");
      const fresh = invoice ? nfRecords(invoice).filter(record => ids.has(String(record.id)) && !record.voided) : window.DirectFuelBulkRc.records(db, selected);
      if (fresh.length !== targets.length || fresh.some(record => JSON.stringify(record) !== snapshots.get(String(record.id)))) return toast("Um dos vínculos foi alterado. Feche a janela e confira novamente.");
      const at = new Date().toISOString(), by = window.DIRECTFUEL_CURRENT_EMAIL || window.DIRECTFUEL_CURRENT_USER || "Usuário";
      fresh.forEach(record => {
        record.adjustments = [...(record.adjustments || []), {action: "delete", from: relationLabel(record), to: "", reason, at, by}];
        record.voided = true;
      });
      audit("Exclusão de vínculos em lote", "Lançamentos SAP", `${selected.map(group => `Medição ${group.measurementNumber} / NF ${group.invoiceKey} / ${group.label}`).join("; ")} · ${reason}`);
      save(`${selected.length} vínculo(s) eliminado(s)`);
      back.remove();
      historyDialog?.remove();
      render();
    });
    document.querySelector(".modal-back:last-child .save").textContent = "Eliminar vínculos";
  }

  function history(invoice) {
    const records = nfRecords(invoice), canDelete = window.directFuelCanAction("medicoes", "excluir"), groups = [];
    records.filter(record => !record.voided).forEach(record => {
      const key = relationKey(record);
      let group = groups.find(item => item.key === key);
      if (!group) { group = {key, label: relationLabel(record), postingDate: record.postingDate || "", records: []}; groups.push(group); }
      group.records.push(record);
    });
    const firstByGroup = new Map(groups.map((group, index) => [group.records[0], index]));
    const bulk = canDelete && groups.length ? `<div class="toolbar" style="justify-content:space-between;margin-bottom:12px"><label style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" id="sapHistorySelectAll"> Marcar todos</label><button class="btn danger" id="deleteMarkedSap" disabled>Eliminar vínculos marcados (0)</button></div>` : "";
    modal(`Histórico SAP · NF ${esc(invoice.key)}`, bulk + (records.map(record => {
      const groupIndex = firstByGroup.get(record), isPurchase = Boolean(record.purchaseOrder);
      return `<div style="padding:16px 0;border-bottom:1px solid #ddd">${groupIndex !== undefined && canDelete ? `<label style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><input type="checkbox" data-sap-history-group="${groupIndex}"> Selecionar ${isPurchase ? "pedido" : "RC legada"} ${esc(groups[groupIndex].label)}</label>` : ""}<strong>${isPurchase ? `Pedido de Compra ${esc(record.purchaseOrder)} · ${record.postingDate ? `Lançamento ${esc(dateBR(record.postingDate))}` : "Aguardando MIRO"}` : `RC legada ${esc(record.requisition || "sem número")}`}${record.voided ? " · Vínculo excluído" : ""}</strong><p>${esc(record.message)}</p><small>${esc(record.filename)} · ${esc(record.sheet)} linha(s) ${esc((record.sourceRows || [record.row]).join(", "))}<br>${esc(record.importedAt)} · ${esc(record.importedBy)}</small>${(record.adjustments || []).map(event => `<p>Exclusão: ${esc(event.from)} → sem vínculo<br>${esc(event.reason)} · ${esc(event.at)} · ${esc(event.by)}</p>`).join("")}</div>`;
    }).join("") || "<p>Nenhum lançamento registrado.</p>"), () => {});
    const back = document.querySelector(".modal-back:last-child");
    back.querySelector(".save").remove();
    const boxes = [...back.querySelectorAll("[data-sap-history-group]")], selectAll = back.querySelector("#sapHistorySelectAll"), button = back.querySelector("#deleteMarkedSap");
    const sync = () => {
      const count = boxes.filter(box => box.checked).length;
      if (button) { button.disabled = !count; button.textContent = `Eliminar vínculos marcados (${count})`; }
      if (selectAll) { selectAll.checked = boxes.length > 0 && count === boxes.length; selectAll.indeterminate = count > 0 && count < boxes.length; }
    };
    boxes.forEach(box => box.onchange = sync);
    if (selectAll) selectAll.onchange = () => { boxes.forEach(box => box.checked = selectAll.checked); sync(); };
    if (button) button.onclick = () => deleteMarkedLinks(invoice, groups, boxes.filter(box => box.checked).map(box => Number(box.dataset.sapHistoryGroup)), back);
  }

  function show() {
    if (route !== "accounting" || document.getElementById("sapReturnPanel")) return;
    const panel = document.createElement("div"); panel.className = "panel"; panel.id = "sapReturnPanel";
    const notes = api.invoices(db).filter(invoice => invoice.m.status === "Aprovada"), mayAdd = window.directFuelCanAction("medicoes", "incluir");
    const labels = {"Sem pedido": "Sem pedido", "Pedido vinculado — aguardando MIRO": "Pedido vinculado — aguardando MIRO", "Lançada no SAP": "Lançada no SAP"};
    panel.innerHTML = `<div class="accounting-actions"><div><h2>Lançamentos de NF no SAP</h2><p class="muted">O pedido pode ser vinculado antes da MIRO. A NF só será considerada lançada quando houver Data Lançamento NF SAP. A série é preservada no DirectFuel e ignorada somente na busca do relatório SAP.</p></div><div class="toolbar">${window.directFuelCanAction("medicoes", "exportar") ? '<button type="button" class="btn secondary" id="exportFilteredAccounting">Exportar Excel</button><button type="button" class="btn primary" id="exportMiroLayout">Exportar carga MIRO</button><button type="button" class="btn secondary" id="exportSapLayout">Modelo de importação SAP</button>' : ""}${mayAdd ? '<label class="btn primary" style="cursor:pointer">Importar relatório SAP<input id="sapReturnFile" type="file" accept=".xlsx,.xls" hidden></label>' : ""}</div></div><div class="table-filter-panel"><div class="form-grid"><div class="field"><label for="sapReturnSearch">Buscar NF, posto, pedido ou fornecedor SAP</label><input id="sapReturnSearch" type="search" placeholder="NF, nome do posto, pedido ou código fornecedor SAP"></div><div class="field"><label for="sapMeasurementFilter">Medição</label><select id="sapMeasurementFilter"><option value="">Todas as medições</option>${[...new Map(notes.map(invoice => [String(invoice.m.id), invoice.m.numero || invoice.m.id])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR")).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("")}</select></div><div class="field"><label for="sapReturnStatus">Situação SAP</label><select id="sapReturnStatus"><option value="">Todas</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div><div class="field"><label for="sapDueFrom">Vencimento NF inicial</label><input type="date" id="sapDueFrom"></div><div class="field"><label for="sapDueTo">Vencimento NF final</label><input type="date" id="sapDueTo"></div><div class="field"><label for="sapPostingFrom">Data lançamento SAP inicial</label><input type="date" id="sapPostingFrom"></div><div class="field"><label for="sapPostingTo">Data lançamento SAP final</label><input type="date" id="sapPostingTo"></div></div><p id="sapReturnCount" class="muted" role="status"></p></div><div class="accounting-selection-bar"><div><strong id="accountingSelectedCount" role="status">Nenhuma NF marcada</strong><p class="muted">Marque NFs para consultar abastecimentos, exportar a MIRO ou eliminar vínculos.</p></div><div class="accounting-batch-actions" id="accountingBatchActions">${window.directFuelCanAction("medicoes", "excluir") ? '<button class="btn danger" id="sapBatchDelete" disabled>Eliminar vínculos</button>' : ""}</div></div><div class="table-wrap"><table><thead><tr><th><label class="accounting-check-all"><input type="checkbox" id="sapSelectAll"> Marcar todos</label></th><th>NF</th><th>Posto / Medição</th><th>Emissão</th><th>Vencimento NF</th><th>Situação SAP</th><th>Pedido de Compra</th><th>Data Lançamento NF SAP</th><th>Ações</th></tr></thead><tbody>${notes.map((invoice, index) => {
      const supplier = String((db.postos || []).find(station => station.id === invoice.m.postoId)?.sap || "").trim();
      const records = nfRecords(invoice).filter(record => !record.voided && record.purchaseOrder), status = api.postingStatus(db, invoice);
      const orders = [...new Set(records.map(record => record.purchaseOrder).filter(Boolean))].join(", ") || "—";
      const dates = [...new Set(records.map(record => dateBR(record.postingDate)).filter(Boolean))].join(", ") || "—";
      return `<tr data-sap-status="${status}" data-sap-measurement="${esc(invoice.m.id)}"><td><input type="checkbox" data-sap-select="${index}" aria-label="Selecionar NF ${esc(invoice.key)}"></td><td><strong>${esc(invoice.key)}</strong></td><td>${esc(postoNome(invoice.m.postoId))}<br><span class="muted">Fornecedor SAP: ${esc(supplier || "Não informado")}</span><br><span class="muted">Medição: ${esc(invoice.m.numero)}</span></td><td>${esc(dateBR(invoice.date))}</td><td>${invoice.dueDate ? esc(dateBR(invoice.dueDate)) : "—"}</td><td><span class="badge ${status === "Lançada no SAP" ? "ok" : "warn"}">${labels[status]}</span></td><td>${esc(orders)}</td><td>${esc(dates)}</td><td><button class="btn secondary small" data-sap-history="${index}">Histórico SAP (${nfRecords(invoice).length})</button>${mayAdd ? ` <button type="button" class="btn secondary small" data-sap-manual="${index}" ${status === "Lançada no SAP" ? 'disabled title="Esta NF já está lançada. Consulte o Histórico SAP."' : ''}>${status === "Pedido vinculado — aguardando MIRO" ? "Registrar lançamento" : "Vincular pedido"}</button>` : ""}</td></tr>`;
    }).join("")}<tr id="sapReturnEmpty" hidden><td colspan="9">Nenhuma NF corresponde aos filtros.</td></tr></tbody></table></div>`;
    document.querySelector("#view").prepend(panel);
    const cards = document.createElement("div"); cards.className = "grid cards"; cards.style.cssText = "grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px"; cards.setAttribute("aria-label", "Resumo dos lançamentos de NF");
    cards.innerHTML = Object.entries(labels).map(([value, label]) => `<button type="button" class="card" data-sap-card="${value}" aria-pressed="false" style="cursor:pointer;text-align:left;font:inherit;color:inherit"><span class="label" style="display:block">${label}</span><strong class="value" style="display:block">${notes.filter(invoice => api.postingStatus(db, invoice) === value).length}</strong><span class="muted">Ver NFs</span></button>`).join("");
    panel.before(cards);
    panel.querySelector("#sapReturnFile")?.addEventListener("change", event => { load(event.target.files[0]); event.target.value = ""; });
    const reportControls = window.directFuelSetupAccountingReport?.(panel, notes);
    const eligible = () => [...panel.querySelectorAll("[data-sap-select]")].filter(box => !box.disabled && !box.closest("tr").hidden);
    const filteredNotes = () => eligible().map(box => notes[Number(box.dataset.sapSelect)]);
    const selectedNotes = () => eligible().filter(box => box.checked).map(box => notes[Number(box.dataset.sapSelect)]);
    const exportFiltered = async mode => {
      const visible = filteredNotes();
      if (!visible.length) return toast("Nenhuma NF corresponde aos filtros para exportar.");
      const button = panel.querySelector(mode === "sap" ? "#exportSapLayout" : "#exportFilteredAccounting");
      if (button) button.disabled = true;
      try {
        await ensureExcel();
        const excel = window.DirectFuelAccountingExcel;
        const rows = mode === "sap" ? excel.sapLayoutRows(db, visible) : excel.accountingRows(db, visible);
        const book = excel.rowsWorkbook(rows, mode === "sap" ? "Modelo Importação SAP" : "Contabilização");
        XLSX.writeFile(book, excel.datedFilename(mode === "sap" ? "Modelo_Importacao_SAP" : "Contabilizacao_Filtrada"));
      } catch (error) { toast(error.message); }
      finally { if (button) button.disabled = false; }
    };
    panel.querySelector("#exportFilteredAccounting")?.addEventListener("click", () => exportFiltered("accounting"));
    panel.querySelector("#exportSapLayout")?.addEventListener("click", () => exportFiltered("sap"));
    panel.querySelector('#exportMiroLayout')?.addEventListener('click',()=>{
      if(!window.directFuelCanAction('medicoes','exportar'))return toast('Seu perfil não permite exportar.');
      const chosen=selectedNotes();if(!chosen.length)return toast('Marque as NFs que deseja exportar para MIRO.');
      const posted=chosen.filter(i=>api.postingStatus(db,i)==='Lançada no SAP');if(posted.length)return toast(`Retire da seleção as NFs já lançadas: ${posted.map(i=>i.key).join(', ')}.`);
      const invalidOrders=chosen.filter(i=>api.purchaseOrders(db,i).length!==1);if(invalidOrders.length)return toast(`Vincule um único pedido antes de exportar: ${invalidOrders.map(i=>i.key).join(', ')}.`);
      modal('Exportar carga MIRO',`<p>${chosen.length} NF(s) selecionada(s). Os pedidos abaixo já estão vinculados no DirectFuel. A exportação não registra o lançamento no SAP.</p><p>Categoria NF: <b>${esc(db.config?.params?.miroCategoriaNF??'Z1')}</b> · CFOP: <b>${esc(db.config?.params?.miroCFOP||'Não configurado')}</b></p><div class="table-wrap"><table><thead><tr><th>NF</th><th>Posto</th><th>Pedido de compra</th><th>Emissão</th><th>Valor total NF</th><th>Chave DANFE</th></tr></thead><tbody>${chosen.map(i=>`<tr><td>${esc(i.n.numero)}-${esc(i.n.serie)}</td><td>${esc(postoNome(i.m.postoId))}</td><td><strong>${esc(api.purchaseOrders(db,i)[0])}</strong></td><td>${esc(dateBR(i.date))}</td><td>${money(Number(i.n.valorTotal??i.n.total??0))}</td><td>${esc(i.n.chave||i.n.chaveAcesso||'Não informada')}</td></tr>`).join('')}</tbody></table></div><p><strong>Total: ${money(chosen.reduce((sum,i)=>sum+Number(i.n.valorTotal??i.n.total??0),0))}</strong></p><p class="note">Um pedido por NF. Número da NF exportado com série após o hífen. Código numérico: oito dígitos anteriores ao último da chave.</p>`,async back=>{
        const result=window.DirectFuelMiro.build(db,chosen);if(result.errors.length)return alert('Corrija antes de exportar:\n\n'+result.errors.join('\n'));
        const button=back.querySelector('.save');button.disabled=true;
        try{await ensureExcel();const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(result.rows);sheet['!cols']=[{wch:22},{wch:20},{wch:20},{wch:22},{wch:48},{wch:26},{wch:16},{wch:12},{wch:20}];sheet['!autofilter']={ref:sheet['!ref']};result.rows.forEach((_,i)=>{if(sheet['D'+(i+2)])sheet['D'+(i+2)].z='#,##0.00';});XLSX.utils.book_append_sheet(book,sheet,'MIRO');XLSX.writeFile(book,window.DirectFuelAccountingExcel.datedFilename('Layout_MIRO'));audit('Exportação','MIRO',JSON.stringify({notas:result.rows.map(r=>({nf:r['Número da NF'],pedido:r['Pedido de compra'],fornecedor:r['Fornecedor SAP']})),total:result.total}));save('Layout MIRO exportado');back.remove();}catch(error){toast(error.message);button.disabled=false;}
      });
      const back=document.querySelector('.modal-back:last-child');back.querySelector('.save').textContent='Exportar carga MIRO';
    });
    const updateSelection = () => {
      const options = eligible(), chosen = selectedNotes(), count = chosen.length, all = panel.querySelector("#sapSelectAll"), remove = panel.querySelector("#sapBatchDelete"), groups = window.DirectFuelBulkRc.groups(db, chosen).filter(group => group.records.some(record => record.purchaseOrder));
      if (remove) { remove.disabled = !groups.length; remove.textContent = `Eliminar vínculos (${groups.length})`; }
      all.disabled = !options.length; all.checked = options.length > 0 && count === options.length; all.indeterminate = count > 0 && count < options.length;
      panel.querySelector("#accountingSelectedCount").textContent = count ? `${count} NF(s) marcadas · ${new Set(chosen.map(invoice => invoice.m.id)).size} medição(ões)` : "Nenhuma NF marcada";
      reportControls?.sync(chosen);
    };
    const filter = () => {
      const query = panel.querySelector("#sapReturnSearch").value.trim().toLowerCase(), status = panel.querySelector("#sapReturnStatus").value, measurement = panel.querySelector("#sapMeasurementFilter").value;
      const from = panel.querySelector("#sapPostingFrom").value, to = panel.querySelector("#sapPostingTo").value;
      const dueFrom = panel.querySelector("#sapDueFrom").value, dueTo = panel.querySelector("#sapDueTo").value;
      const invalidRange = Boolean(from && to && from > to);
      const invalidDueRange = Boolean(dueFrom && dueTo && dueFrom > dueTo);
      panel.querySelector("#sapPostingTo").setCustomValidity(invalidRange ? "A data final deve ser igual ou posterior à inicial." : "");
      panel.querySelector("#sapDueTo").setCustomValidity(invalidDueRange ? "O vencimento final deve ser igual ou posterior ao inicial." : "");
      let count = 0;
      panel.querySelectorAll("[data-sap-status]").forEach(row => {
        const invoice = notes[Number(row.querySelector("[data-sap-select]").dataset.sapSelect)];
        const supplier = String((db.postos || []).find(station => station.id === invoice.m.postoId)?.sap || "").trim();
        const matchesSearch = row.textContent.toLowerCase().includes(query) || Boolean(/^\d+$/.test(query) && supplier.replace(/^0+(?=\d)/, "").includes(query.replace(/^0+(?=\d)/, "")));
        const matchesDate = !from && !to || nfRecords(invoice).some(record => !record.voided && record.purchaseOrder && record.postingDate && (!from || record.postingDate >= from) && (!to || record.postingDate <= to));
        const matchesDue = api.matchesDueDate(invoice, dueFrom, dueTo);
        row.hidden = invalidRange || invalidDueRange || !matchesDate || !matchesDue || !matchesSearch || Boolean(status && row.dataset.sapStatus !== status) || Boolean(measurement && row.dataset.sapMeasurement !== measurement) || Boolean(reportControls && !reportControls.matches(row.dataset.sapMeasurement));
        if (!row.hidden) count++; else { const box = row.querySelector("[data-sap-select]"); if (box) box.checked = false; }
      });
      updateSelection();
      panel.querySelector("#sapReturnCount").textContent = invalidRange ? "A data final deve ser igual ou posterior à inicial." : invalidDueRange ? "O vencimento final deve ser igual ou posterior ao inicial." : `${count} de ${notes.length} NFs`;
      panel.querySelector("#sapReturnEmpty").hidden = count > 0;
      cards.querySelectorAll("[data-sap-card]").forEach(card => { const selected = card.dataset.sapCard === status; card.setAttribute("aria-pressed", String(selected)); card.style.outline = selected ? "2px solid #0c6152" : ""; });
    };
    panel.querySelector("#sapPostingFrom").oninput = filter;
    panel.querySelector("#sapPostingTo").oninput = filter;
    panel.querySelector("#sapDueFrom").oninput = filter;
    panel.querySelector("#sapDueTo").oninput = filter;
    panel.querySelector("#sapReturnSearch").oninput = filter;
    panel.querySelector("#sapReturnStatus").onchange = filter;
    panel.querySelector("#sapMeasurementFilter").onchange = filter;
    cards.querySelectorAll("[data-sap-card]").forEach(card => card.onclick = () => { panel.querySelector("#sapReturnStatus").value = card.dataset.sapCard; filter(); });
    panel.querySelectorAll("[data-sap-select]").forEach(box => box.onchange = updateSelection);
    panel.querySelector("#sapSelectAll")?.addEventListener("change", event => { eligible().forEach(box => box.checked = event.target.checked); updateSelection(); });
    panel.querySelector("#sapBatchDelete")?.addEventListener("click", () => { const groups = window.DirectFuelBulkRc.groups(db, selectedNotes()).filter(group => group.records.some(record => record.purchaseOrder)); deleteMarkedLinks(null, groups, groups.map((_, index) => index)); });
    panel.querySelectorAll("[data-sap-manual]").forEach(button => button.onclick = () => manualLink(notes[Number(button.dataset.sapManual)]));
    panel.querySelectorAll("[data-sap-history]").forEach(button => button.onclick = () => history(notes[Number(button.dataset.sapHistory)]));
    filter();
  }

 window.directFuelShowSapReturns=show;
  const prior = render;
  render = function () { prior(); show(); };
})();
