(() => {
  const clone = (value) => structuredClone(value);
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_meta").map(([key, item]) => [key, clean(item)]));
    return value;
  };
  const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
  const html = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const currentUser = () => window.DIRECTFUEL_CURRENT_USER || window.DIRECTFUEL_CURRENT_EMAIL || "Usuário Vixpar";
  const nextAgreementNumber = () => {
    const year = new Date().getFullYear(), used = new Set((db.acordos || []).map((item) => String(item.numero || "")));
    let sequence = Math.max(0, ...[...used].map((number) => Number(number.match(new RegExp(`^AC-${year}-(\\d+)$`, "i"))?.[1] || 0)));
    let number; do number = `AC-${year}-${String(++sequence).padStart(4, "0")}`; while (used.has(number));
    return number;
  };
  const tracked = ["distribuidores", "bases", "produtos", "unidades", "postos", "frota", "rede", "acordos", "abastecimentos", "medicoes", "docs", "users", "alertReviews"];
  const labels = { distribuidores: "Distribuidora", bases: "Base supridora", produtos: "Produto", unidades: "Unidade", postos: "Posto", frota: "Frota", rede: "Rede de atendimento", acordos: "Acordo", abastecimentos: "Abastecimento", medicoes: "Medição", docs: "Documento", users: "Usuário", alertReviews: "Revisão de alerta" };
  const recordLabel = (record) => record?.numero || record?.placa || record?.fantasia || record?.nome || record?.curta || record?.codigo || record?.email || record?.id || "registro";
  const fieldNames = { postoId: "posto", unidadeId: "filial", produtoId: "produto", centroCusto: "centro de custo", medicaoId: "medição", preco: "preço", total: "valor total", qt: "quantidade", status: "status", nf: "NF", aprovadoPor: "aprovado por", salvoPor: "salvo por" };
  let snapshot = clone(db);

  window.directFuelSyncSnapshot = (state) => { snapshot = clone(state); };
  window.directFuelingForm = fuelingForm;

  function changes(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys].filter((key) => key !== "_meta" && !same(before?.[key], after?.[key])).map((key) => fieldNames[key] || key);
  }

  function detailedAudit() {
    const now = new Date().toISOString();
    const user = currentUser();
    db.audit = db.audit || [];
    for (const arr of tracked) {
      const oldMap = new Map((snapshot[arr] || []).map((item) => [item.id, item]));
      for (const item of db[arr] || []) {
        const old = oldMap.get(item.id);
        if (!old || !same(old, item)) {
          const fields = old ? changes(old, item) : [];
          item._meta = {
            createdAt: old?._meta?.createdAt || now,
            createdBy: old?._meta?.createdBy || user,
            updatedAt: now,
            updatedBy: user,
          };
          db.audit.unshift({ id: uid("LOG"), data: now, usuario: user, acao: old ? "Alteração" : "Inclusão", entidade: labels[arr], registro: recordLabel(item), detalhe: old ? `Campos: ${fields.join(", ") || "dados do registro"}` : "Registro criado", campos: fields });
        } else if (old?._meta && !item._meta) item._meta = clone(old._meta);
        oldMap.delete(item.id);
      }
      for (const old of oldMap.values()) db.audit.unshift({ id: uid("LOG"), data: now, usuario: user, acao: "Exclusão", entidade: labels[arr], registro: recordLabel(old), detalhe: "Registro excluído" });
    }
    if (!same(snapshot.config, db.config)) {
      const fields = changes(snapshot.config || {}, db.config || {});
      db.audit.unshift({ id: uid("LOG"), data: now, usuario: user, acao: "Alteração", entidade: "Configurações", registro: "Configuração geral", detalhe: `Campos: ${fields.join(", ") || "parâmetros"}`, campos: fields });
    }
    if (db.audit.length > 1000) db.audit.length = 1000;
  }

  const onlineSave = save;
  save = function (message) {
    detailedAudit();
    onlineSave(message);
    snapshot = clone(db);
  };

  function medUserLine(m) {
    const saved = m.salvoPor || m._meta?.createdBy || "Registro anterior";
    const savedAt = m.salvoEm || m._meta?.createdAt;
    const approved = m.aprovadoPor || "Não aprovado";
    const approvedAt = m.aprovadoEm;
    return `<div><strong>${html(saved)}</strong>${savedAt ? `<br><span class="muted">${new Date(savedAt).toLocaleString("pt-BR")}</span>` : ""}</div><div style="margin-top:6px"><strong>${html(approved)}</strong>${approvedAt ? `<br><span class="muted">${new Date(approvedAt).toLocaleString("pt-BR")}</span>` : ""}</div>`;
  }

  function isAdministrator() {
    return !!window.DIRECTFUEL_IS_OWNER || !!window.directFuelCanAction?.("abastecimentos", "editar");
  }

  function normalizeFuelingDate(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    let year, month, day;
    let match = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (match) [, year, month, day] = match;
    else {
      match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
      if (match) [, day, month, year] = match;
      else if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
        const date = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000);
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
      }
    }
    if (!year) return "";
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day) ? iso : "";
  }

  function parseFuelingCsv(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) { const char = text[i]; if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; } else if (char === '"') quoted = true; else if (char === ";") { row.push(cell.trim()); cell = ""; } else if (char === "\n") { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; } else if (char !== "\r") cell += char; }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    const normalizeHeader = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const headers = (rows.shift() || []).map(normalizeHeader);
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function csvNumber(value) { const raw = String(value ?? "0").trim(); return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw) || 0; }
  function fuelingKey(item) { return [item.data, item.hora, item.postoId, item.placa, item.produtoId, Number(item.qt || 0).toFixed(3), Number(item.preco || 0).toFixed(4), Number(item.total || 0).toFixed(2), Number(item.odometro || 0).toFixed(1)].map((value) => String(value || "").trim().toLocaleLowerCase("pt-BR")).join("|"); }
  function plateSearchKey(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toUpperCase(); }
  function plateSearchFleet(query = "") {
    const search = plateSearchKey(query);
    return [...(db.frota || [])]
      .sort((a, b) => String(a.placa || "").localeCompare(String(b.placa || ""), "pt-BR", { numeric: true, sensitivity: "base" }))
      .filter((item) => !search || plateSearchKey(item.placa).includes(search) || plateSearchKey(item.modelo).includes(search));
  }

  async function importFuelingCsv(event) {
    const file = event.target.files[0]; if (!file) return;
    const rows = parseFuelingCsv(await file.text()), errors = []; let added = 0;
    rows.forEach((row, index) => {
      const line = index + 2, date = normalizeFuelingDate(row.data), station = db.postos.find((item) => [item.id, item.fantasia, item.razao].some((value) => String(value || "").trim().toLowerCase() === String(row.posto || "").trim().toLowerCase())), product = db.produtos.find((item) => [item.id, item.curta, item.descricao, item.sap].some((value) => String(value || "").trim().toLowerCase() === String(row.produto || "").trim().toLowerCase())), unit = db.unidades.find((item) => [item.id, item.nome, item.centroSap].some((value) => String(value || "").trim().toLowerCase() === String(row.filial || row.unidade || "").trim().toLowerCase())), fleet = db.frota.find((item) => String(item.placa || "").toUpperCase() === String(row.placa || "").trim().toUpperCase()), quantity = csvNumber(row.quantidade || row.qt), price = csvNumber(row.preco), suppliedId = String(row.id || "").trim();
      if (!date) return errors.push(`Linha ${line}: data inválida "${row.data || "vazia"}". Use DD/MM/AAAA ou AAAA-MM-DD.`);
      if (!station) return errors.push(`Linha ${line}: posto não encontrado.`);
      if (!product) return errors.push(`Linha ${line}: produto não encontrado.`);
      if (!unit) return errors.push(`Linha ${line}: filial não encontrada.`);
      if (!fleet) return errors.push(`Linha ${line}: placa não encontrada na frota.`);
      if (!quantity || !price) return errors.push(`Linha ${line}: quantidade ou preço inválido.`);
      if (suppliedId && db.abastecimentos.some((item) => item.id === suppliedId)) return errors.push(`Linha ${line}: ID ${suppliedId} já cadastrado.`);
      db.abastecimentos.push({ id: suppliedId || uid("AB"), data: date, hora: row.hora || "", postoId: station.id, placa: fleet.placa, veiculo: fleet.modelo || "", odometro: csvNumber(row.odometro), motorista: row.motorista || "", produtoId: product.id, qt: quantity, preco: price, total: quantity * price, unidadeId: unit.id, centroCusto: fleet.centroCusto || row.centro_custo || "", origem: "CSV", medicaoId: null }); added++;
    });
    if (added) { audit("Importação CSV", "Abastecimentos", `${added} registros válidos`); save(`${added} abastecimentos importados`); render(); }
    if (errors.length) alert(`A carga encontrou ${errors.length} erro(s) e essas linhas não foram importadas:\n\n${errors.slice(0, 20).join("\n")}${errors.length > 20 ? "\n..." : ""}`);
    event.target.value = "";
  }

  function fuelingForm(record = null, context = {}) {
    const measurementEdit=!!(record&&context.fromMeasurement),sameMeasurement=!record?.medicaoId||String(record.medicaoId)===String(context.measurementId||"");
    if (record?.medicaoId && (!measurementEdit || !sameMeasurement)) return toast("Este abastecimento pertence a outra medição e não pode ser alterado");
    if (record && !measurementEdit && !isAdministrator()) return toast("É necessária permissão de editar abastecimentos fora da conferência");
    if (measurementEdit && typeof window.directFuelCanAction==="function" && !window.directFuelCanAction("abastecimentos","editar")) return toast("Seu perfil não permite editar abastecimentos");
    if (measurementEdit && ["Aprovada","Rejeitada","Cancelada"].includes(String(context.measurementStatus||""))) return toast("Esta medição possui decisão final e não pode ser alterada");
    modal(record ? "Editar abastecimento pendente" : "Novo abastecimento", `<div class="form-grid"><div class="field"><label>Data</label><input type="date" id="bData" value="${record?.data || new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Hora</label><input type="time" id="bHora" value="${record?.hora || ""}"></div><div class="field"><label>Posto</label><select id="bPosto">${opts("postos", (x) => x.fantasia || x.razao)}</select></div><div class="field plate-picker-field"><label for="bPlacaSearch">Placa</label><div class="plate-combobox"><input id="bPlacaSearch" value="${html(record?.placa || "")}" placeholder="Digite a placa" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-controls="bPlacaOptions" aria-expanded="false"><input type="hidden" id="bPlaca" value="${html(record?.placa || "")}"><div id="bPlacaOptions" class="plate-options" role="listbox" hidden></div></div><small id="bPlacaMeta" class="plate-search-meta">Digite a placa com ou sem hífen.</small></div><div class="field"><label>Produto</label><select id="bProd">${opts("produtos", (x) => x.curta)}</select></div><div class="field"><label>Odômetro</label><input type="number" id="bOdo" value="${record?.odometro || 0}"></div><div class="field"><label>Motorista</label><input id="bMot" value="${html(record?.motorista || "")}"></div><div class="field"><label>Quantidade (L)</label><input type="number" step="0.01" id="bQt" value="${record?.qt || ""}"></div><div class="field"><label>Preço unitário</label><input type="number" step="0.0001" id="bPreco" value="${record?.preco || ""}"></div><div class="field"><label>Valor total calculado</label><input id="bTotal" value="${record ? Number(record.total || 0).toFixed(2) : "0.00"}" disabled></div><div class="field"><label>Unidade Vixpar</label><select id="bUnid">${opts("unidades", (x) => x.nome)}</select></div><div class="field"><label>Centro de Custo</label><input id="bCc" value="${html(record?.centroCusto || "")}"></div><div class="field"><label>Origem</label><select id="bOrig"><option>DirectFuel</option><option>Ticketlog</option><option>Manual</option><option>CSV</option></select></div></div><div class="reconcile-box" id="bAgreementValidation"><div><span>Validação do acordo na data</span><strong id="bAgreementStatus">Preencha os dados</strong></div><div><span>Preço acordado</span><strong id="bAgreementPrice">-</strong></div><div><span>Diferença / L</span><strong id="bAgreementDiff">-</strong></div><div><span>Impacto total</span><strong id="bAgreementImpact">-</strong></div><p id="bAgreementMessage">O sistema localizará o acordo pelo posto, produto e data.</p></div><div class="field" id="bJustificationField" style="display:none;margin-top:14px"><label>Justificativa administrativa</label><textarea id="bPriceJustification" placeholder="Informe o motivo para gravar esta divergência">${html(record?.priceOverrideJustification || "")}</textarea></div>${record ? '<p class="note" style="margin-top:14px">A alteração será registrada na Auditoria com data, hora e usuário.</p>' : ""}`, (back) => {
      const plate = val("bPlaca"), fleet = db.frota.find((item) => item.placa === plate), quantity = nval("bQt"), price = nval("bPreco");
      if (!val("bData") || !plate || !quantity || !price) return toast("Preencha data, placa, quantidade e preço");
      const updated = { id: record?.id || uid("AB"), data: val("bData"), hora: val("bHora"), postoId: val("bPosto"), placa: plate, veiculo: fleet?.modelo || "", odometro: nval("bOdo"), motorista: val("bMot"), produtoId: val("bProd"), qt: quantity, preco: price, total: quantity * price, unidadeId: val("bUnid"), centroCusto: val("bCc"), origem: val("bOrig"), medicaoId: record?.medicaoId || null };
      const measurementJustification=measurementEdit?val("bMeasurementEditJustification").trim():"";
      if(measurementEdit&&measurementJustification.length<5)return toast("Informe a justificativa da alteração com pelo menos 5 caracteres");
      if (db.abastecimentos.some((item) => item.id !== updated.id && fuelingKey(item) === fuelingKey(updated))) return alert("Este abastecimento já está cadastrado. Verifique data, hora, posto, placa, produto, quantidade, preço e odômetro.");
      const check = window.directFuelAgreementCheck?.(updated), justification = val("bPriceJustification");
      if (check?.unresolved && !isAdministrator()) return alert(`${check.code}. É necessária permissão de editar abastecimentos para gravar mediante justificativa.`);
      if (check?.unresolved && justification.length < 5) return toast("Informe uma justificativa administrativa para a divergência");
      if (window.directFuelValidationFields) Object.assign(updated, window.directFuelValidationFields(updated, check?.unresolved ? justification : ""));
      if (record) {
        const index = db.abastecimentos.findIndex((item) => item.id === record.id);
        if (index < 0 || (db.abastecimentos[index].medicaoId&&!sameMeasurement)) return toast("Este abastecimento já foi vinculado a outra medição e não pode ser alterado");
        if(measurementEdit)Object.assign(updated,{measurementEditJustification:measurementJustification,measurementEditBy:currentUser(),measurementEditAt:new Date().toISOString(),measurementEditId:context.measurementId||""});
        context.onBeforeSave?.(updated,measurementJustification);
        if(measurementEdit)Object.assign(db.abastecimentos[index],record,updated);else db.abastecimentos[index] = { ...record, ...updated };
        audit(measurementEdit?"Alteração na conferência":"Alteração", "Abastecimento", measurementEdit?`${record.id} · Medição ${context.measurementNumber||context.measurementId||"-"} · NF ${context.invoiceNumber||"-"} · Justificativa: ${measurementJustification}`:`${record.id} por ${currentUser()}`);
        save(measurementEdit?"Abastecimento ajustado na conferência":"Abastecimento pendente atualizado");
      } else {
        db.abastecimentos.push(updated);
        audit("Inclusão", "Abastecimento", plate);
        save("Abastecimento registrado");
      }
      back.remove(); if(measurementEdit)context.onSaved?.(db.abastecimentos.find(item=>item.id===record.id),measurementJustification);else render();
    });
    setTimeout(() => {
      if(measurementEdit){const backs=$$(".modal-back"),dialog=backs.at(-1);if(dialog){const title=dialog.querySelector(".modal h3");if(title)title.textContent=`Editar abastecimento ${record.id}`;const agreementBox=dialog.querySelector("#bAgreementValidation");agreementBox?.insertAdjacentHTML("afterend",'<div class="field measurement-edit-reason"><label for="bMeasurementEditJustification">Justificativa da alteração na medição</label><textarea id="bMeasurementEditJustification" placeholder="Descreva o motivo da correção" required></textarea><small>Obrigatória. Será registrada com usuário, data, medição e NF.</small></div>');}}
      if (record) { $("#bPosto").value = record.postoId; $("#bProd").value = record.produtoId; $("#bUnid").value = record.unidadeId; $("#bOrig").value = record.origem || "Manual"; }
      const updateValidation = () => {
        const item = { data: val("bData"), postoId: val("bPosto"), produtoId: val("bProd"), preco: nval("bPreco"), qt: nval("bQt"), priceValidationOverride: record?.priceValidationOverride, priceOverrideJustification: val("bPriceJustification") || record?.priceOverrideJustification };
        const check = window.directFuelAgreementCheck?.(item); if (!check) return;
        $("#bTotal").value = (item.qt * item.preco).toFixed(2); $("#bAgreementStatus").textContent = check.code; $("#bAgreementPrice").textContent = check.agreedPrice === null ? "-" : money(check.agreedPrice); $("#bAgreementDiff").textContent = check.differenceUnit === null ? "-" : money(check.differenceUnit); $("#bAgreementImpact").textContent = check.differenceTotal === null ? "-" : money(check.differenceTotal);
        const resolved = check.code === "Conforme" || (isAdministrator() && val("bPriceJustification").length >= 5); $("#bAgreementValidation").classList.toggle("ok", resolved); $("#bAgreementValidation").classList.toggle("bad", !resolved); $("#bAgreementMessage").textContent = check.code === "Conforme" ? "Preço compatível com o acordo válido na data." : isAdministrator() ? "Informe uma justificativa para gravar esta ocorrência." : "A gravação exige correção ou autorização administrativa."; $("#bJustificationField").style.display = check.code === "Conforme" || !isAdministrator() ? "none" : "block";
      };
      ["bData", "bPosto", "bProd", "bQt", "bPreco", "bPriceJustification"].forEach((id) => $("#" + id)?.addEventListener("input", updateValidation)); ["bPosto", "bProd"].forEach((id) => $("#" + id)?.addEventListener("change", updateValidation));
      const plateInput = $("#bPlacaSearch"), plateValue = $("#bPlaca"), plateOptions = $("#bPlacaOptions"), plateMeta = $("#bPlacaMeta");
      let visibleFleet = [], activePlateIndex = -1;
      const applyFleet = (fleet) => {
        if (!fleet) return;
        plateValue.value = fleet.placa || ""; plateInput.value = fleet.placa || ""; plateOptions.hidden = true; plateInput.setAttribute("aria-expanded", "false"); activePlateIndex = -1;
        $("#bUnid").value = fleet.unidadeId || ""; $("#bCc").value = fleet.centroCusto || ""; $("#bProd").value = fleet.produtoId || ""; plateMeta.textContent = `${fleet.placa}${fleet.modelo ? ` · ${fleet.modelo}` : ""}`; updateValidation();
      };
      const drawPlateOptions = () => {
        visibleFleet = plateSearchFleet(plateInput.value); activePlateIndex = -1;
        const shown = visibleFleet.slice(0, 60);
        plateOptions.innerHTML = shown.length ? shown.map((fleet, index) => `<button type="button" class="plate-option" role="option" data-index="${index}" aria-selected="false"><strong>${html(fleet.placa || "Sem placa")}</strong><span>${html(fleet.modelo || "Modelo não informado")}</span></button>`).join("") : '<div class="plate-empty">Nenhuma placa encontrada.</div>';
        plateMeta.textContent = visibleFleet.length ? `${visibleFleet.length} placa(s) encontrada(s), em ordem alfabética${visibleFleet.length > shown.length ? ` · exibindo ${shown.length}` : ""}.` : "Nenhuma placa corresponde à pesquisa.";
        plateOptions.hidden = false; plateInput.setAttribute("aria-expanded", "true");
        plateOptions.querySelectorAll(".plate-option").forEach((button) => button.addEventListener("mousedown", (event) => { event.preventDefault(); applyFleet(shown[Number(button.dataset.index)]); }));
      };
      const highlightPlate = () => plateOptions.querySelectorAll(".plate-option").forEach((button, index) => { const active = index === activePlateIndex; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); if (active) button.scrollIntoView({ block: "nearest" }); });
      plateInput.addEventListener("focus", drawPlateOptions);
      plateInput.addEventListener("input", () => {
        const exact = plateSearchFleet(plateInput.value).find((fleet) => plateSearchKey(fleet.placa) === plateSearchKey(plateInput.value));
        plateValue.value = exact?.placa || ""; drawPlateOptions();
        if (exact) { $("#bUnid").value = exact.unidadeId || ""; $("#bCc").value = exact.centroCusto || ""; $("#bProd").value = exact.produtoId || ""; plateMeta.textContent = `Correspondência exata: ${exact.placa}${exact.modelo ? ` · ${exact.modelo}` : ""}`; updateValidation(); }
      });
      plateInput.addEventListener("keydown", (event) => {
        const optionCount = Math.min(visibleFleet.length, 60);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (plateOptions.hidden) drawPlateOptions(); activePlateIndex = event.key === "ArrowDown" ? (activePlateIndex + 1) % Math.max(optionCount, 1) : (activePlateIndex - 1 + Math.max(optionCount, 1)) % Math.max(optionCount, 1); highlightPlate(); }
        else if (event.key === "Enter" && activePlateIndex >= 0) { event.preventDefault(); applyFleet(visibleFleet[activePlateIndex]); }
        else if (event.key === "Escape") { plateOptions.hidden = true; plateInput.setAttribute("aria-expanded", "false"); }
      });
      plateInput.addEventListener("blur", () => setTimeout(() => { plateOptions.hidden = true; plateInput.setAttribute("aria-expanded", "false"); }, 120));
      if (record) { const fleet = db.frota.find((item) => item.placa === record.placa); plateMeta.textContent = fleet ? `${fleet.placa}${fleet.modelo ? ` · ${fleet.modelo}` : ""}` : "Placa cadastrada anteriormente."; }
      updateValidation();
    }, 0);
  }

  formAb = function () { fuelingForm(); };

  abastecimentos = function () {
    pageTitle("Abastecimentos", "Carga operacional e correção de registros pendentes");
    const admin = isAdministrator();
    let repaired = 0; db.abastecimentos.forEach((item) => { const normalized = normalizeFuelingDate(item.data); if (normalized && normalized !== item.data) { item.data = normalized; repaired++; } });
    if (repaired) { audit("Correção automática", "Abastecimentos", `${repaired} data(s) normalizada(s)`); save(`${repaired} data(s) de abastecimento corrigida(s)`); }
    const invalidDates = db.abastecimentos.filter((item) => !normalizeFuelingDate(item.data)).length;
    $("#view").innerHTML = `<div class="panel"><div class="toolbar"><button class="btn primary" id="newAb">+ Novo abastecimento</button><label class="btn secondary">Importar CSV<input id="csvAb" type="file" accept=".csv" hidden></label></div>${admin ? '<p class="note">Perfil Administrador: abastecimentos pendentes podem ser editados. Registros já vinculados a uma medição permanecem bloqueados.</p>' : ""}${invalidDates ? `<p class="note invalid-note">Foram encontrados ${invalidDates} registro(s) com data inválida. Um administrador deve usar “Editar” para corrigir esses abastecimentos pendentes.</p>` : ""}<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>ID</th><th>Data</th><th>Hora</th><th>Posto</th><th>Placa</th><th>Produto</th><th>Odômetro</th><th>Motorista</th><th>Qt</th><th>Preço</th><th>Total</th><th>Filial</th><th>Medição</th><th>Validação</th>${admin ? "<th>Ações</th>" : ""}</tr></thead><tbody>${db.abastecimentos.map((a) => { const agreement = db.acordos.find((x) => x.postoId === a.postoId && x.produtoId === a.produtoId && x.status === "Vigente"), fleet = db.frota.find((x) => x.placa === a.placa), validDate = normalizeFuelingDate(a.data), issues = []; if (!validDate) issues.push("Data"); if (agreement && Math.abs(a.preco - agreement.preco) > .001) issues.push("Preço"); if (fleet && a.qt > fleet.capTanque) issues.push("Volume"); if (!db.rede.some((r) => r.postoId === a.postoId && r.unidadeId === a.unidadeId && r.produtoId === a.produtoId && r.ativo)) issues.push("Rede"); return `<tr><td>${html(a.id)}</td><td>${validDate ? dateBR(validDate) : badge("Data inválida")}</td><td>${html(a.hora)}</td><td>${html(postoNome(a.postoId))}</td><td>${html(a.placa)}</td><td>${html(produtoNome(a.produtoId))}</td><td>${num(a.odometro)}</td><td>${html(a.motorista)}</td><td>${num(a.qt)} L</td><td>${money(a.preco)}</td><td>${money(a.total)}</td><td>${html(unidadeNome(a.unidadeId))}</td><td>${a.medicaoId ? badge("Medido") : badge("Pendente")}</td><td>${issues.length ? badge(issues.join(", ")) : badge("OK")}</td>${admin ? `<td>${!a.medicaoId ? `<button class="btn small secondary editFuel" data-id="${a.id}">Editar</button>` : '<span class="muted">Bloqueado</span>'}</td>` : ""}</tr>`; }).join("")}</tbody></table></div></div>`;
    $("#newAb").onclick = () => fuelingForm(); $("#csvAb").onchange = importFuelingCsv;
    $$(".editFuel").forEach((button) => button.onclick = () => fuelingForm(db.abastecimentos.find((item) => item.id === button.dataset.id)));
    const toolbar = document.querySelector("#view .toolbar"); if (toolbar && typeof window.directFuelAddBulkControls === "function") window.directFuelAddBulkControls("abastecimentos", toolbar);
  };

  function measurementReconciliation(med) {
    const items = db.abastecimentos.filter((item) => (med.itens || []).includes(item.id));
    const quantity = items.reduce((sum, item) => sum + Number(item.qt || 0), 0);
    const amount = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const nfQuantity = Number(med.qtNf || 0), nfAmount = Number(med.valorNf || 0);
    return { quantity, amount, nfQuantity, nfAmount, quantityDifference: nfQuantity - quantity, amountDifference: nfAmount - amount, reconciled: nfQuantity > 0 && nfAmount > 0 && Math.abs(nfQuantity - quantity) <= .01 && Math.abs(nfAmount - amount) <= .01 };
  }

  medicoes = function () {
    pageTitle("Medições", "Vincule abastecimentos à nota fiscal e acompanhe quem salvou e aprovou");
    const pending = db.abastecimentos.filter((item) => !item.medicaoId);
    $("#view").innerHTML = `<div class="panel"><div class="toolbar"><label>De <input type="date" id="mDe" class="btn secondary"></label><label>Até <input type="date" id="mAte" class="btn secondary"></label><select id="mPosto" class="btn secondary"><option value="">Todos os postos</option>${opts("postos", (item) => item.fantasia || item.razao)}</select><button class="btn secondary" id="filtrarM">Filtrar</button><button class="btn primary" id="criarM">Criar medição com selecionados</button></div><div id="pendTable"></div></div>
    <div class="panel"><h2>Medições realizadas / em andamento</h2><div class="table-wrap"><table><thead><tr><th>Medição</th><th>Posto</th><th>Período</th><th>NF</th><th>Qt abastecida</th><th>Valor medição</th><th>Valor NF</th><th>Diferença</th><th>Status</th><th>Salvo por / Aprovado por</th><th>Ações</th></tr></thead><tbody>${db.medicoes.map((m) => { const reconciliation = measurementReconciliation(m); return `<tr><td>${html(m.numero)}</td><td>${html(postoNome(m.postoId))}</td><td>${dateBR(m.inicio)} a ${dateBR(m.fim)}</td><td>${html(m.nf || "-")}</td><td>${num(reconciliation.quantity)} L</td><td>${money(reconciliation.amount)}</td><td>${money(reconciliation.nfAmount)}</td><td class="${Math.abs(reconciliation.amountDifference) <= .01 ? "price-good" : "price-bad"}">${money(reconciliation.amountDifference)}</td><td>${badge(m.status)}</td><td>${medUserLine(m)}</td><td>${m.status !== "Aprovada" ? `<button class="btn small primary approveM" data-id="${m.id}">Aprovar</button>` : "-"}</td></tr>`; }).join("") || '<tr><td colspan="11" class="muted">Nenhuma medição criada.</td></tr>'}</tbody></table></div></div>`;
    function draw() {
      const rows = pending.filter((item) => (!val("mDe") || item.data >= val("mDe")) && (!val("mAte") || item.data <= val("mAte")) && (!val("mPosto") || item.postoId === val("mPosto")));
      $("#pendTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th class="checkcell"><input type="checkbox" id="selAll"></th><th>Data</th><th>Posto</th><th>Placa</th><th>Produto</th><th>Filial</th><th>Centro de Custo</th><th>Qt</th><th>Valor</th></tr></thead><tbody>${rows.map((a) => { const fleet = db.frota.find((f) => f.placa === a.placa); return `<tr><td><input type="checkbox" class="selM" value="${a.id}"></td><td>${dateBR(a.data)}</td><td>${html(postoNome(a.postoId))}</td><td>${html(a.placa)}</td><td>${html(produtoNome(a.produtoId))}</td><td>${html(unidadeNome(a.unidadeId))}</td><td>${html(fleet?.centroCusto || a.centroCusto || "-")}</td><td>${num(a.qt)} L</td><td>${money(a.total)}</td></tr>`; }).join("") || '<tr><td colspan="9" class="muted">Nenhum abastecimento pendente para o filtro.</td></tr>'}</tbody></table></div>`;
      if ($("#selAll")) $("#selAll").onchange = (event) => $$(".selM").forEach((item) => { item.checked = event.target.checked; });
    }
    draw();
    $("#filtrarM").onclick = draw;
    $("#criarM").onclick = () => { const ids = $$(".selM:checked").map((item) => item.value); if (!ids.length) return toast("Selecione ao menos um abastecimento"); formMedicao(ids); };
    $$(".approveM").forEach((button) => button.onclick = () => {
      const med = db.medicoes.find((item) => item.id === button.dataset.id);
      if (!med) return;
      const invoiceIssue = window.directFuelInvoiceIssue?.(med);
      if (invoiceIssue) return alert(invoiceIssue);
      const reconciliation = measurementReconciliation(med);
      if (!reconciliation.reconciled) return alert(`A medição não pode ser aprovada.\n\nValor da medição: ${money(reconciliation.amount)}\nValor da NF: ${money(reconciliation.nfAmount)}\nDiferença: ${money(reconciliation.amountDifference)}\n\nCorrija os abastecimentos pendentes ou refaça a seleção para totalizar exatamente a NF.`);
      if (!confirm(`Aprovar a medição ${med.numero}?`)) return;
      med.status = "Aprovada";
      med.aprovadoPor = currentUser();
      med.aprovadoEm = new Date().toISOString();
      audit("Aprovação", "Medição", `${med.numero} por ${med.aprovadoPor}`);
      save("Medição aprovada");
      render();
    });
  };

  formMedicao = function (ids) { return window.directFuelInvoiceEditor(ids); };

  function reportFilters() {
    return { numero: val("rNumero").toLowerCase(), nf: val("rNf").toLowerCase(), status: val("rStatus"), de: val("rDe"), ate: val("rAte"), postoId: val("rPosto") };
  }

  function filteredMeasurements(filters) {
    if (filters.status === "Pendente de medição") return [];
    return db.medicoes.filter((m) => (!filters.numero || String(m.numero || "").toLowerCase().includes(filters.numero)) && (!filters.nf || String(m.nf || "").toLowerCase().includes(filters.nf)) && (!filters.status || m.status === filters.status) && (!filters.de || (m.fim || m.inicio) >= filters.de) && (!filters.ate || m.inicio <= filters.ate) && (!filters.postoId || m.postoId === filters.postoId));
  }

  function reportRows(mode, filters = {}) {
    const measurements = new Map(filteredMeasurements(filters).map((m) => [m.id, m]));
    const detail = db.abastecimentos.filter((a) => a.medicaoId && measurements.has(a.medicaoId)).map((a) => {
      const m = measurements.get(a.medicaoId), fleet = db.frota.find((f) => f.placa === a.placa);
      return { medicao: m.numero, nf: Array.isArray(m.notasFiscais) ? m.notasFiscais.filter((n) => (n.abastecimentoIds||n.itens||[]).includes(a.id)).map((n) => n.numero).join("; ") : m.nf || "", status: m.status, salvoPor: m.salvoPor || m._meta?.createdBy || "", salvoEm: m.salvoEm || m._meta?.createdAt || "", aprovadoPor: m.aprovadoPor || "", aprovadoEm: m.aprovadoEm || "", data: a.data, hora: a.hora || "", posto: postoNome(a.postoId), placa: a.placa, veiculo: a.veiculo || fleet?.modelo || "", motorista: a.motorista || "", produto: produtoNome(a.produtoId), centroCusto: fleet?.centroCusto || a.centroCusto || "Sem centro de custo", filial: unidadeNome(fleet?.unidadeId || a.unidadeId), quantidade: Number(a.qt || 0), preco: Number(a.preco || 0), total: Number(a.total || 0), odometro: Number(a.odometro || 0), origem: a.origem || "" };
    });
    if (mode === "detalhado") return detail;
    const groups = new Map();
    detail.forEach((row) => {
      const key = `${row.centroCusto}|${row.produto}`;
      const group = groups.get(key) || { centroCusto: row.centroCusto, produto: row.produto, abastecimentos: 0, quantidade: 0, total: 0, nfs: new Set(), salvosPor: new Set(), salvosEm: new Set(), aprovadosPor: new Set(), aprovadosEm: new Set() };
      group.abastecimentos++; group.quantidade += row.quantidade; group.total += row.total;
      if (row.nf) group.nfs.add(row.nf);
      if (row.salvoPor) group.salvosPor.add(row.salvoPor);
      if (row.salvoEm) group.salvosEm.add(new Date(row.salvoEm).toLocaleString("pt-BR"));
      if (row.aprovadoPor) group.aprovadosPor.add(row.aprovadoPor);
      if (row.aprovadoEm) group.aprovadosEm.add(new Date(row.aprovadoEm).toLocaleString("pt-BR"));
      groups.set(key, group);
    });
    return [...groups.values()].map((group) => ({ centroCusto: group.centroCusto, produto: group.produto, numeroNf: [...group.nfs].join("; "), salvoPor: [...group.salvosPor].join("; "), salvoEm: [...group.salvosEm].join("; "), aprovadoPor: [...group.aprovadosPor].join("; "), aprovadoEm: [...group.aprovadosEm].join("; "), abastecimentos: group.abastecimentos, quantidade: group.quantidade, total: group.total, precoMedio: group.quantidade ? group.total / group.quantidade : 0 }));
  }

  function reportTable(mode, filters) {
    const rows = reportRows(mode, filters);
    if (mode === "detalhado") return `<div class="table-wrap"><table><thead><tr><th>Medição</th><th>NF</th><th>Status</th><th>Data/Hora</th><th>Posto</th><th>Placa</th><th>Veículo</th><th>Motorista</th><th>Produto</th><th>Centro de Custo</th><th>Filial</th><th>Qt</th><th>Preço</th><th>Total</th><th>Odômetro</th><th>Origem</th><th>Salvo por</th><th>Aprovado por</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${html(r.medicao)}</td><td>${html(r.nf || "-")}</td><td>${badge(r.status)}</td><td>${dateBR(r.data)} ${html(r.hora)}</td><td>${html(r.posto)}</td><td>${html(r.placa)}</td><td>${html(r.veiculo)}</td><td>${html(r.motorista)}</td><td>${html(r.produto)}</td><td>${html(r.centroCusto)}</td><td>${html(r.filial)}</td><td>${num(r.quantidade)} L</td><td>${money(r.preco)}</td><td>${money(r.total)}</td><td>${num(r.odometro)}</td><td>${html(r.origem)}</td><td>${html(r.salvoPor || "-")}</td><td>${html(r.aprovadoPor || "-")}</td></tr>`).join("") || '<tr><td colspan="18" class="muted">Sem abastecimentos medidos.</td></tr>'}</tbody></table></div>`;
    return `<div class="table-wrap"><table><thead><tr><th>Centro de Custo</th><th>Produto</th><th>Número NF</th><th>Salvo por</th><th>Data/Hora salvamento</th><th>Aprovado por</th><th>Data/Hora aprovação</th><th>Abastecimentos</th><th>Quantidade</th><th>Preço médio</th><th>Valor total</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${html(r.centroCusto)}</td><td>${html(r.produto)}</td><td>${html(r.numeroNf || "-")}</td><td>${html(r.salvoPor || "-")}</td><td>${html(r.salvoEm || "-")}</td><td>${html(r.aprovadoPor || "-")}</td><td>${html(r.aprovadoEm || "-")}</td><td>${r.abastecimentos}</td><td>${num(r.quantidade)} L</td><td>${money(r.precoMedio)}</td><td>${money(r.total)}</td></tr>`).join("") || '<tr><td colspan="11" class="muted">Sem abastecimentos medidos.</td></tr>'}</tbody></table></div>`;
  }

  function pendingReportRows(filters = {}) {
    if ((filters.status && filters.status !== "Pendente de medição")) return [];
    const groups = new Map();
    db.abastecimentos.filter((a) => !a.medicaoId && (!filters.de || a.data >= filters.de) && (!filters.ate || a.data <= filters.ate) && (!filters.postoId || a.postoId === filters.postoId)).forEach((a) => {
      const fleet = db.frota.find((f) => f.placa === a.placa), key = [a.postoId, a.unidadeId, a.produtoId, fleet?.centroCusto || a.centroCusto || ""].join("|");
      const group = groups.get(key) || { posto: postoNome(a.postoId), inicio: a.data, fim: a.data, filial: unidadeNome(a.unidadeId), centroCusto: fleet?.centroCusto || a.centroCusto || "Sem centro de custo", produto: produtoNome(a.produtoId), abastecimentos: 0, quantidade: 0, total: 0, status: "Pendente de medição" };
      group.abastecimentos++; group.quantidade += Number(a.qt || 0); group.total += Number(a.total || 0); group.inicio = a.data < group.inicio ? a.data : group.inicio; group.fim = a.data > group.fim ? a.data : group.fim; groups.set(key, group);
    });
    return [...groups.values()];
  }

  function pendingReportTable(filters) {
    const rows = pendingReportRows(filters);
    return `<div class="table-wrap"><table><thead><tr><th>Status</th><th>Posto</th><th>Período</th><th>Filial</th><th>Centro de Custo</th><th>Produto</th><th>Abastecimentos</th><th>Qt</th><th>Valor</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${badge(r.status)}</td><td>${html(r.posto)}</td><td>${dateBR(r.inicio)} a ${dateBR(r.fim)}</td><td>${html(r.filial)}</td><td>${html(r.centroCusto)}</td><td>${html(r.produto)}</td><td>${r.abastecimentos}</td><td>${num(r.quantidade)} L</td><td>${money(r.total)}</td></tr>`).join("") || '<tr><td colspan="9" class="muted">Sem pendências para os filtros informados.</td></tr>'}</tbody></table></div>`;
  }

  const agreementColumns = [["Acordo", "numero"], ["Posto", "posto"], ["Unidade", "unidade"], ["Produto", "produto"], ["Base supridora", "base"], ["Condição de pagamento", "condicaoPagamento"], ["Responsável", "responsavel"], ["Início vigência", "inicio"], ["Fim vigência", "fim"], ["Status", "status"], ["Volume mensal (L)", "volume"], ["Taxa financeira (%)", "taxa"], ["Periodicidade", "periodicidade"], ["DirectFuel bruto", "directBruto"], ["DirectFuel ciclo (dias)", "directCiclo"], ["DirectFuel pagamento (dias)", "directPagamento"], ["DirectFuel prazo médio (dias)", "directPrazoMedio"], ["DirectFuel rebate (%)", "directRebate"], ["DirectFuel taxa adm. (%)", "directAdm"], ["DirectFuel valor presente", "directValorPresente"], ["DirectFuel benefício financeiro", "directBeneficio"], ["DirectFuel líquido", "directLiquido"], ["Ticketlog bruto", "ticketBruto"], ["Ticketlog ciclo (dias)", "ticketCiclo"], ["Ticketlog pagamento (dias)", "ticketPagamento"], ["Ticketlog prazo médio (dias)", "ticketPrazoMedio"], ["Ticketlog rebate (%)", "ticketRebate"], ["Ticketlog taxa adm. (%)", "ticketAdm"], ["Ticketlog valor presente", "ticketValorPresente"], ["Ticketlog benefício financeiro", "ticketBeneficio"], ["Ticketlog líquido", "ticketLiquido"], ["Paramétrica FOB", "fob"], ["Frete / L", "frete"], ["Margem posto (%)", "margem"], ["Preço alvo bruto", "alvoBruto"], ["Preço alvo líquido", "alvoLiquido"], ["Economia unitária vs Ticketlog", "economiaUnitaria"], ["Economia mensal vs Ticketlog", "economiaMensal"], ["Observações", "observacoes"]];

  function agreementReportRows(all=false) {
    const rows = db.acordos.map((a) => {
      const c = agreementCalc(a), p = a.calculator || {};
      return { numero: a.numero, posto: postoNome(a.postoId), unidade: unidadeNome(a.unidadeId), produto: produtoNome(a.produtoId), base: baseNome(a.baseId), condicaoPagamento: a.condicaoPagamento || "Boleto", responsavel: a.responsavel || "", inicio: a.inicio || "", fim: a.fim || "9999-12-31", status: window.DirectFuelImportRules.effectiveAgreementStatus(a), volume: c.volume, taxa: c.rate, periodicidade: c.periodDays === 365 ? "Anual" : "Mensal", directBruto: c.direct.gross, directCiclo: c.direct.cycle, directPagamento: c.direct.payment, directPrazoMedio: c.direct.financeDays, directRebate: Number(p.directRebate ?? 1), directAdm: Number(p.directAdm ?? a.taxaAdm ?? 1), directValorPresente: c.direct.presentValue, directBeneficio: c.direct.financeBenefit, directLiquido: c.direct.net, ticketBruto: c.ticket.gross, ticketCiclo: c.ticket.cycle, ticketPagamento: c.ticket.payment, ticketPrazoMedio: c.ticket.financeDays, ticketRebate: Number(p.ticketRebate ?? .5), ticketAdm: Number(p.ticketAdm ?? 1), ticketValorPresente: c.ticket.presentValue, ticketBeneficio: c.ticket.financeBenefit, ticketLiquido: c.ticket.net, fob: c.fob, frete: c.freight, margem: c.margin, alvoBruto: c.target.gross, alvoLiquido: c.target.net, economiaUnitaria: c.ticket.net - c.direct.net, economiaMensal: (c.ticket.net - c.direct.net) * c.volume, observacoes: a.obs || "" };
    });
    return all?rows:filterTheme(rows,"prices");
  }

  function agreementReportTable() {
    const currencyKeys = new Set(["directBruto", "directValorPresente", "directBeneficio", "directLiquido", "ticketBruto", "ticketValorPresente", "ticketBeneficio", "ticketLiquido", "fob", "frete", "alvoBruto", "alvoLiquido", "economiaUnitaria", "economiaMensal"]);
    const rows = agreementReportRows();
    return `<div class="table-wrap"><table><thead><tr>${agreementColumns.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${agreementColumns.map(([, key]) => `<td>${currencyKeys.has(key) ? money(row[key]) : html(row[key])}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${agreementColumns.length}" class="muted">Nenhum acordo cadastrado.</td></tr>`}</tbody></table></div>`;
  }

  const themeFilters = {prices:{},stations:{},ticketStations:{}};
  let ticketStations=null, ticketLoading=false, ticketError='';
  const ticketColumns=[['Código Ticketlog','source_code'],['Nome do posto','name'],['CNPJ','cnpj'],['Endereço','address'],['Bairro','neighborhood'],['Município','city'],['UF','uf'],['CEP','cep'],['Latitude','latitude'],['Longitude','longitude'],['Georreferência','geocode_status'],['Status','status'],['Criado em','created_at'],['Criado por','created_by'],['Atualizado em','updated_at'],['Atualizado por','updated_by']];
  const normReport=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function filterTheme(rows,theme) {
    const f=themeFilters[theme];
    return rows.filter(r=>(!f.search||normReport(Object.values(r).join(' ')).includes(normReport(f.search)))&&(!f.status||r.status===f.status)&&(!f.uf||r.uf===f.uf)&&(!f.city||normReport(r.municipio||r.city).includes(normReport(f.city)))&&(!f.product||r.produto===f.product)&&(!f.from||r.fim>=f.from)&&(!f.to||r.inicio<=f.to));
  }
  function themeControls(theme,rows) {
    const f=themeFilters[theme],options=key=>[...new Set(rows.map(r=>r[key]).filter(Boolean))].sort().map(v=>`<option ${f[key==='produto'?'product':key]===v?'selected':''}>${html(v)}</option>`).join('');
    const input=(key,label,type='text')=>`<div class="field"><label>${label}</label><input data-theme="${theme}" data-key="${key}" type="${type}" value="${html(f[key]||'')}"></div>`;
    return `<div class="form-grid">${input('search',theme==='prices'?'Buscar acordo ou posto':'Buscar nome, código ou CNPJ')}<div class="field"><label>Status</label><select data-theme="${theme}" data-key="status"><option value="">Todos</option>${options('status')}</select></div>${theme==='prices'?`<div class="field"><label>Produto</label><select data-theme="${theme}" data-key="product"><option value="">Todos</option>${options('produto')}</select></div>${input('from','Vigência sobreposta — de','date')}${input('to','Vigência sobreposta — até','date')}`:`<div class="field"><label>UF</label><select data-theme="${theme}" data-key="uf"><option value="">Todas</option>${options('uf')}</select></div>${input('city','Município')}`}</div><div class="toolbar"><button class="btn primary" data-theme-apply="${theme}">Aplicar filtros</button><button class="btn secondary" data-theme-clear="${theme}">Limpar filtros</button></div>`;
  }
  function bindThemeControls() {
    $$('[data-theme-apply]').forEach(b=>b.onclick=()=>{const t=b.dataset.themeApply;$$(`[data-theme="${t}"]`).forEach(e=>themeFilters[t][e.dataset.key]=e.value);drawThemes();});
    $$('[data-theme-clear]').forEach(b=>b.onclick=()=>{themeFilters[b.dataset.themeClear]={};drawThemes();});
  }
  function drawThemes() {
    if($('#agreementReport')) $('#agreementReport').innerHTML=themeControls('prices',agreementReportRows(true))+agreementReportTable();
    if($('#stationReportPanel')) $('#stationReportPanel').innerHTML='<h2>Posto DirectFuel — cadastro</h2>'+themeControls('stations',stationReportRows(true))+stationReportTable();
    const rows=(ticketStations||[]).map(p=>({...p,status:Number(p.active)?'Ativo':'Inativo'}));
    if($('#ticketStationReportPanel')) $('#ticketStationReportPanel').innerHTML='<h2>Posto Ticketlog — cadastro</h2>'+themeControls('ticketStations',rows)+(ticketLoading?'<p>Carregando cadastro Ticketlog…</p>':ticketError?`<p role="alert">${html(ticketError)}</p><button class="btn secondary" id="retryTicketReport">Tentar novamente</button>`:themeTable(ticketColumns,filterTheme(rows,'ticketStations')));
    bindThemeControls();if($('#retryTicketReport'))$('#retryTicketReport').onclick=loadTicketReport;
  }
  async function loadTicketReport() {
    if(ticketLoading)return;ticketLoading=true;ticketError='';drawThemes();
    try {let offset=0,rows=[];do {const response=await fetch('/api/ticketlog?report=stations&offset='+offset,{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'Falha ao carregar postos Ticketlog');rows.push(...data.stations);offset=data.nextOffset;}while(offset!==null);ticketStations=rows;}catch(e){ticketError=e.message;}finally{ticketLoading=false;if($('#ticketStationReportPanel'))drawThemes();}
  }
  function themeTable(columns,rows) {
    return `<p class="muted">${rows.length} registro(s)</p><div class="table-wrap" style="overflow-x:auto"><table><thead><tr>${columns.map(([label])=>`<th>${html(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(([,key])=>`<td>${html(r[key]??'')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${columns.length}">Nenhum registro para os filtros.</td></tr>`}</tbody></table></div>`;
  }
  const stationColumns = [["ID interno", "id"], ["Código do posto", "codigo"], ["Razão Social", "razao"], ["Nome Fantasia", "fantasia"], ["CNPJ", "cnpj"], ["Nomes do posto na Gekon", "gekonNames"], ["Inscrição Estadual", "ie"], ["Endereço", "endereco"], ["Bairro", "bairro"], ["Município", "municipio"], ["UF", "uf"], ["CEP", "cep"], ["Latitude", "latitude"], ["Longitude", "longitude"], ["Bandeira", "bandeira"], ["Código SAP fornecedor", "sap"], ["ID base supridora", "baseId"], ["Base Supridora padrão", "baseNome"], ["Distância rodoviária (km)", "distancia"], ["Status", "status"], ["Contato comercial — Nome", "contComercial"], ["Contato comercial — Telefone", "telComercial"], ["Contato comercial — E-mail", "emailComercial"], ["Contato financeiro — Nome", "contFinanceiro"], ["Contato financeiro — Telefone", "telFinanceiro"], ["Contato financeiro — E-mail", "emailFinanceiro"], ["Status georreferência", "geocodeStatus"], ["Georreferência atualizada em", "geocodeUpdatedAt"], ["Georreferência atualizada por", "geocodeUpdatedBy"]];
  function stationReportRows(all=false) {
    const rows = (db.postos || []).map(p => ({...p, codigo:p.codigo||p.id||'', gekonNames:(p.gekonNames||[]).join(' | '), baseNome:p.baseId?baseNome(p.baseId):''}));
    return all?rows:filterTheme(rows,'stations');
  }
  function stationReportTable() {
    const rows=stationReportRows();
    return `<p class="muted">${rows.length} posto(s) cadastrado(s) · Conforme filtros · Uma coluna por campo do cadastro.</p><div class="table-wrap" style="overflow-x:auto"><table><thead><tr>${stationColumns.map(([label])=>`<th>${html(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${stationColumns.map(([,key])=>`<td>${html(row[key] ?? '')}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${stationColumns.length}">Nenhum posto cadastrado.</td></tr>`}</tbody></table></div>`;
  }

  function exportSelectedReports(mode, filters, only) {
    const selected = only ? [only] : $$(".export-choice:checked").map((item) => item.value);
    if (!selected.length) return toast("Marque ao menos um relatório para exportar");
    const detailedColumns = [["Medição", "medicao"], ["NF", "nf"], ["Status", "status"], ["Data", "data"], ["Hora", "hora"], ["Posto", "posto"], ["Placa", "placa"], ["Veículo", "veiculo"], ["Motorista", "motorista"], ["Produto", "produto"], ["Centro de Custo", "centroCusto"], ["Filial", "filial"], ["Quantidade (L)", "quantidade"], ["Preço unitário", "preco"], ["Valor total", "total"], ["Odômetro", "odometro"], ["Origem", "origem"], ["Salvo por", "salvoPor"], ["Aprovado por", "aprovadoPor"]];
    const summaryColumns = [["Centro de Custo", "centroCusto"], ["Produto", "produto"], ["Número NF", "numeroNf"], ["Salvo por", "salvoPor"], ["Data/Hora salvamento", "salvoEm"], ["Aprovado por", "aprovadoPor"], ["Data/Hora aprovação", "aprovadoEm"], ["Abastecimentos", "abastecimentos"], ["Quantidade (L)", "quantidade"], ["Preço médio", "precoMedio"], ["Valor total", "total"]];
    const pendingColumns = [["Status", "status"], ["Posto", "posto"], ["Início", "inicio"], ["Fim", "fim"], ["Filial", "filial"], ["Centro de Custo", "centroCusto"], ["Produto", "produto"], ["Abastecimentos", "abastecimentos"], ["Quantidade (L)", "quantidade"], ["Valor total", "total"]];
    const sheets = [];
    if (selected.includes("realizadas")) sheets.push({ name: mode === "detalhado" ? "Medições detalhadas" : "Medições resumidas", columns: mode === "detalhado" ? detailedColumns : summaryColumns, rows: reportRows(mode, filters) });
    if (selected.includes("pendentes")) sheets.push({ name: "Medições pendentes", columns: pendingColumns, rows: pendingReportRows(filters) });
    if (selected.includes("precos")) sheets.push({ name: "Preços e calculadora", columns: agreementColumns, rows: agreementReportRows() });
    if (selected.includes("postos")) sheets.push({ name: "Cadastro de postos", columns: stationColumns, rows: stationReportRows() });
    if (selected.includes("ticketStations")) {
      if(ticketLoading||ticketError||ticketStations===null)return toast('Carregue o cadastro Ticketlog antes de exportar.');
      sheets.push({name:'Postos Ticketlog',columns:ticketColumns,rows:filterTheme(ticketStations.map(p=>({...p,status:Number(p.active)?'Ativo':'Inativo'})),'ticketStations')});
    }
    const xmlCell = (value) => `<Cell><Data ss:Type="${typeof value === "number" && Number.isFinite(value) ? "Number" : "String"}">${html(value)}</Data></Cell>`;
    const worksheets = sheets.map((sheet) => `<Worksheet ss:Name="${sheet.name}"><Table><Row>${sheet.columns.map(([label]) => xmlCell(label)).join("")}</Row>${sheet.rows.map((row) => `<Row>${sheet.columns.map(([, key]) => xmlCell(row[key] ?? "")).join("")}</Row>`).join("")}</Table></Worksheet>`).join("");
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheets}</Workbook>`;
    const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel" }), link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `relatorios_directfuel_${new Date().toISOString().slice(0, 10)}.xls`; link.click(); URL.revokeObjectURL(link.href); toast(`${sheets.length} relatório(s) exportado(s)`);
  }

  relatorios = function () {
    const independent={report_prices:['Preço DirectFuel × Paramétrica × Ticketlog — memória completa','agreementReport','precos'],report_directfuel:['Posto DirectFuel — cadastro','stationReportPanel','postos'],report_ticketlog:['Posto Ticketlog — cadastro','ticketStationReportPanel','ticketStations']};
    const chosen=independent[route]||(route==='relatorios'?independent.report_prices:null);
    if(chosen){
      pageTitle(chosen[0],'Relatórios · Filtros e exportação deste relatório');
      $('#view').innerHTML=`<div class="panel export-panel"><button class="btn primary" id="exportExcel">Exportar Excel</button></div><div class="panel" id="${chosen[1]}"></div>`;
      drawThemes();
      $('#exportExcel').onclick=()=>exportSelectedReports('detalhado',{},chosen[2]);
      if(chosen[2]==='ticketStations')loadTicketReport();
      return;
    }

    pageTitle("Relatórios", "Medições aprovadas, pendências e memória completa de preços");
    const statuses = [...new Set(db.medicoes.map((m) => m.status).filter(Boolean))];
    $("#view").innerHTML = `<div class="panel report-filters"><h2>Filtros das medições</h2><div class="form-grid"><div class="field"><label>Número da medição</label><input id="rNumero" placeholder="Ex.: MED-2026-0001"></div><div class="field"><label>Número da NF</label><input id="rNf" placeholder="Número da nota"></div><div class="field"><label>Status</label><select id="rStatus"><option value="">Todos</option>${statuses.map((status) => `<option>${html(status)}</option>`).join("")}<option>Pendente de medição</option></select></div><div class="field"><label>Período — de</label><input type="date" id="rDe"></div><div class="field"><label>Período — até</label><input type="date" id="rAte"></div><div class="field"><label>Posto</label><select id="rPosto"><option value="">Todos os postos</option>${opts("postos", (item) => item.fantasia || item.razao)}</select></div></div><div class="toolbar" style="margin-top:14px"><button class="btn primary" id="applyReportFilters">Aplicar filtros</button><button class="btn secondary" id="clearReportFilters">Limpar filtros</button></div></div>
    <div class="panel export-panel"><div><h2>Exportação Excel</h2><p class="muted">Marque os relatórios que deseja incluir. Cada um será criado em uma aba separada.</p></div><div class="export-options"><label><input type="checkbox" class="export-choice" value="realizadas" checked> Medições aprovadas / realizadas</label><label><input type="checkbox" class="export-choice" value="pendentes" checked> Medições pendentes</label><label><input type="checkbox" class="export-choice" value="precos" checked> Preços e calculadora</label><label><input type="checkbox" class="export-choice" value="postos"> Postos DirectFuel</label><label><input type="checkbox" class="export-choice" value="ticketStations"> Postos Ticketlog</label><button class="btn primary" id="exportExcel">Exportar selecionados</button></div></div>
    <div class="panel"><div class="report-heading"><div><h2>Medições aprovadas / realizadas</h2><p class="muted">No detalhado, o Centro de Custo é obtido do cadastro da frota pela placa.</p></div><div class="toolbar"><select id="reportMode" class="btn secondary"><option value="detalhado">Detalhado — por abastecimento</option><option value="resumido">Resumido — Centro de Custo e produto</option></select></div></div><div id="measurementReport"></div></div>
    <div class="panel"><h2>Medições pendentes</h2><div id="pendingReport"></div></div>
    <div class="panel"><h2>Preço DirectFuel × Paramétrica × Ticketlog — memória completa</h2><div id="agreementReport">${agreementReportTable()}</div></div><div class="panel" id="stationReportPanel"><h2>Cadastro de postos</h2>${stationReportTable()}</div><div class="panel" id="ticketStationReportPanel"></div>`;
    const draw = () => { const filters = reportFilters(); $("#measurementReport").innerHTML = reportTable(val("reportMode"), filters); $("#pendingReport").innerHTML = pendingReportTable(filters); };
    draw();drawThemes();
    window.directFuelLoadTicketReport=()=>{if(ticketStations===null)loadTicketReport();};
    $("#reportMode").onchange = draw;
    $("#applyReportFilters").onclick = draw;
    $("#clearReportFilters").onclick = () => { ["rNumero", "rNf", "rStatus", "rDe", "rAte", "rPosto"].forEach((id) => { $("#" + id).value = ""; }); draw(); };
    $("#exportExcel").onclick = () => exportSelectedReports(val("reportMode"), reportFilters());
  };

  function scenario(gross, cycle, payment, rebatePct, admPct, rate, periodDays) {
    const financeDays = payment + cycle / 2;
    const presentValue = gross / Math.pow(1 + rate / 100, financeDays / periodDays);
    const financeBenefit = gross - presentValue, rebate = gross * rebatePct / 100, adm = gross * admPct / 100;
    return { gross, cycle, payment, financeDays, presentValue, financeBenefit, rebate, adm, net: gross - financeBenefit - rebate + adm };
  }

  function agreementCalc(a = {}) {
    const calculator = a.calculator || {}, periodDays = calculator.ratePeriod === "annual" ? 365 : 30, rate = Number(calculator.rate ?? a.taxaFin ?? db.config.params.taxaFinanceira ?? 1.36), volume = Number(calculator.volume ?? a.volumeMes ?? 0);
    const direct = scenario(Number(calculator.directGross ?? a.preco ?? 0), Number(calculator.directCycle ?? a.ciclo ?? 7), Number(calculator.directPayment ?? a.pagamento ?? 15), Number(calculator.directRebate ?? 1), Number(calculator.directAdm ?? a.taxaAdm ?? 1), rate, periodDays);
    const ticket = scenario(Number(calculator.ticketGross ?? a.ticketlog ?? 0), Number(calculator.ticketCycle ?? db.config.params.cicloTicketlog ?? 15), Number(calculator.ticketPayment ?? db.config.params.pagTicketlog ?? 45), Number(calculator.ticketRebate ?? .5), Number(calculator.ticketAdm ?? 1), rate, periodDays);
    const fob = Number(calculator.fob ?? a.fob ?? 0), freight = Number(calculator.freight ?? a.frete ?? 0), margin = Number(calculator.margin ?? a.margem ?? 8), targetGross = (fob + freight) * (1 + margin / 100);
    const target = scenario(targetGross, direct.cycle, direct.payment, direct.rebate / (direct.gross || 1) * 100, direct.adm / (direct.gross || 1) * 100, rate, periodDays);
    return { rate, periodDays, volume, fob, freight, margin, direct, ticket, target };
  }

  function readCalculator() {
    const data = { rate: nval("cRate"), ratePeriod: val("cRatePeriod"), volume: nval("cVolume"), directGross: nval("cDirectGross"), directCycle: nval("cDirectCycle"), directPayment: nval("cDirectPayment"), directRebate: nval("cDirectRebate"), directAdm: nval("cDirectAdm"), ticketGross: nval("cTicketGross"), ticketCycle: nval("cTicketCycle"), ticketPayment: nval("cTicketPayment"), ticketRebate: nval("cTicketRebate"), ticketAdm: nval("cTicketAdm"), fob: nval("cFob"), freight: nval("cFreight"), margin: nval("cMargin") };
    return { data, result: agreementCalc({ calculator: data }) };
  }

  function updateCalculator() {
    if (!$("#calcResults")) return;
    const { result: c } = readCalculator();
    $("#cTargetGross").value = c.target.gross.toFixed(4);
    const resultCard = (title, value, extra) => `<div class="calc-result"><span>${title}</span><strong>${money(value)}/L</strong><small>${extra}</small></div>`;
    $("#calcResults").innerHTML = `${resultCard("DirectFuel líquido", c.direct.net, `Benefício financeiro ${money(c.direct.financeBenefit)} • prazo médio ${num(c.direct.financeDays)} dias`)}${resultCard("Ticketlog líquido", c.ticket.net, `Benefício financeiro ${money(c.ticket.financeBenefit)} • prazo médio ${num(c.ticket.financeDays)} dias`)}${resultCard("Preço alvo líquido", c.target.net, `Bruto ${money(c.target.gross)} • FOB + frete + margem`)}${resultCard("Economia mensal", (c.ticket.net - c.direct.net) * c.volume, `${num(c.volume)} L/mês vs Ticketlog`)}`;
  }

  function agreementStationLabel(station) {
    const id = station.codigo || station.id,
      name = station.fantasia || station.razao,
      location = [station.municipio, station.uf].filter(Boolean).join("/");
    return [id, name, location].filter(Boolean).join(" · ");
  }

  function agreementStationAddress(station) {
    if (!station) return "Selecione um posto para visualizar o endereço.";
    const location = [station.municipio, station.uf].filter(Boolean).join("/");
    return [station.endereco, station.bairro, location].filter(Boolean).join(" · ") || "Endereço não cadastrado.";
  }

  formAcordo = function (record) {
    const c = agreementCalc(record || {}), p = record?.calculator || {};
    modal(record ? "Editar acordo e calculadora" : "Novo acordo e calculadora", `<div class="note">${record ? `ID do acordo: <strong>${html(record.numero || record.id)}</strong>` : "O ID do acordo será gerado automaticamente ao salvar."}</div><div class="form-grid" style="margin-top:14px"><div class="field"><label>Posto</label><select id="aPosto" required><option value="">Selecione um posto</option>${opts("postos", agreementStationLabel)}</select></div><div class="field span-2"><label>Endereço do posto selecionado</label><textarea id="aPostoEndereco" rows="2" readonly>Selecione um posto para visualizar o endereço.</textarea></div><div class="field"><label>Unidade</label><select id="aUnid">${opts("unidades", (x) => x.nome)}</select></div><div class="field"><label>Produto</label><select id="aProd">${opts("produtos", (x) => x.curta)}</select></div><div class="field"><label>Produtos Gekon para este produto DirectFuel (um por linha)</label><textarea id="aGekonProducts">${html((record?.gekonProducts||[]).join('\n'))}</textarea><small>Ex.: Diesel S10 ou Arla. Vínculo separado dos produtos da DANFE.</small></div><div class="field"><label>Base supridora</label><select id="aBase">${opts("bases", (x) => baseNome(x.id))}</select></div><div class="field"><label>Condição de pagamento</label><select id="aCondicaoPagamento"><option>Boleto</option><option>Depósito</option></select></div><div class="field"><label for="aIvaSap">IVA SAP</label><select id="aIvaSap"><option value="">Selecione</option>${[...new Set([...(db.config?.params?.ivaSapCodigos||[]),record?.ivaSap].filter(Boolean))].map(code=>`<option value="${html(code)}" ${code===record?.ivaSap?'selected':''}>${html(code)}</option>`).join('')}</select><small>Cadastre os códigos em Configurações. Obrigatório para gerar RC.</small></div><div class="field"><label for="aWeekClose">Dia de fechamento do ciclo</label><select id="aWeekClose"><option value="">Programação não definida</option>${['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'].map((name,i)=>`<option value="${i}" ${record?.measurementWeekClose===i?'selected':''}>${name}</option>`).join('')}</select><small>Quarta-feira: inclui quinta anterior até quarta atual, por completo.</small></div><div class="field"><label for="aWeekDelay">Prazo para medir após fechamento (dias corridos)</label><input id="aWeekDelay" type="number" min="0" max="30" step="1" value="${record?.measurementWeekDelay??1}"><small>O ciclo fica em andamento até o fim do fechamento. Prazo 1: medir no dia seguinte. Prazo 0: estará atrasado no dia seguinte se continuar pendente.</small></div><div class="field"><label>Analista / responsável</label><input id="aResp" value="${html(record?.responsavel || currentUser())}"></div><div class="field"><label>Início vigência</label><input type="date" id="aInicio" value="${record?.inicio || new Date().toISOString().slice(0, 10)}"></div><div class="field"><label>Fim vigência</label><input type="date" id="aFim" value="${record?.fim || ""}"><small class="muted" id="agreementDateRule"></small></div><div class="field"><label>Status</label><select id="aStatus"><option>Vigente</option><option>Encerrado</option><option>Cancelado</option></select><small class="muted">Ao terminar a vigência, o status muda automaticamente para Encerrado.</small></div></div>
      <div class="section-title">Premissas gerais</div><div class="form-grid"><div class="field"><label>Volume mensal (L)</label><input class="calc-input" type="number" id="cVolume" value="${c.volume}"></div><div class="field"><label>Taxa financeira (%)</label><input class="calc-input" type="number" step="0.01" id="cRate" value="${c.rate}"></div><div class="field"><label>Periodicidade da taxa</label><select class="calc-input" id="cRatePeriod"><option value="monthly">Mensal</option><option value="annual">Anual</option></select></div></div>
      <div class="calc-grid"><section class="calc-scenario"><h4>DirectFuel</h4><div class="field"><label>Preço bruto / L</label><input class="calc-input" type="number" step="0.0001" id="cDirectGross" value="${c.direct.gross}"></div><div class="field"><label>Ciclo medição (dias)</label><input class="calc-input" type="number" id="cDirectCycle" value="${c.direct.cycle}"></div><div class="field"><label>Pagamento (dias)</label><input class="calc-input" type="number" id="cDirectPayment" value="${c.direct.payment}"></div><div class="field"><label>Bonificação / rebate (%)</label><input class="calc-input" type="number" step="0.01" id="cDirectRebate" value="${p.directRebate ?? 1}"></div><div class="field"><label>Taxa administrativa (%)</label><input class="calc-input" type="number" step="0.01" id="cDirectAdm" value="${p.directAdm ?? record?.taxaAdm ?? 1}"></div></section>
      <section class="calc-scenario"><h4>Ticketlog</h4><div class="field"><label>Preço bruto / L</label><input class="calc-input" type="number" step="0.0001" id="cTicketGross" value="${c.ticket.gross}"></div><div class="field"><label>Ciclo medição (dias)</label><input class="calc-input" type="number" id="cTicketCycle" value="${c.ticket.cycle}"></div><div class="field"><label>Pagamento (dias)</label><input class="calc-input" type="number" id="cTicketPayment" value="${c.ticket.payment}"></div><div class="field"><label>Bonificação / rebate (%)</label><input class="calc-input" type="number" step="0.01" id="cTicketRebate" value="${p.ticketRebate ?? .5}"></div><div class="field"><label>Taxa administrativa (%)</label><input class="calc-input" type="number" step="0.01" id="cTicketAdm" value="${p.ticketAdm ?? 1}"></div></section>
      <section class="calc-scenario target"><h4>Preço alvo</h4><div class="field"><label>Paramétrica Vixpar (FOB à vista)</label><input class="calc-input" type="number" step="0.0001" id="cFob" value="${c.fob}"></div><div class="field"><label>Frete / L</label><input class="calc-input" type="number" step="0.0001" id="cFreight" value="${c.freight}"></div><div class="field"><label>Margem do posto (%)</label><input class="calc-input" type="number" step="0.01" id="cMargin" value="${c.margin}"></div><div class="field"><label>Preço alvo bruto / L</label><input type="number" id="cTargetGross" value="${c.target.gross.toFixed(4)}" disabled></div><p class="muted">Usa o ciclo, pagamento, rebate e taxa administrativa do DirectFuel.</p></section></div>
      <div id="calcResults" class="calc-results"></div><div class="field"><label>Observações</label><textarea id="aObs">${html(record?.obs || "")}</textarea></div>`, (back) => {
      const { data, result } = readCalculator();
      if (!val("aPosto") || !val("aProd") || !data.directGross) return toast("Preencha posto, produto e preço DirectFuel");
      const today = window.DirectFuelImportRules.todayIso(), status = val("aStatus"), start = val("aInicio"), end = val("aFim");
      if (!start) return alert("Informe a data inicial do acordo.");
      if (end && end < start) return alert("A data final não pode ser anterior à data inicial.");
      if (["Encerrado", "Cancelado"].includes(status) && !end) return alert(`Informe a data final para o acordo ${status.toLowerCase()}.`);
      if (["Encerrado", "Cancelado"].includes(status) && end > today) return alert("A data final de um acordo encerrado ou cancelado deve ser igual ou anterior a hoje.");
      const weekClose=val('aWeekClose'),weekDelay=val('aWeekDelay');
      if(weekClose!==''&&(!Number.isInteger(Number(weekClose))||Number(weekClose)<0||Number(weekClose)>6||!weekDelay.trim()||!Number.isInteger(Number(weekDelay))||Number(weekDelay)<0||Number(weekDelay)>30))return alert('Informe o dia de fechamento e um prazo inteiro de 0 a 30 dias.');
      const candidate = { id: record?.id, status, inicio: start, fim: end, postoId: val("aPosto"), produtoId: val("aProd") };
      const existing = window.DirectFuelImportRules.agreementDateConflict(candidate, db.acordos, record?.id);
      if (existing) return alert(`Já existe um acordo válido/vigente para este posto e produto no período informado (${existing.numero || existing.id}: ${dateBR(existing.inicio)} a ${existing.fim ? dateBR(existing.fim) : "31/12/9999"}). Encerre o acordo existente ou ajuste as datas antes de salvar.`);
      upsert("acordos", { ...(record || {}), gekonProducts: [...new Set(val("aGekonProducts").split(/\n/).map(v=>v.trim()).filter(Boolean))], fiscalProductMappings: record?.fiscalProductMappings || [], id: record?.id || uid("A"), numero: record?.numero || nextAgreementNumber(), postoId: val("aPosto"), unidadeId: val("aUnid"), produtoId: val("aProd"), baseId: val("aBase"), condicaoPagamento: val("aCondicaoPagamento"), ivaSap: val("aIvaSap"), measurementWeekClose: weekClose===''?null:Number(weekClose), measurementWeekDelay: weekClose===''?null:Number(weekDelay), inicio: val("aInicio"), fim: val("aFim"), preco: data.directGross, prv: result.target.gross, ticketlog: data.ticketGross, fob: data.fob, frete: data.freight, margem: data.margin, taxaAdm: data.directAdm, taxaFin: data.rate, ciclo: data.directCycle, pagamento: data.directPayment, volumeMes: data.volume, status: val("aStatus"), responsavel: val("aResp"), obs: val("aObs"), calculator: data, precoLiquido: result.direct.net, ticketlogLiquido: result.ticket.net, precoAlvo: result.target.gross, precoAlvoLiquido: result.target.net });
      back.remove();
    });
    setTimeout(() => {
      const updateStationAddress = () => { const station = ent("postos", val("aPosto")); $("#aPostoEndereco").value = agreementStationAddress(station); };
      if (record) { $("#aPosto").value = record.postoId; $("#aUnid").value = record.unidadeId; $("#aProd").value = record.produtoId; $("#aBase").value = record.baseId; $("#aCondicaoPagamento").value = ["Boleto", "Depósito"].includes(record.condicaoPagamento) ? record.condicaoPagamento : "Boleto"; $("#aStatus").value = ["Encerrado", "Cancelado"].includes(record.status) ? record.status : "Vigente"; }
      $("#aPosto").addEventListener("change", updateStationAddress);
      updateStationAddress();
      const updateDateRule = () => { const closed=["Encerrado","Cancelado"].includes($("#aStatus").value); $("#aFim").required=closed; $("#agreementDateRule").textContent=(closed ? "Obrigatória e igual ou anterior a hoje. " : "Opcional; em branco equivale a 31/12/9999. ")+"A vigência não pode sobrepor outro acordo do mesmo posto e produto."; };
      $("#aStatus").addEventListener("change", updateDateRule); updateDateRule();
      $("#cRatePeriod").value = p.ratePeriod || "monthly";
      $$(".calc-input").forEach((input) => input.addEventListener("input", updateCalculator));
      updateCalculator();
    }, 0);
  };

  acordos = function () {
    pageTitle("Acordos & Calculadora", "Comparação de preço líquido DirectFuel, Ticketlog e preço alvo");
    $("#view").innerHTML = `<div class="panel"><div class="toolbar"><button class="btn primary" id="newAcordo">+ Novo acordo</button></div><div class="table-wrap"><table><thead><tr><th>ID do acordo</th><th>Posto</th><th>Produto</th><th>DirectFuel bruto</th><th>DirectFuel líquido</th><th>Ticketlog líquido</th><th>Paramétrica FOB</th><th>Preço alvo</th><th>Economia mensal</th><th>Condição de pagamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${db.acordos.map((a) => { const c = agreementCalc(a); return `<tr><td>${html(a.numero)}</td><td>${html(postoNome(a.postoId))}</td><td>${html(produtoNome(a.produtoId))}</td><td>${money(c.direct.gross)}</td><td>${money(c.direct.net)}</td><td>${money(c.ticket.net)}</td><td>${money(c.fob)}</td><td>${money(c.target.gross)}</td><td class="${c.direct.net <= c.ticket.net ? "price-good" : "price-bad"}">${money((c.ticket.net - c.direct.net) * c.volume)}</td><td>${html(a.condicaoPagamento || "Boleto")}</td><td>${badge(window.DirectFuelImportRules.effectiveAgreementStatus(a))}</td><td><button class="btn small secondary editA" data-id="${a.id}">Editar</button> <button class="btn small secondary printA" data-id="${a.id}">Ficha</button></td></tr>`; }).join("") || '<tr><td colspan="12" class="muted">Nenhum acordo cadastrado.</td></tr>'}</tbody></table></div></div>`;
    $("#newAcordo").onclick = () => formAcordo();
    $$(".editA").forEach((button) => button.onclick = () => formAcordo(ent("acordos", button.dataset.id)));
    $$(".printA").forEach((button) => button.onclick = () => printAgreement(ent("acordos", button.dataset.id)));
    const toolbar = document.querySelector("#view .toolbar");
    if (toolbar && typeof window.directFuelAddBulkControls === "function") window.directFuelAddBulkControls("acordos", toolbar);
  };

  auditPage = function () {
    pageTitle("Auditoria", "Últimas alterações com data, hora, usuário e campos modificados");
    $("#view").innerHTML = `<div class="panel"><p class="note">Cada salvamento registra inclusão, alteração ou exclusão. Os registros também guardam quem criou e quem fez a última alteração.</p><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Registro</th><th>Detalhe</th></tr></thead><tbody>${(db.audit || []).map((log) => `<tr><td>${new Date(log.data).toLocaleString("pt-BR")}</td><td>${html(log.usuario)}</td><td>${html(log.acao)}</td><td>${html(log.entidade)}</td><td>${html(log.registro || "-")}</td><td>${html(log.detalhe || "-")}</td></tr>`).join("") || '<tr><td colspan="6">Sem registros.</td></tr>'}</tbody></table></div></div>`;
  };

  snapshot = clone(db);
  render();
})();
