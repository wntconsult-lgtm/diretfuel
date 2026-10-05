(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
  const purchaseOrders = (state, id) => [...new Set((state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && String(record.measurementId) === String(id)).map(record => String(record.purchaseOrder)))];
  const rcNumbers = (state, id) => [...new Set((state.sapReturns || []).filter(record => !record.voided && record.requisition && String(record.measurementId) === String(id)).map(record => String(record.requisition)))];
  const matchValues = (values, query, choices) => (!query || values.some(value => value.includes(query))) && (!choices.length || choices.some(value => value === "__none" ? !values.length : values.includes(value)));
  const matchPurchaseOrder = matchValues;
  const matchRc = matchValues;
  function selection() { const selected = new Set(); return {selected, toggle(id, checked) { if (checked) selected.add(id); else selected.delete(id); }, all(ids, checked) { ids.forEach(id => this.toggle(id, checked)); }, reconcile(ids) { for (const id of selected) if (!ids.has(id)) selected.delete(id); }}; }
  window.DirectFuelAccountingFilters = {purchaseOrders, matchPurchaseOrder, rcNumbers, matchRc, selection};

  async function requestReport(ids, mode = "view", version) {
    const response = await fetch("/api/accounting-report", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({measurementIds: ids, mode, version})});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Falha ao consultar relatório.");
    return result;
  }

  function workbook(result) {
    const book = XLSX.utils.book_new(), rows = result.rows.map(row => {
      const copy = {...row};
      for (const key of ["Data Lançamento NF SAP", "Data NF", "Data abastecimento"]) if (/^\d{4}-\d{2}-\d{2}$/.test(copy[key])) copy[key] = new Date(`${copy[key]}T00:00:00Z`);
      return copy;
    }), headers = Object.keys(rows[0] || {"Medição": "", "Pedido de Compra": "", "Data Lançamento NF SAP": ""}), sheet = XLSX.utils.json_to_sheet(rows, {header: headers, cellDates: true});
    sheet["!autofilter"] = {ref: sheet["!ref"] || "A1:C1"};
    sheet["!cols"] = headers.map(header => ({wch: Math.max(18, header.length + 2)}));
    for (let row = 1; row <= rows.length; row++) headers.forEach((header, column) => {
      const cell = sheet[XLSX.utils.encode_cell({r: row, c: column})];
      if (!cell) return;
      if (header === "Quantidade em litros") cell.z = "#,##0.000";
      if (header === "Valor unitário") cell.z = "#,##0.0000";
      if (header === "Valor total") cell.z = "#,##0.00";
      if (cell.t === "d") cell.z = "dd/mm/yyyy";
    });
    XLSX.utils.book_append_sheet(book, sheet, "Abastecimentos");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(result.subtotals.map(row => ({"Medição": row.medicao, "Abastecimentos": row.count, "Volume (L)": row.volume, "Valor total (R$)": row.total}))), "Subtotais");
    return book;
  }

  function filename(result) {
    return result.summary.measurements === 1 ? `Abastecimentos_${String(result.subtotals[0].medicao).replace(/[^a-z0-9_-]/gi, "_")}.xlsx` : `Abastecimentos_Pedidos_Compra_${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  function stationForInvoice(state, invoice) {
    const fueling = (state.abastecimentos || []).find(item => (invoice.m.itens || []).includes(item.id));
    const stationId = invoice.m.postoId || fueling?.postoId;
    return (state.postos || []).find(item => item.id === stationId) || {};
  }

  function accountingRows(state, invoices) {
    return invoices.map(invoice => {
      const station = stationForInvoice(state, invoice);
      const links = (state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && String(record.measurementId) === String(invoice.m.id) && String(record.invoiceKey) === String(invoice.key));
      const postings = links.filter(record => String(record.postingDate || "").trim());
      return {
        "NF": invoice.key,
        "Posto": station.fantasia || station.razao || station.id || "",
        "Fornecedor SAP": String(station.sap || ""),
        "Medição": invoice.m.numero || invoice.m.id,
        "Data emissão": invoice.date || "",
        "Lançamento SAP": postings.length ? "Lançada no SAP" : links.length ? "Pedido vinculado — aguardando MIRO" : "Sem pedido",
        "Pedido de Compra": [...new Set(links.map(record => String(record.purchaseOrder)).filter(Boolean))].join(", "),
        "Data Lançamento NF SAP": [...new Set(postings.map(record => String(record.postingDate || "").slice(0, 10)).filter(Boolean))].join(", "),
      };
    });
  }

  function sapLayoutRows(state, invoices) {
    return invoices.flatMap(invoice => {
      const station = stationForInvoice(state, invoice);
      const supplier = String(station.sap || "");
      const invoiceNumber = String(invoice.n?.numero || invoice.number || invoice.key || "").split("-")[0];
      const postings = (state.sapReturns || []).filter(record => !record.voided && record.purchaseOrder && String(record.measurementId) === String(invoice.m.id) && String(record.invoiceKey) === String(invoice.key));
      const unique = new Map(postings.map(record => [JSON.stringify([record.purchaseOrder, record.purchaseOrderDate || "", record.postingDate || ""]), record]));
      const source = unique.size ? [...unique.values()] : [{}];
      return source.map(record => ({
        "Documento de Compras": String(record.purchaseOrder || ""),
        "Data de Criação do Pedido": String(record.purchaseOrderDate || "").slice(0, 10),
        "Fornecedor do Pedido": supplier,
        "Nº da Nota Fiscal": invoiceNumber,
        "Data do Lançamento da Nota Fiscal": String(record.postingDate || "").slice(0, 10),
      }));
    });
  }

  function rowsWorkbook(rows, sheetName) {
    const book = XLSX.utils.book_new();
    const headers = Object.keys(rows[0] || {});
    const values = rows.map(row => {
      const copy = {...row};
      for (const key of ["Data emissão", "Data Lançamento NF SAP", "Data de Criação do Pedido", "Data do Lançamento da Nota Fiscal"]) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(copy[key])) copy[key] = new Date(`${copy[key]}T00:00:00Z`);
      }
      return copy;
    });
    const sheet = XLSX.utils.json_to_sheet(values, {header: headers, cellDates: true});
    sheet["!autofilter"] = {ref: sheet["!ref"] || `A1:${XLSX.utils.encode_col(Math.max(headers.length - 1, 0))}1`};
    sheet["!cols"] = headers.map(header => ({wch: Math.max(18, Math.min(34, header.length + 3))}));
    for (let row = 1; row <= values.length; row++) headers.forEach((header, column) => {
      const cell = sheet[XLSX.utils.encode_cell({r: row, c: column})];
      if (cell?.t === "d") cell.z = "dd/mm/yyyy";
    });
    XLSX.utils.book_append_sheet(book, sheet, sheetName);
    return book;
  }

  const datedFilename = prefix => `${prefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  window.DirectFuelAccountingExcel = {workbook, filename, accountingRows, sapLayoutRows, rowsWorkbook, datedFilename};

  async function openReport(ids) {
    try {
      const result = await requestReport(ids), {rows, summary, subtotals} = result, headers = Object.keys(rows[0] || {});
      modal("Abastecimentos da contabilização", `<div class="grid cards">${[["Medições selecionadas", summary.measurements], ["Quantidade de abastecimentos", summary.count], ["Volume total (L)", num(summary.volume)], ["Valor total (R$)", money(summary.total)]].map(([key, value]) => `<div class="card"><div class="label">${key}</div><div class="value">${value}</div></div>`).join("")}</div><h4>Subtotal por medição</h4><div class="table-wrap"><table><thead><tr><th>Medição</th><th>Abastecimentos</th><th>Volume (L)</th><th>Valor total</th></tr></thead><tbody>${subtotals.map(row => `<tr><td>${esc(row.medicao)}</td><td>${row.count}</td><td>${num(row.volume)}</td><td>${money(row.total)}</td></tr>`).join("")}</tbody></table></div><div class="toolbar" style="margin:16px 0">${window.directFuelCanAction("medicoes", "exportar") ? '<button class="btn primary" id="exportAccountingFuelings">Exportar Excel</button>' : ""}</div><div class="table-wrap" style="max-height:55vh"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(header => `<td>${esc(typeof row[header] === "number" ? num(row[header]) : row[header])}</td>`).join("")}</tr>`).join("") || '<tr><td>Nenhum abastecimento vinculado.</td></tr>'}</tbody></table></div>`, () => {});
      const back = document.querySelector(".modal-back:last-child");
      back.querySelector(".modal").style.cssText = "width:96vw;max-width:1600px";
      back.querySelector(".save").remove();
      back.querySelector(".cancel").textContent = "Fechar";
      back.querySelector("#exportAccountingFuelings")?.addEventListener("click", async event => {
        const button = event.currentTarget; button.disabled = true;
        try {
          if (!window.XLSX) await new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = "/gekon-xlsx.js"; script.onload = resolve; script.onerror = () => reject(Error("Não foi possível carregar o Excel.")); document.head.append(script); });
          await requestReport(ids, "export", result.version);
          XLSX.writeFile(workbook(result), filename(result));
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      });
    } catch (error) { toast(error.message); }
  }

  window.directFuelSetupAccountingReport = (panel, notes) => {
    const orders = id => purchaseOrders(db, id);
    const field = document.createElement("div"); field.className = "field";
    field.innerHTML = `<label>Pedido de Compra</label><button type="button" class="btn secondary" id="togglePurchaseOrderFilter" aria-expanded="false" aria-controls="purchaseOrderFilterChoices">Pedidos · todos ▾</button><div id="purchaseOrderFilterChoices" hidden><input id="accountingPurchaseOrderSearch" type="search" placeholder="Pesquisar Pedido de Compra"><div style="max-height:140px;overflow:auto;border:1px solid #ddd;border-radius:6px;padding:8px"><label style="display:block"><input type="checkbox" data-report-order="__none"> Sem Pedido de Compra</label>${[...new Set(notes.flatMap(invoice => orders(invoice.m.id)))].sort().map(order => `<label style="display:block"><input type="checkbox" data-report-order="${esc(order)}"> ${esc(order)}</label>`).join("")}</div><small>Nenhuma opção marcada: todos os pedidos.</small></div>`;
    panel.querySelector(".table-filter-panel .form-grid").append(field);
    field.querySelector("#togglePurchaseOrderFilter").onclick = () => { const box = field.querySelector("#purchaseOrderFilterChoices"), button = field.querySelector("#togglePurchaseOrderFilter"); box.hidden = !box.hidden; button.setAttribute("aria-expanded", String(!box.hidden)); };
    let measurementIds = [];
    const button = document.createElement("button"); button.className = "btn secondary"; button.textContent = "Consultar abastecimentos"; button.disabled = true; panel.querySelector("#accountingBatchActions").prepend(button);
    const sync = (chosen = []) => { measurementIds = [...new Set(chosen.map(invoice => String(invoice.m.id)))]; button.disabled = !measurementIds.length; button.textContent = measurementIds.length ? `Abastecimentos (${measurementIds.length} medições)` : "Consultar abastecimentos"; button.title = "Consulta todos os abastecimentos das medições representadas pelas NFs marcadas."; };
    button.onclick = () => openReport(measurementIds);
    const trigger = () => { const count = field.querySelectorAll("[data-report-order]:checked").length, query = field.querySelector("input[type=search]").value.trim(); field.querySelector("#togglePurchaseOrderFilter").textContent = `Pedidos · ${count ? count + " selecionado(s)" : query ? "busca: " + query : "todos"} ▾`; panel.querySelector("#sapMeasurementFilter").dispatchEvent(new Event("change")); };
    field.querySelectorAll("[data-report-order]").forEach(box => box.onchange = trigger);
    field.querySelector("input[type=search]").oninput = trigger;
    return {sync, matches: id => { const values = orders(id), query = field.querySelector("input[type=search]").value.trim(), choices = [...field.querySelectorAll("[data-report-order]:checked")].map(box => box.dataset.reportOrder); return matchPurchaseOrder(values, query, choices); }};
  };
})();
