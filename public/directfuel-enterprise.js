(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const sentenceCase = (value) => {
    const text = String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
    return text.replace(/^([^\p{L}]*)(\p{L})/u, (_, prefix, letter) => prefix + letter.toLocaleUpperCase("pt-BR"));
  };
  const currentUser = () => window.DIRECTFUEL_CURRENT_USER || window.DIRECTFUEL_CURRENT_EMAIL || "Usuário Vixpar";
  const currentRecord = () => (db.users || []).find((user) => String(user.email || "").toLowerCase() === String(window.DIRECTFUEL_CURRENT_EMAIL || "").toLowerCase() && user.ativo !== false);
  const isAdmin = () => !!window.DIRECTFUEL_IS_OWNER || ["Master", "Administrador"].includes(window.DIRECTFUEL_CURRENT_PROFILE) || ["Master", "Administrador"].includes(currentRecord()?.perfil);
  const isMaster = () => !!window.DIRECTFUEL_IS_OWNER;
  const humanFields = {
    distribuidores: ["nome", "obs"], bases: ["localidade"], produtos: ["descricao", "curta", "familia"], unidades: ["razao", "nome", "municipio"], postos: ["razao", "fantasia", "endereco", "bairro", "municipio", "bandeira", "contComercial", "contFinanceiro"], frota: ["modelo", "fabricante", "tipo"], acordos: ["responsavel", "obs"], abastecimentos: ["veiculo", "motorista"], users: ["nome"]
  };

  function normalizeDatabaseText() {
    Object.entries(humanFields).forEach(([collection, fields]) => (db[collection] || []).forEach((record) => fields.forEach((field) => { if (typeof record[field] === "string" && record[field].trim()) record[field] = sentenceCase(record[field]); })));
    (db.users || []).forEach((user) => { if (user.email) user.email = String(user.email).trim().toLowerCase(); });
  }

  const savedBeforeEnterprise = save;
  save = function (message) { normalizeDatabaseText(); savedBeforeEnterprise(message); };
  reset = function () { toast("Os dados de teste não podem mais ser restaurados. Faça backup ou zere a base em Configurações."); };

  const operationGroup = navGroups.find(([label]) => label === "OPERAÇÃO");
  if (operationGroup) {
    const index = operationGroup[1].findIndex(([key]) => key === "medicoes");
    if (index >= 0) operationGroup[1].splice(index, 1, ["medicoes", "Medições pendentes", "medicoes"], ["medicoes_realizadas", "Medições realizadas", "medicoes"]);
  }

  function permissionKey(routeKey) { return routeKey === "medicoes_realizadas" ? "medicoes" : routeKey; }
  function canRoute(routeKey) {
    if (window.DIRECTFUEL_IS_OWNER) return true;
    if (["users", "config", "security"].includes(routeKey)) return false;
    const permissions = Array.isArray(window.DIRECTFUEL_PERMISSIONS) && window.DIRECTFUEL_PERMISSIONS.length ? window.DIRECTFUEL_PERMISSIONS : (currentRecord()?.permissoes || ["*"]);
    return permissions.includes("*") || permissions.includes(permissionKey(routeKey));
  }
  window.directFuelCanAction = function (routeKey, action) {
    if (window.DIRECTFUEL_IS_OWNER) return true;
    const key = permissionKey(routeKey);
    const actions = Array.isArray(window.DIRECTFUEL_ACTIONS) ? window.DIRECTFUEL_ACTIONS : [];
    return actions.includes("*") || actions.includes(`${key}:${action}`);
  };
  renderNav = function () {
    let output = "";
    for (const [group, items] of navGroups) {
      const visible = items.filter((item) => (!item[2] || db.config.modules[item[2]] !== false) && canRoute(item[0]));
      if (!visible.length) continue;
      output += `<div class="nav-group"><div class="nav-group-title">${group}</div>${visible.map((item) => `<button class="nav-item ${route === item[0] ? "active" : ""}" data-route="${item[0]}">${item[1]}</button>`).join("")}</div>`;
    }
    $("#nav").innerHTML = output;
    $$(".nav-item").forEach((button) => button.onclick = () => { route = button.dataset.route; render(); });
  };

  function dateIso(value) {
    const raw = String(value ?? "").trim().replace(/[ T]\d{1,2}:\d{2}(?::\d{2})?$/, ""); if (!raw) return "";
    let y, m, d, match = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (match) [, y, m, d] = match; else { match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/); if (match) [, d, m, y] = match; else if (/^\d{5}(?:\.\d+)?$/.test(raw)) { const date = new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10); } }
    if (!y) return ""; const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, test = new Date(`${iso}T12:00:00Z`);
    return !Number.isNaN(test.getTime()) && test.getUTCFullYear() === Number(y) && test.getUTCMonth() + 1 === Number(m) && test.getUTCDate() === Number(d) ? iso : "";
  }
  function csvNumber(value) { const raw = String(value ?? "0").trim(); return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw) || 0; }
  function optionalCsvNumber(value) {
    const raw = String(value ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
    if (!raw || !/^-?(?:(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?|\d+\.\d+)$/.test(raw)) return null;
    const parsed = csvNumber(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function normalizeLookup(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function splitImportedDateTime(value, explicitTime = "") {
    const raw = String(value || "").trim(), match = raw.match(/[ T](\d{1,2}:\d{2})(?::\d{2})?$/);
    return { data: dateIso(raw), hora: String(explicitTime || match?.[1] || "").trim().slice(0, 5) };
  }
  function parseCsv(text) { return window.DirectFuelImportRules.parseCsv(text); }

  function findText(collection, wanted, fields) { const key = String(wanted || "").trim().toLocaleLowerCase("pt-BR"); return (db[collection] || []).find((record) => fields.some((field) => String(record[field] || "").trim().toLocaleLowerCase("pt-BR") === key)); }
  function findImportedStation(row) {
    return window.DirectFuelImportRules.resolveStation(row, db.postos || []);
  }

  function extractPlate(value) {
    const raw = String(value || "").toUpperCase().replace(/\s+/g, " ").trim(), matches = [...raw.matchAll(/(?:\[|\b)([A-Z]{3}[0-9][A-Z0-9][0-9]{2})(?:\]|\b)/g)];
    return matches.at(-1)?.[1] || "";
  }
  function agreementDateMatches(agreement, stationId, date) {
    const start = agreement.inicio ? dateIso(agreement.inicio) : "", end = agreement.fim ? dateIso(agreement.fim) : "";
    return window.DirectFuelImportRules.agreementMatches(agreement, stationId, null, date);
  }
  function findImportedProduct(value, station, date, loadedPrice) {
    const exact = findText("produtos", value, ["id", "curta", "descricao", "sap"]);
    if (exact) return exact;
    const wanted = normalizeLookup(value), s10 = wanted.includes("diesel") && /\bs ?10\b/.test(wanted);
    if (!s10) return undefined;
    const candidates = (db.produtos || []).filter((product) => { const key = normalizeLookup(`${product.curta || ""} ${product.descricao || ""}`); return key.includes("diesel") && /\bs ?10\b/.test(key); }),
      agreements = (db.acordos || []).filter((agreement) => station && agreementDateMatches(agreement, station.id, date) && candidates.some((product) => product.id === agreement.produtoId)).sort((left, right) => Math.abs(Number(left.preco || 0) - loadedPrice) - Math.abs(Number(right.preco || 0) - loadedPrice));
    if (agreements.length) return candidates.find((product) => product.id === agreements[0].produtoId);
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  function fuelingKey(item) { return [item.data, item.hora, item.postoId, item.placa, item.produtoId, Number(item.qt || 0).toFixed(3), Number(item.preco || 0).toFixed(4), Number(item.total || 0).toFixed(2), Number(item.odometro || 0).toFixed(1)].map((value) => String(value || "").trim().toLocaleLowerCase("pt-BR")).join("|"); }
  function agreementForDate(item) {
    const date = dateIso(item.data); if (!date) return undefined;
    return window.DirectFuelImportRules.findAgreement(db.acordos || [], item.postoId, item.produtoId, date);
  }
  function agreementCheck(item) {
    const agreement = agreementForDate(item), agreedPrice = agreement ? Number(agreement.preco || 0) : null, loadedPrice = Number(item.preco || 0), differenceUnit = agreement ? loadedPrice - agreedPrice : null, differenceTotal = differenceUnit === null ? null : differenceUnit * Number(item.qt || 0);
    const code = !agreement ? "Sem acordo" : Math.abs(differenceUnit) > .001 ? "Preço divergente" : "Conforme";
    const overridden = code !== "Conforme" && !!item.priceValidationOverride && String(item.priceOverrideJustification || "").trim().length >= 5;
    return { agreement, agreedPrice, loadedPrice, differenceUnit, differenceTotal, code, overridden, unresolved: code !== "Conforme" && !overridden };
  }
  function validationFields(item, justification = "") {
    const check = agreementCheck(item), overridden = check.code !== "Conforme" && justification.trim().length >= 5;
    return { agreementId: check.agreement?.id || "", agreementPrice: check.agreedPrice, priceDifferenceUnit: check.differenceUnit, priceDifferenceTotal: check.differenceTotal, priceValidationStatus: overridden ? `${check.code} — Justificado` : check.code, priceValidationOverride: overridden, priceOverrideJustification: overridden ? justification.trim() : "", priceOverrideBy: overridden ? currentUser() : "", priceOverrideAt: overridden ? new Date().toISOString() : "", priceValidatedAt: new Date().toISOString() };
  }
  window.directFuelAgreementCheck = agreementCheck;
  window.directFuelValidationFields = validationFields;
  window.directFuelIsAdministrator = isAdmin;

  function editGekonMappings(rows,file,preview) {
    if(!window.directFuelCanAction('postos','editar') || !window.directFuelCanAction('acordos','editar'))return toast('Seu perfil precisa de permissão para editar postos e acordos');
    const pairs=[...new Map(rows.map(row=>[JSON.stringify([row.posto,row.produto]),row])).values()];
    modal('De/Para Gekon', `<p>Escolha o posto e o acordo para cada nome/produto. Os vínculos serão salvos nos cadastros e a prévia será recalculada. Deixe em branco o que deseja tratar depois.</p><div class="table-wrap"><table><thead><tr><th>Posto Gekon</th><th>Produto Gekon</th><th>Posto DirectFuel</th><th>Acordo / produto DirectFuel</th></tr></thead><tbody>${pairs.map((row,i)=>`<tr><td>${esc(row.posto)}</td><td>${esc(row.produto)}</td><td><select id="gStation${i}"><option value="">Selecionar posto</option>${db.postos.map(p=>`<option value="${esc(p.id)}">${esc(window.DirectFuelImportRules.stationLabel(p))}</option>`).join('')}</select></td><td><select id="gAgreement${i}"><option value="">Selecionar acordo</option></select></td></tr>`).join('')}</tbody></table></div>`,back=>{
      const changes=pairs.map((row,i)=>({row,station:db.postos.find(p=>p.id===val(`gStation${i}`)),agreement:db.acordos.find(a=>a.id===val(`gAgreement${i}`))}));
      for(const {row,station,agreement} of changes){
        if(!station)continue;
        const name=window.DirectFuelImportRules.text(row.posto);
        if(db.postos.some(p=>p.id!==station.id&&(p.gekonNames||[]).some(n=>window.DirectFuelImportRules.text(n)===name)) || changes.some(c=>c.station&&c.station.id!==station.id&&window.DirectFuelImportRules.text(c.row.posto)===name))return toast(`Nome Gekon vinculado a postos diferentes: ${row.posto}`);
        if(agreement&&agreement.postoId!==station.id)return toast('O acordo deve pertencer ao posto selecionado');
      }
      let count=0;
      changes.forEach(({row,station,agreement})=>{if(!station)return;station.gekonNames=[...new Set([...(station.gekonNames||[]),row.posto])];if(agreement)agreement.gekonProducts=[...new Set([...(agreement.gekonProducts||[]),row.produto])];count++;});
      if(!count)return toast('Selecione ao menos um vínculo');
      audit('De/Para Gekon','Cadastros',`${count} vínculo(s) por ${currentUser()}`);save('De/Para Gekon salvo');back.remove();preview.remove();previewFuelingImport({target:{files:[file],value:''}});
    });
    pairs.forEach((row,i)=>{const station=$(`#gStation${i}`),agreement=$(`#gAgreement${i}`),resolved=findImportedStation(row).station;
      const refresh=()=>{const dates=rows.filter(r=>r.posto===row.posto&&r.produto===row.produto).map(r=>splitImportedDateTime(r.data,r.hora).data);agreement.innerHTML='<option value="">Selecionar acordo</option>'+db.acordos.filter(a=>dates.some(date=>agreementDateMatches(a,station.value,date))).map(a=>`<option value="${esc(a.id)}">${esc(a.numero||a.id)} · ${esc(produtoNome(a.produtoId))} · ${dateBR(a.inicio)} a ${a.fim?dateBR(a.fim):'sem término'}</option>`).join('');};
      if(resolved)station.value=resolved.id;station.onchange=refresh;refresh();
    });
  }

  async function previewFuelingImport(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      if(file.size>20*1024*1024)throw new Error("O arquivo deve ter no máximo 20 MB.");
      let csv;
      if(/\.xlsx?$/i.test(file.name)){
        if(!window.XLSX)await new Promise((resolve,reject)=>{const script=document.createElement("script");script.src="/gekon-xlsx.js";script.onload=resolve;script.onerror=()=>reject(new Error("Não foi possível carregar o leitor Excel"));document.head.append(script);});
        const book=window.XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
        const sheets=book.SheetNames.map(name=>window.XLSX.utils.sheet_to_csv(book.Sheets[name],{FS:";",dateNF:"dd/mm/yyyy hh:mm"}));
        csv=sheets.find(value=>/Data/i.test(value)&&/Posto/i.test(value)&&/Quantidade/i.test(value));
        if(!csv)throw new Error("Planilha de abastecimentos não encontrada.");
      }else if(/\.csv$/i.test(file.name))csv=await file.text();
      else throw new Error("Selecione um arquivo XLS, XLSX ou CSV.");
      const parsed = parseCsv(csv);
      parsed.records.forEach(row=>{row._gekon=!String(row.id_posto||"").trim();});
      const staged = parsed.records.map((row) => {
        const importedDate = splitImportedDateTime(row.data, row.hora), stationResolution = findImportedStation(row), station = stationResolution.station, plate = extractPlate(row.placa || row.veiculo), fleet = findText("frota", plate, ["placa"]), quantity = csvNumber(row.quantidade || row.qt), sourceTotal = optionalCsvNumber(row.valor_total || row.total), paymentRaw = String(row.modalidade_pagamento || "").trim(), agreementInPayment = /^(?:acordo|ac)[-\s_/]*\d/i.test(paymentRaw) ? paymentRaw : "", declaredAgreementValue = String(row.preco_acordo || row.valor_acordo || row.acordo || "").trim(), declaredAgreementPrice = optionalCsvNumber(declaredAgreementValue), declaredAgreementNumber = String(row.numero_acordo || row.codigo_acordo || agreementInPayment || (declaredAgreementPrice === null ? row.acordo : "") || "").trim(), loadedPriceInput = optionalCsvNumber(row.preco || row.valor_unit || row.valor_unitario), derivedPrice = !loadedPriceInput && sourceTotal && quantity ? sourceTotal / quantity : null, initialPrice = loadedPriceInput || derivedPrice || declaredAgreementPrice || 0, productResolution = row._gekon || (station && db.acordos.some(a=>a.postoId===station.id&&(a.gekonProducts||[]).some(v=>normalizeLookup(v)===normalizeLookup(row.produto)))) ? window.DirectFuelImportRules.resolveGekonProduct(row.produto,station?.id,importedDate.data,db.acordos,db.produtos) : {product:findImportedProduct(row.produto, station, importedDate.data, initialPrice)}, product = productResolution.product, unit = (db.unidades || []).find((item) => item.id === fleet?.unidadeId) || findText("unidades", row.filial || row.unidade || row.empresa, ["id", "nome", "centroSap", "razao"]), errors = [], warnings = [], notices = [];
        if (!importedDate.data) errors.push("Data inválida");
        if(productResolution.error)errors.push(productResolution.error);
        if (!station) errors.push(`${stationResolution.error}: ${row.posto || "não informado"}${stationResolution.candidates.length ? ` — candidatos: ${stationResolution.candidates.join(" | ")}` : ""}`);
        if (!plate) errors.push("Placa não identificada no campo Veículo");
        else if (!fleet) errors.push(`Placa não cadastrada: ${plate}`);
        if (!product) errors.push(`Produto não encontrado ou ambíguo: ${row.produto || "não informado"}`);
        if (!unit) errors.push("Filial não vinculada à placa");
        if (!quantity) errors.push("Quantidade inválida");
        if (row._gekon && fleet && quantity) {
          const capacityError = window.DirectFuelImportRules.fuelingCapacityError(quantity, fleet);
          if (capacityError) errors.push(capacityError);
        }
        if (row.id && db.abastecimentos.some((item) => item.id === row.id)) errors.push("ID já cadastrado");
        let record = errors.length ? null : { id: row.id || uid("AB"), data: importedDate.data, hora: importedDate.hora, postoId: station.id, postoIdentificadoPor: stationResolution.method, postoCnpjImportado: String(row.cnpj_posto || row.posto_cnpj || row.cnpj || "").trim(), placa: fleet.placa, veiculo: sentenceCase(fleet.modelo || row.veiculo || ""), odometro: csvNumber(row.odometro), motorista: sentenceCase(row.motorista || ""), produtoId: product.id, qt: quantity, preco: initialPrice, total: sourceTotal || quantity * initialPrice, precoOriginalImportado: initialPrice || null, valorTotalOriginalImportado: sourceTotal, unidadeId: unit.id, centroCusto: fleet.centroCusto || row.centro_custo || unit.centroCusto || "", origem: row._gekon ? "Gekon" : "CSV Autorizações", arquivoOrigem: file.name, linhaOrigem: row._line, postoOriginalImportado: row.posto, produtoOriginalImportado: row.produto, empresaOrigem: sentenceCase(row.empresa || ""), modalidadePagamento: sentenceCase(agreementInPayment ? "Acordo" : paymentRaw), acordoNumeroInformado: declaredAgreementNumber, acordoPrecoInformado: declaredAgreementPrice, medicaoId: null };
        if (record) {
          const registeredAgreement = productResolution.agreement || agreementForDate(record);
          if (registeredAgreement) {
            const agreementPrice = Number(registeredAgreement.preco || 0);
            if (!(agreementPrice > 0)) { errors.push("O acordo válido na data não possui preço cadastrado"); record = null; }
            else {
              const applied = window.DirectFuelImportRules.applyAgreementPrice(quantity, initialPrice || null, sourceTotal, registeredAgreement);
              record.preco = applied.price;
              record.total = applied.total;
              record.agreementId = registeredAgreement.id;
              record.acordoNumeroAplicado = registeredAgreement.numero || registeredAgreement.id;
              record.precoFonte = applied.source;
              if (initialPrice && Math.abs(initialPrice - applied.price) > .001) notices.push("Preço substituído pelo acordo histórico");
              if (sourceTotal !== null && Math.abs(sourceTotal - applied.total) > .02) notices.push("Valor total recalculado pelo acordo");
            }
          }
          if (record && !registeredAgreement && !record.preco) { errors.push("Valor unitário inválido e nenhum acordo válido na data foi encontrado"); record = null; }
          else if (record && registeredAgreement) {
            if (declaredAgreementNumber && normalizeLookup(declaredAgreementNumber) !== normalizeLookup(registeredAgreement.numero || registeredAgreement.id)) notices.push("Número do acordo informado difere do histórico aplicado");
            if (declaredAgreementPrice !== null && Math.abs(declaredAgreementPrice - Number(registeredAgreement.preco || 0)) > .001) notices.push("Preço informado substituído pelo acordo histórico");
          }
        }
        return { line: row._line, errors, warnings, notices, record, raw: row, stationResolution, importedPlate: plate, importedPrice: initialPrice, importedTotal: sourceTotal, vehicleCapacity: Number(fleet?.capTanque || 0), appliedAgreement: record ? agreementForDate(record) : null, declaredAgreementNumber, declaredAgreementPrice };
      });
    const fingerprints = new Set((db.abastecimentos || []).map(fuelingKey)), admin = window.directFuelCanAction("abastecimentos", "editar");
    staged.forEach((item) => {
      item.warnings ||= [];
      if (!item.record) return;
      const key = fuelingKey(item.record);
      if (fingerprints.has(key)) { item.errors.push("Abastecimento já cadastrado"); item.record = null; return; }
      fingerprints.add(key);
      item.check = agreementCheck(item.record);
      if (item.check.unresolved) {
        if (admin) item.warnings.push(item.check.code);
        else { item.errors.push(`${item.check.code} — requer permissão de editar abastecimentos`); item.record = null; }
      } else Object.assign(item.record, validationFields(item.record));
    });
    const valid = staged.filter((item) => item.record && !item.errors.length), invalid = staged.filter((item) => item.errors.length), warnings = valid.filter((item) => item.warnings.length), adjusted = valid.filter((item) => item.notices?.length), back = document.createElement("div"); back.className = "modal-back";
    const previewGroup = item => item.errors.length || !item.record ? "errors" : item.warnings.length ? "warnings" : "valid";
    const previewGroups = [
      {key:"valid",name:"Conformes",rows:staged.filter(item=>previewGroup(item)==="valid")},
      {key:"errors",name:"Com erros",rows:staged.filter(item=>previewGroup(item)==="errors")},
      {key:"warnings",name:"Com divergências",rows:staged.filter(item=>previewGroup(item)==="warnings")}
    ];
    back.innerHTML = `<div class="modal import-preview"><h3>Prévia da importação</h3><div class="preview-summary"><strong>${valid.length} linhas disponíveis</strong><strong class="bad-text">${invalid.length} linhas com erro</strong><strong>${warnings.length} divergências</strong><strong>${adjusted.length} preços ajustados</strong></div><p class="note">O relatório Gekon utiliza os nomes vinculados no posto e os produtos vinculados no acordo. A quantidade também é comparada com a capacidade do veículo: até o limite é aceita; acima do limite ou sem capacidade cadastrada, a linha fica em Com erros e não é importada.</p><div class="toolbar" role="tablist" aria-label="Situação dos registros">${previewGroups.map(group => `<button type="button" role="tab" id="preview-tab-${group.key}" aria-controls="previewImportRows" class="btn secondary" data-preview-tab="${group.key}">${group.name} (${group.rows.length})</button>`).join("")}</div><div class="table-wrap" id="previewImportRows" role="tabpanel"><table><thead><tr><th>Linha</th><th>Status</th><th>Data e hora</th><th>Id Posto</th><th>Posto original → DirectFuel</th><th>Veículo / placa</th><th>Motorista</th><th>Empresa</th><th>Produto</th><th>Quantidade</th><th>Capacidade veículo</th><th>Acordo localizado</th><th>Vigência</th><th>Preço aplicado</th><th>Valor calculado</th></tr></thead><tbody>${staged.map((item) => `<tr data-preview-group="${previewGroup(item)}"><td>${item.line}</td><td>${item.errors.length ? badge(item.errors.join(", ")) : item.warnings.length ? badge(item.warnings.join(", ")) : item.notices?.length ? badge(item.notices.join(", ")) : badge("Conforme")}</td><td>${esc(item.record ? `${item.record.data} ${item.record.hora}` : item.raw.data || "-")}</td><td>${esc(item.raw.id_posto || item.raw.codigo_posto || item.raw.posto_id || "-")}</td><td>${esc(item.record ? `${item.raw.posto} → ${postoNome(item.record.postoId)} · CNPJ ${(db.postos.find(p => p.id === item.record.postoId)?.cnpj || "não informado")} · ${(db.postos.find(p => p.id === item.record.postoId)?.endereco || "endereço não informado")}` : item.raw.posto || "-")}</td><td>${esc(item.raw.veiculo || item.record?.placa || item.importedPlate || "-")}</td><td>${esc(item.raw.motorista || "-")}</td><td>${esc(item.raw.empresa || "-")}</td><td>${esc(item.record ? `${item.raw.produto} → ${produtoNome(item.record.produtoId)}` : item.raw.produto || "-")}</td><td>${num(item.record?.qt || csvNumber(item.raw.quantidade || item.raw.qt))} L</td><td>${item.vehicleCapacity ? `${num(item.vehicleCapacity)} L` : "Não cadastrada"}</td><td>${esc(item.record?.acordoNumeroAplicado || "-")}</td><td>${item.appliedAgreement ? `${dateBR(item.appliedAgreement.inicio)} a ${item.appliedAgreement.fim ? dateBR(item.appliedAgreement.fim) : "sem término"}` : "-"}</td><td>${item.record ? money(item.record.preco) : "-"}</td><td>${item.record ? money(item.record.total) : "-"}</td></tr>`).join("")}<tr data-preview-empty hidden><td colspan="15" class="muted">Nenhum registro nesta aba.</td></tr></tbody></table></div>${warnings.length ? '<div class="field" style="margin-top:14px"><label>Justificativa administrativa para importar as divergências</label><textarea id="importPriceJustification" placeholder="Informe o motivo da divergência ou da ausência de acordo"></textarea></div>' : ""}<div class="modal-actions"><button type="button" class="btn secondary exportImportPreview">Exportar Excel</button><button class="btn secondary cancelImport">Cancelar</button><button class="btn secondary mapGekon">Cadastrar De/Para Gekon</button><button class="btn primary confirmImport" ${valid.length ? "" : "disabled"}>Confirmar ${valid.length} linhas</button></div></div>`;
    const showPreviewGroup = key => {
      back.querySelectorAll("[data-preview-tab]").forEach(button=>{const active=button.dataset.previewTab===key;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;button.classList.toggle("primary",active);button.classList.toggle("secondary",!active);});
      back.querySelectorAll("[data-preview-group]").forEach(row=>row.hidden=row.dataset.previewGroup!==key);
      back.querySelector("[data-preview-empty]").hidden=previewGroups.find(group=>group.key===key).rows.length>0;
      back.querySelector("#previewImportRows").setAttribute("aria-labelledby",`preview-tab-${key}`);
    };
    const tabButtons=Array.from(back.querySelectorAll("[data-preview-tab]"));
    tabButtons.forEach((button,index)=>{button.onclick=()=>showPreviewGroup(button.dataset.previewTab);button.onkeydown=event=>{const next=event.key==="ArrowRight"?(index+1)%tabButtons.length:event.key==="ArrowLeft"?(index+tabButtons.length-1)%tabButtons.length:event.key==="Home"?0:event.key==="End"?tabButtons.length-1:null;if(next===null)return;event.preventDefault();tabButtons[next].click();tabButtons[next].focus();};});
    showPreviewGroup(previewGroups.find(group=>group.rows.length)?.key||"valid");
    $(".exportImportPreview",back).onclick=()=>{
      const columns=[["Linha","line"],["Situação","status"],["Erros","errors"],["Divergências","warnings"],["Ajustes","notices"],["Data e hora","date"],["ID posto original","sourceStationId"],["Posto original","sourceStation"],["ID posto DirectFuel","stationId"],["Posto DirectFuel","station"],["CNPJ","cnpj"],["Endereço","address"],["Veículo / placa","plate"],["Motorista","driver"],["Empresa","company"],["Produto original","sourceProduct"],["Produto DirectFuel","product"],["Quantidade (L)","quantity"],["Capacidade do veículo (L)","vehicleCapacity"],["Acordo localizado","agreement"],["Início vigência","start"],["Fim vigência","end"],["Preço original","sourcePrice"],["Valor original","sourceTotal"],["Preço aplicado","price"],["Valor calculado","total"]];
      workbook(`previa_gekon_${new Date().toISOString().slice(0,10)}.xls`,previewGroups.map(group=>({name:group.name,columns,rows:group.rows.map(item=>{const station=db.postos.find(p=>p.id===item.record?.postoId);return {line:item.line,status:group.name,errors:item.errors.join("; "),warnings:item.warnings.join("; "),notices:(item.notices||[]).join("; "),date:item.record?`${item.record.data} ${item.record.hora||""}`:item.raw.data||"",sourceStationId:item.raw.id_posto||item.raw.codigo_posto||item.raw.posto_id||"",sourceStation:item.raw.posto||"",stationId:station?.codigo||station?.id||"",station:station?postoNome(station.id):"",cnpj:station?.cnpj||"",address:station?.endereco||"",plate:item.raw.veiculo||item.record?.placa||item.importedPlate||"",driver:item.raw.motorista||"",company:item.raw.empresa||"",sourceProduct:item.raw.produto||"",product:item.record?produtoNome(item.record.produtoId):"",quantity:item.record?.qt??csvNumber(item.raw.quantidade||item.raw.qt),vehicleCapacity:item.vehicleCapacity||"",agreement:item.record?.acordoNumeroAplicado||"",start:item.appliedAgreement?.inicio||"",end:item.appliedAgreement?.fim||"",sourcePrice:item.importedPrice??"",sourceTotal:item.importedTotal??"",price:item.record?.preco??"",total:item.record?.total??""};})})));
    };
    document.body.appendChild(back); $(".mapGekon",back).onclick=()=>editGekonMappings(parsed.records,file,back); $(".cancelImport", back).onclick = () => back.remove(); $(".confirmImport", back).onclick = () => {
      const justification = $("#importPriceJustification", back)?.value?.trim() || "";
      if (warnings.length && justification.length < 5) return toast("Informe uma justificativa administrativa para as divergências");
      valid.forEach((item) => Object.assign(item.record, validationFields(item.record, item.warnings.length ? justification : ""), item.warnings.length ? { importValidationWarnings: item.warnings.join("; "), importValidationJustification: justification, importValidationBy: currentUser(), importValidationAt: new Date().toISOString() } : {}));
      db.abastecimentos.push(...valid.map((item) => item.record)); audit("Importação confirmada", "Abastecimentos", `${valid.length} sucesso; ${adjusted.length} preço(s) ajustado(s); ${warnings.length} justificado(s); ${invalid.length} erro(s)`); save("Importação concluída"); back.remove(); render(); alert(`Carga finalizada.\n\nImportadas com sucesso: ${valid.length}\nPreços ajustados pelo acordo: ${adjusted.length}\nDivergências justificadas: ${warnings.length}\nLinhas com erro: ${invalid.length}`);
    };
    } catch (error) {
      alert(`Não foi possível preparar a importação.\n\n${error.message || "Arquivo inválido"}`);
    } finally {
      event.target.value = "";
    }
  }

  function fuelingIssues(a) {
    const issues = [], check = agreementCheck(a), fleet = db.frota.find((x) => x.placa === a.placa);
    if (!dateIso(a.data)) issues.push("Data"); if (check.unresolved) issues.push(check.code); else if (check.overridden) issues.push(`${check.code} justificado`); if (fleet && a.qt > fleet.capTanque) issues.push("Volume"); if (!db.rede.some((r) => r.postoId === a.postoId && r.unidadeId === a.unidadeId && r.produtoId === a.produtoId && r.ativo)) issues.push("Rede"); return issues;
  }
  abastecimentos = function () {
    pageTitle("Abastecimentos", "Carga, validação e correção de registros pendentes"); const admin = window.directFuelCanAction("abastecimentos", "editar") || window.directFuelCanAction("abastecimentos", "excluir");
    $("#view").innerHTML = `<div class="panel"><div class="toolbar"><button class="btn primary" id="newAb">+ Novo abastecimento</button><label class="btn secondary">Importar Gekon / CSV com prévia<input id="csvAb" type="file" accept=".xls,.xlsx,.csv" hidden></label><a class="btn secondary" href="/modelo_importacao_abastecimentos_directfuel.csv" download>Baixar modelo CSV</a></div><p class="note">Carregue o relatório original Gekon (XLS/XLSX) ou CSV. Cadastre os nomes Gekon em Postos e os produtos Gekon em Acordos. O modelo CSV com Id Posto continua disponível; o sistema busca o acordo válido na data, inclusive encerrado, e aplica automaticamente o preço acordado.</p>${admin ? '<p class="note">Usuários autorizados podem editar, excluir ou justificar divergências somente em abastecimentos ainda não medidos.</p>' : ""}<div class="table-wrap"><table><thead><tr><th>ID</th><th>Data</th><th>Posto identificado</th><th>Placa</th><th>Produto</th><th>Quantidade</th><th>Preço carregado</th><th>Preço acordado</th><th>Diferença / L</th><th>Impacto</th><th>Centro de custo</th><th>Medição</th><th>Validação</th>${admin ? "<th>Ações</th>" : ""}</tr></thead><tbody>${db.abastecimentos.map((a) => { const issues = fuelingIssues(a), check = agreementCheck(a); return `<tr><td>${esc(a.id)}</td><td>${dateIso(a.data) ? dateBR(dateIso(a.data)) : badge("Data inválida")}</td><td>${esc(postoNome(a.postoId))}</td><td>${esc(a.placa)}</td><td>${esc(produtoNome(a.produtoId))}</td><td>${num(a.qt)} L</td><td>${money(a.preco)}</td><td>${check.agreedPrice === null ? "-" : money(check.agreedPrice)}</td><td class="${Number(check.differenceUnit || 0) ? "price-bad" : "price-good"}">${check.differenceUnit === null ? "-" : money(check.differenceUnit)}</td><td>${check.differenceTotal === null ? "-" : money(check.differenceTotal)}</td><td>${esc(a.centroCusto || "-")}</td><td>${a.medicaoId ? badge("Medido") : badge("Pendente")}</td><td title="${esc(a.priceOverrideJustification || "")}">${issues.length ? badge(issues.join(", ")) : badge("Conforme")}</td>${admin ? `<td>${!a.medicaoId ? `<button class="btn small secondary editFuel" data-id="${a.id}">Editar</button> <button class="btn small danger deleteFuel" data-id="${a.id}">Excluir</button>` : '<span class="muted">Bloqueado</span>'}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${admin ? 14 : 13}" class="muted">Nenhum abastecimento cadastrado.</td></tr>`}</tbody></table></div></div>`;
    $("#newAb").onclick = () => window.directFuelingForm(); $("#csvAb").onchange = previewFuelingImport;
    $$(".editFuel").forEach((button) => button.onclick = () => window.directFuelingForm(db.abastecimentos.find((item) => item.id === button.dataset.id)));
    $$(".deleteFuel").forEach((button) => button.onclick = () => { const item = db.abastecimentos.find((a) => a.id === button.dataset.id); if (!item || item.medicaoId) return toast("Abastecimento medido não pode ser excluído"); if (confirm(`Excluir o abastecimento pendente ${item.id}?`)) { db.abastecimentos = db.abastecimentos.filter((a) => a.id !== item.id); audit("Exclusão", "Abastecimento pendente", `${item.id} por ${currentUser()}`); save("Abastecimento excluído"); render(); } });
    const toolbar = $("#view .toolbar"); if (toolbar && window.directFuelAddBulkControls) window.directFuelAddBulkControls("abastecimentos", toolbar);
  };

  const terminalMeasurementStatus = (status) => ["Aprovada", "Rejeitada", "Devolvida para pendentes"].includes(String(status || ""));
  function reconciliation(med) { const sourceIds = (med.itens || []).length ? med.itens : med.status === "Devolvida para pendentes" ? (med.itensDevolvidos || []) : [], items = db.abastecimentos.filter((item) => sourceIds.includes(item.id)), qt = items.reduce((sum, item) => sum + Number(item.qt || 0), 0), valor = items.reduce((sum, item) => sum + Number(item.total || 0), 0), qtNf = Number(med.qtNf || 0), valorNf = Number(med.valorNf || 0), unresolved = items.map((item) => ({ item, check: agreementCheck(item) })).filter((entry) => entry.check.unresolved), priceImpact = unresolved.reduce((sum, entry) => sum + Number(entry.check.differenceTotal || 0), 0), diff = valorNf - valor, tolerance = Number(window.directFuelMeasurementTolerance?.(valor) || 0), quantityOk = qtNf > 0 && Math.abs(qtNf - qt) <= (window.directFuelVolumeTolerance?.() ?? .01)+.000001, justified = med.divergenciaAceita && String(med.divergenciaJustificativa || "").trim().length >= 5, valueOk = valorNf > 0 && (Math.abs(diff) <= tolerance + .000001 || justified); return { items, qt, valor, qtNf, valorNf, diff, tolerance, quantityOk, valueOk, unresolved, priceImpact, ok: quantityOk && valueOk }; }
  function measurementHistory(med, action, detail) { med.historico ||= []; med.historico.unshift({ id: uid("HIS"), data: new Date().toISOString(), usuario: window.DIRECTFUEL_CURRENT_EMAIL || currentUser(), acao: action, detalhe: detail }); med.historico = med.historico.slice(0, 200); }
  function approveMeasurement(med) { if (!window.directFuelCanAction("medicoes", "aprovar")) return toast("Seu perfil não pode aprovar medições"); if (!med || terminalMeasurementStatus(med.status)) return toast("Esta medição já possui uma decisão final"); if (window.directFuelInvoiceIssue) { const issue = window.directFuelInvoiceIssue(med); if (issue) return alert(issue); } const check = reconciliation(med); if (!check.ok) return alert(`A medição não pode ser aprovada.\n\nQuantidade da medição: ${num(check.qt)} L\nQuantidade das NFs: ${num(check.qtNf)} L\nValor da medição: ${money(check.valor)}\nValor das NFs: ${money(check.valorNf)}\nDiferença: ${money(check.diff)}\nTolerância financeira: ±${money(check.tolerance)}\nDiferença de volume: ${num(check.qtNf-check.qt)} L\nTolerância de volume: ±${num(window.directFuelVolumeTolerance?.() ?? .01)} L`); if (check.unresolved.length) return alert(`A medição não pode ser aprovada.\n\n${check.unresolved.length} abastecimento(s) possui(em) pendência de acordo ou preço.\nImpacto total: ${money(check.priceImpact)}\n\nCorrija o abastecimento ou solicite justificativa administrativa.`); if (!confirm(`Aprovar a medição ${med.numero}? As NFs mantidas em pendências continuarão separadas para correção.`)) return; med.status = "Aprovada"; med.aprovadoPor = currentUser(); med.aprovadoEm = new Date().toISOString(); measurementHistory(med, "Medição aprovada", `Tolerância aplicada: ${money(check.tolerance)}`); audit("Aprovação", "Medição", `${med.numero} por ${med.aprovadoPor}`); save("Medição aprovada"); render(); }
  function buildDueCorrection(measurement, changes, reason) {
    if (String(reason || "").trim().length < 5) throw Error("Informe um motivo com pelo menos 5 caracteres.");
    if (!changes.length) throw Error("Selecione pelo menos uma NF.");
    const updated = structuredClone(measurement), details = [];
    const notes = Array.isArray(updated.notasFiscais) && updated.notasFiscais.length ? updated.notasFiscais : [updated];
    const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4)) > 0 && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
    for (const change of changes) {
      const note = notes[change.index];
      if (!note || !valid(change.due)) throw Error("Informe uma data de vencimento válida para cada NF selecionada.");
      const parcels = Array.isArray(note.parcelas) ? note.parcelas : [];
      if (change.parcels.length !== parcels.length || change.parcels.some(value => value && !valid(value))) throw Error("Confira os vencimentos das parcelas.");
      const label = `NF ${note.numero || note.nf || '-'}${note.serie ? '-'+note.serie : ''}`;
      if ((note.vencimento || '') !== change.due) {
        details.push(`${label}: ${note.vencimento || 'não informado'} → ${change.due}`);
        note.vencimentoOriginal ??= note.vencimento || '';
        note.vencimento = change.due; note.vencimentoAjustado = change.due;
      }
      parcels.forEach((parcel,index) => {
        const value = change.parcels[index];
        if ((parcel.vencimento || '') !== value) {
          details.push(`${label}, parcela ${parcel.numero || index+1}: ${parcel.vencimento || 'não informado'} → ${value || 'não informado'}`);
          parcel.vencimentoOriginal ??= parcel.vencimento || ''; parcel.vencimento = value;
        }
      });
    }
    if (!details.length) throw Error("Nenhum vencimento foi alterado.");
    if (notes !== undefined && notes[0] !== updated) updated.vencimento = notes.flatMap(note => [note.vencimento, ...(Array.isArray(note.parcelas) ? note.parcelas.map(p=>p.vencimento) : [])]).filter(Boolean).sort()[0] || '';
    return {updated, detail: `${details.join(' · ')} · Motivo: ${reason.trim()}`};
  }

  function correctMeasurementDueDates(med) {
    if (!window.directFuelCanAction("medicoes", "editar")) return toast("Seu perfil não permite corrigir vencimentos.");
    const snapshot = JSON.stringify(med);
    const notes = Array.isArray(med.notasFiscais) && med.notasFiscais.length ? med.notasFiscais : [med];
    modal(`Corrigir vencimento · ${esc(med.numero)}`, `<p class="note">Selecione as NFs que deseja corrigir. Confira também as parcelas: o Dashboard considera o vencimento mais antigo. A correção mantém a aprovação e os vínculos SAP; não altera dados diretamente no SAP.</p><div class="toolbar"><label><input type="checkbox" id="dueSelectAll"> Marcar todas as NFs</label><label>Nova data para as selecionadas <input type="date" id="dueBulkDate"></label><button type="button" class="btn secondary" id="dueApplySelected">Aplicar às selecionadas e suas parcelas</button></div><div class="table-wrap"><table><thead><tr><th>Selecionar</th><th>NF</th><th>Vencimento atual</th><th>Novo vencimento</th><th>Parcelas</th></tr></thead><tbody>${notes.map((note,index)=>`<tr data-due-row="${index}"><td><input type="checkbox" class="due-note-check" aria-label="Selecionar NF ${esc(note.numero||note.nf||index+1)}"></td><td>${esc(note.numero||note.nf||'-')}${note.serie?'-'+esc(note.serie):''}</td><td>${esc(note.vencimento||'Não informado')}</td><td><input type="date" class="due-note-date" aria-label="Novo vencimento NF ${esc(note.numero||note.nf||index+1)}" value="${esc(dateIso(note.vencimento)||'')}"></td><td>${(Array.isArray(note.parcelas)?note.parcelas:[]).map((parcel,p)=>`<label style="display:block">Parcela ${esc(parcel.numero||p+1)} · atual: ${esc(parcel.vencimento||'Não informado')} <input type="date" class="due-parcel-date" value="${esc(dateIso(parcel.vencimento)||'')}" aria-label="Vencimento da parcela ${p+1}"></label>`).join('')||'Sem parcelas'}</td></tr>`).join('')}</tbody></table></div><div class="field" style="margin-top:16px"><label for="dueCorrectionReason">Motivo da correção</label><textarea id="dueCorrectionReason" minlength="5" maxlength="2000" placeholder="Informe o motivo e confira a data no documento."></textarea></div>`, back => {
      if (!window.directFuelCanAction("medicoes", "editar")) return toast("Seu perfil não permite corrigir vencimentos.");
      const current = db.medicoes.find(item=>item.id===med.id);
      if (!current || JSON.stringify(current)!==snapshot) return toast("A medição foi atualizada. Feche e reabra a correção para usar os dados atuais.");
      const changes = [...back.querySelectorAll('[data-due-row]')].filter(row=>row.querySelector('.due-note-check').checked).map(row=>({index:Number(row.dataset.dueRow),due:row.querySelector('.due-note-date').value,parcels:[...row.querySelectorAll('.due-parcel-date')].map(input=>input.value)}));
      try {
        const {updated,detail} = buildDueCorrection(current,changes,$('#dueCorrectionReason',back).value);
        measurementHistory(updated,"Vencimento corrigido",detail);
        Object.assign(current,updated);
        audit("Correção de vencimento","Medição",`${current.numero} · ${detail}`);
        save("Vencimentos corrigidos"); back.remove();
      } catch(error) { toast(error.message); }
    });
    const back = document.querySelector('.modal-back:last-child');
    $('.save',back).textContent='Salvar vencimentos';
    $('#dueSelectAll',back).onchange=event=>back.querySelectorAll('.due-note-check').forEach(input=>input.checked=event.target.checked);
    back.querySelectorAll('.due-note-date,.due-parcel-date').forEach(input=>input.onchange=()=>{input.closest('tr').querySelector('.due-note-check').checked=true;});
    $('#dueApplySelected',back).onclick=()=>{
      const input=$('#dueBulkDate',back);if(!input.value||!input.checkValidity())return toast("Informe uma data válida.");
      const rows=[...back.querySelectorAll('[data-due-row]')].filter(row=>row.querySelector('.due-note-check').checked);
      if(!rows.length)return toast("Selecione as NFs que receberão a data.");
      rows.forEach(row=>row.querySelectorAll('.due-note-date,.due-parcel-date').forEach(field=>field.value=input.value));
    };
  }

  function reopenApproval(med) {
    if (!isAdmin() || !window.directFuelCanAction("medicoes", "excluir")) return toast("É necessário ser Administrador com permissão de excluir medições");
    if (med.status !== "Aprovada") return toast("Esta medição não está aprovada");
    if (med.accountingAdjustmentId || (db.accountingAdjustments || []).some(item => (item.measurementIds || []).includes(med.id))) return toast("Desfaça a contabilização desta medição antes de reabrir a aprovação");
    modal(`Excluir aprovação · ${esc(med.numero)}`, `<p class="note">A medição continuará em Medições realizadas, pendente de aprovação. As NFs e os abastecimentos permanecerão vinculados. Após ajustar, será necessário aprovar novamente e gerar uma nova RC, se aplicável.</p><div class="field"><label>Motivo</label><textarea id="reopenApprovalReason" minlength="5"></textarea></div>`, back => {
      const reason = val("reopenApprovalReason").trim(); if (reason.length < 5) return toast("Informe um motivo com pelo menos 5 caracteres");
      measurementHistory(med, "Aprovação excluída", `${reason} · aprovação anterior: ${med.aprovadoPor || "-"} em ${med.aprovadoEm || "-"} · RC anterior: ${med.rcSapGeradoEm || "não gerada"}`);
      med.status = "Pendente de aprovação"; med.reabertoPor = window.DIRECTFUEL_CURRENT_EMAIL || currentUser(); med.reabertoEm = new Date().toISOString(); med.reaberturaMotivo = reason;
      delete med.aprovadoPor; delete med.aprovadoEm; delete med.rcSapGeradoEm; delete med.rcSapGeradoPor; delete med.rcSapCentroCustoOrigem;
      audit("Reabertura", "Medição", `${med.numero} · ${reason}`); save("Aprovação excluída; medição pendente de nova aprovação"); back.remove(); render();
    });
    $(".modal-back:last-child .save").textContent = "Excluir aprovação";
  }
  function decideMeasurement(med, decision) {
    if (decision !== "return") return toast("A rejeição de medições não está disponível");
    if (!window.directFuelCanAction("medicoes", "aprovar")) return toast("Seu perfil não pode decidir medições");
    if (!med || (terminalMeasurementStatus(med.status) && med.status !== "Rejeitada")) return toast("Esta medição já possui uma decisão final");
    const priorRejection = med.status === "Rejeitada" ? { by: med.rejeitadaPor || "-", at: med.rejeitadaEm || "-", reason: med.rejeicaoMotivo || "-" } : null;
    modal(`Devolver ${esc(med.numero)} para pendentes`, `<p class="note">Os abastecimentos serão liberados e voltarão para Medições pendentes. O registro, as NFs e todo o histórico desta medição serão preservados.</p>${priorRejection?`<p class="note">Rejeição anterior: ${esc(priorRejection.reason)} · ${esc(priorRejection.by)} · ${esc(priorRejection.at)}</p>`:""}<div class="field" style="margin-top:14px"><label>Motivo obrigatório</label><textarea id="measurementDecisionReason" minlength="5" placeholder="Informe o motivo da devolução"></textarea><small class="muted">Mínimo de 5 caracteres. A decisão ficará registrada com usuário, data e hora.</small></div>`, (back) => {
      const reason = val("measurementDecisionReason").trim(); if (reason.length < 5) return toast("Informe um motivo com pelo menos 5 caracteres");
      const timestamp = new Date().toISOString(), user = window.DIRECTFUEL_CURRENT_EMAIL || currentUser();
      const returnedIds = [...new Set((med.itens || []).map(String))]; if (!returnedIds.length) return toast("Esta medição não possui abastecimentos para devolver");
      const returnedSet = new Set(returnedIds); db.abastecimentos.forEach((item) => { if (item.medicaoId === med.id || returnedSet.has(String(item.id))) item.medicaoId = null; });
      med.itensDevolvidos = returnedIds; med.itens = []; med.status = "Devolvida para pendentes"; med.devolvidaPor = user; med.devolvidaEm = timestamp; med.devolucaoMotivo = reason;
      measurementHistory(med, "Medição devolvida para pendentes", `${reason}${priorRejection?` · rejeição anterior: ${priorRejection.reason} · ${priorRejection.by} em ${priorRejection.at}`:""}`);
      delete med.rejeitadaPor; delete med.rejeitadaEm; delete med.rejeicaoMotivo;
      audit("Devolução", "Medição", `${med.numero} por ${user} · ${reason}`); save("Abastecimentos devolvidos para medições pendentes");
      back.remove(); render();
    });
  }
  function pendingMeasurementsPage() {
    pageTitle("Medições pendentes", "Selecione todos os abastecimentos que compõem a nota fiscal"); const pending = db.abastecimentos.filter((item) => !item.medicaoId);
    $("#view").innerHTML = `<div class="panel"><div class="toolbar"><label>De <input type="date" id="mDe" class="btn secondary"></label><label>Até <input type="date" id="mAte" class="btn secondary"></label><select id="mPosto" class="btn secondary"><option value="">Todos os postos</option>${opts("postos", (item) => item.fantasia || item.razao)}</select><button class="btn primary" id="createMeasurement">Criar medição com selecionados</button></div><div id="pendingMeasurementTable"></div></div>`;
    const draw = () => { const rows = pending.filter((a) => (!val("mDe") || a.data >= val("mDe")) && (!val("mAte") || a.data <= val("mAte")) && (!val("mPosto") || a.postoId === val("mPosto"))); $("#pendingMeasurementTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="selectAllPending"></th><th>Data</th><th>Posto identificado</th><th>Placa</th><th>Motorista</th><th>Produto</th><th>Centro de custo</th><th>Quantidade</th><th>Valor</th><th>Acordo e preço</th></tr></thead><tbody>${rows.map((a) => { const check = agreementCheck(a); return `<tr><td><input type="checkbox" class="pendingSelection" value="${a.id}"></td><td>${dateBR(a.data)}</td><td>${esc(postoNome(a.postoId))}</td><td>${esc(a.placa)}</td><td>${esc(a.motorista || "-")}</td><td>${esc(produtoNome(a.produtoId))}</td><td>${esc(a.centroCusto || "-")}</td><td>${num(a.qt)} L</td><td>${money(a.total)}</td><td title="${esc(a.priceOverrideJustification || "")}">${badge(check.overridden ? `${check.code} justificado` : check.code)}</td></tr>`; }).join("") || '<tr><td colspan="10" class="muted">Nenhum abastecimento pendente.</td></tr>'}</tbody></table></div>`; if ($("#selectAllPending")) $("#selectAllPending").onchange = (event) => $$(".pendingSelection").forEach((input) => { input.checked = event.target.checked; }); };
    draw(); ["mDe", "mAte", "mPosto"].forEach(id => { const input = $("#" + id); input.oninput = draw; input.onchange = draw; }); $("#createMeasurement").onclick = () => { const ids = $$(".pendingSelection:checked").map((input) => input.value); if (!ids.length) return toast("Selecione ao menos um abastecimento"); formMedicao(ids); };
  }
  function editMeasurement(med) {
    if (terminalMeasurementStatus(med?.status)) return toast("Medições com decisão final não podem ser editadas");
    if (!window.directFuelCanAction("medicoes", "editar")) return toast("Seu perfil não permite editar esta medição");
    if (window.directFuelInvoiceEditor) return window.directFuelInvoiceEditor(med.itens, med);
    if (!(window.directFuelCanAction("medicoes", "editar"))) return toast("Seu acesso não permite editar medições"); const check = reconciliation(med);
    modal(`Editar medição ${esc(med.numero)}`, `<div class="form-grid"><div class="field"><label>Número da medição</label><input id="emNumero" value="${esc(med.numero)}"></div><div class="field"><label>Número NF</label><input id="emNf" value="${esc(med.nf || "")}"></div><div class="field"><label>Série</label><input id="emSerie" value="${esc(med.serie || "")}"></div><div class="field"><label>Chave DANFE/NF-e</label><input id="emChave" value="${esc(med.chave || "")}" maxlength="44"></div><div class="field"><label>Quantidade NF</label><input type="number" step="0.01" id="emQtNf" value="${med.qtNf || 0}"></div><div class="field"><label>Valor NF</label><input type="number" step="0.01" id="emValorNf" value="${med.valorNf || 0}"></div><div class="field"><label>Emissão</label><input type="date" id="emEmissao" value="${med.emissao || ""}"></div><div class="field"><label>Vencimento</label><input type="date" id="emVenc" value="${med.vencimento || ""}"></div><div class="field"><label>Status</label><select id="emStatus"><option>Aguardando NF</option><option>Conciliada</option><option>Aprovada</option></select></div></div><div class="note" style="margin-top:14px">Valor atual dos abastecimentos: <strong>${money(check.valor)}</strong>. Tolerância configurada: <strong>${money(check.tolerance)}</strong>. Pendências de acordo/preço: <strong>${check.unresolved.length}</strong>.</div>`, (back) => { const qtNf = nval("emQtNf"), valorNf = nval("emValorNf"), selectedStatus = val("emStatus"), tolerance = Number(window.directFuelMeasurementTolerance?.(check.valor) || 0), justified = med.divergenciaAceita && String(med.divergenciaJustificativa || "").trim().length >= 5, ok = qtNf > 0 && valorNf > 0 && Math.abs(qtNf - check.qt) <= (window.directFuelVolumeTolerance?.() ?? .01)+.000001 && (Math.abs(valorNf - check.valor) <= tolerance + .000001 || justified); if (selectedStatus === "Aprovada" && !ok) return toast(`Não é possível aprovar: divergência acima da tolerância de ${money(tolerance)}`); if (selectedStatus === "Aprovada" && check.unresolved.length) return toast("Não é possível aprovar: existem pendências de acordo ou preço"); Object.assign(med, { numero: val("emNumero"), nf: val("emNf"), serie: val("emSerie"), chave: val("emChave"), qtNf, valorNf, emissao: val("emEmissao"), vencimento: val("emVenc"), status: selectedStatus }); if (selectedStatus === "Aprovada" && !med.aprovadoPor) { med.aprovadoPor = currentUser(); med.aprovadoEm = new Date().toISOString(); measurementHistory(med, "Medição aprovada", `Tolerância aplicada: ${money(tolerance)}`); } audit("Edição Master", "Medição", `${med.numero} por ${currentUser()}`); save("Medição atualizada"); back.remove(); render(); }); setTimeout(() => { $("#emStatus").value = med.status; }, 0);
  }
  const normalizedMeasurementSearch = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  function splitMeasurementInvoiceNumbers(value) { return String(value||"").split(/[;,|\s]+/).flatMap(part=>/^\d{12,}$/.test(part)&&part.length%6===0?(part.match(/\d{6}/g)||[]):[part]).map(part=>part.trim()).filter(Boolean); }
  function measurementInvoiceNumbers(med) { const notes=Array.isArray(med.notasFiscais)?med.notasFiscais.flatMap(note=>splitMeasurementInvoiceNumbers(note.numero)):[],legacy=splitMeasurementInvoiceNumbers(med.nf),numbers=[...new Set([...notes,...legacy])];return numbers.sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true})); }
  function measurementSavedAt(med) { const history=Array.isArray(med.historico)?med.historico.map(item=>item?.data).filter(Boolean).sort():[];return String(med.salvoEm||med._meta?.createdAt||history[0]||med.confirmadoEm||med.aprovadoEm||med.devolvidaEm||med.rejeitadaEm||med.canceladoEm||""); }
  function showCompletedMeasurementFuelings(measurement) {
    const ids=new Set((measurement.itens||[]).map(String));
    const rows=(db.abastecimentos||[]).filter(item=>ids.has(String(item.id))).sort((a,b)=>String(a.data||'').localeCompare(String(b.data||''))||String(a.id).localeCompare(String(b.id)));
    const missing=[...ids].filter(id=>!rows.some(item=>String(item.id)===id));
    const notes=Array.isArray(measurement.notasFiscais)?measurement.notasFiscais:[];
    const invoiceFor=item=>{
      const linked=notes.filter(note=>(note.abastecimentoIds||[]).map(String).includes(String(item.id)));
      return linked.map(note=>[note.numero,note.serie].filter(Boolean).join('-')).join(', ')||(!notes.length?[measurement.nf,measurement.serie].filter(Boolean).join('-'):'')||'—';
    };
    const total=rows.reduce((sum,item)=>sum+Number(item.total??Number(item.qt||0)*Number(item.preco||0)),0),volume=rows.reduce((sum,item)=>sum+Number(item.qt||0),0);
    modal(`Abastecimentos · ${esc(measurement.numero||measurement.id)}`,`<p>${esc(postoNome(measurement.postoId))} · ${esc(measurement.status||'Sem status')}</p><p class="note"><strong>${rows.length} abastecimento(s)</strong> · ${num(volume)} L · ${money(total)}</p>${missing.length?`<p class="note">${missing.length} abastecimento(s) vinculado(s) não encontrado(s) na base carregada. Os totais abaixo consideram apenas os registros disponíveis.</p>`:''}<div class="table-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th>ID</th><th>Data</th><th>Placa</th><th>Motorista</th><th>Produto</th><th>Centro de custo</th><th>Quantidade (L)</th><th>Preço unitário</th><th>Valor total</th><th>NF</th></tr></thead><tbody>${rows.map(item=>`<tr><td>${esc(item.id)}</td><td>${dateBR(item.data)}</td><td>${esc(item.placa||'—')}</td><td>${esc(item.motorista||'—')}</td><td>${esc(produtoNome(item.produtoId))}</td><td>${esc(item.centroCusto||'—')}</td><td>${num(item.qt)}</td><td>${Number(item.preco||0).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:4})}</td><td>${money(item.total??Number(item.qt||0)*Number(item.preco||0))}</td><td>${esc(invoiceFor(item))}</td></tr>`).join('')||'<tr><td colspan="10" class="muted">Nenhum abastecimento vinculado disponível.</td></tr>'}</tbody></table></div>`,()=>{});
    const back=document.querySelector('.modal-back:last-child');
    back.querySelector('.modal').style.cssText='width:96vw;max-width:1500px';
    back.querySelector('.save').remove();
    back.querySelector('.cancel').textContent='Fechar';
  }
  function measurementWithoutSapOrder(state, measurement) {
    if (measurement.status !== 'Aprovada') return false;
    const key = value => String(value ?? '').trim().split('-').map(part => part.replace(/^0+(?=\d)/, '')).join('-');
    const notes = Array.isArray(measurement.notasFiscais) ? measurement.notasFiscais : [];
    const invoiceKeys = new Set(notes.map(note => key(`${note.numero||''}-${note.serie||''}`)));
    if (!notes.length && measurement.nf) invoiceKeys.add(key(`${measurement.nf}-${measurement.serie||''}`));
    return !(state.sapReturns || []).some(record => !record.voided && record.status === 'success' &&
      String(record.measurementId) === String(measurement.id) && /^\d+$/.test(String(record.purchaseOrder || '').trim()) &&
      invoiceKeys.has(key(record.invoiceKey)));
  }

  const isReturnedMeasurement = measurement => /^devolvida(?:\s|$)/i.test(String(measurement.status || '').trim());
  const isUnapprovedMeasurement = measurement => measurement.status !== 'Aprovada' && !isReturnedMeasurement(measurement);

  function completedMeasurementsPage() {
    pageTitle("Medições realizadas", "Acompanhamento por exceção, aprovação e histórico de processamento");
    const mayDecide = window.directFuelCanAction("medicoes", "aprovar"), mayExport = window.directFuelCanAction("medicoes", "exportar");
    const records=(Array.isArray(db.medicoes)?db.medicoes:[]).filter(Boolean).map(m=>({measurement:m,check:reconciliation(m),nfs:measurementInvoiceNumbers(m),savedAt:measurementSavedAt(m),reason:[m.rejeicaoMotivo,m.devolucaoMotivo,m.divergenciaMotivo,m.divergenciaJustificativa].filter(Boolean).join(" · ")})).sort((a,b)=>String(b.savedAt||b.measurement.confirmadoEm||b.measurement.devolvidaEm||"").localeCompare(String(a.savedAt||a.measurement.confirmadoEm||a.measurement.devolvidaEm||"")));
    const statusCounts=new Map();records.forEach(({measurement})=>{const status=String(measurement.status||"Sem status").trim()||"Sem status";statusCounts.set(status,(statusCounts.get(status)||0)+1);});
    const statuses=[...statusCounts.keys()].filter(status=>!isReturnedMeasurement({status})).sort((a,b)=>a.localeCompare(b,"pt-BR"));
    $("#view").innerHTML=`<div class="panel"><p class="note">Exibição inicial: <strong>medições não aprovadas, sem as devolvidas</strong>. Consulte as devolvidas no filtro “Devolvida”. A aprovação usa a tolerância definida em Configurações → Conciliação fiscal da medição.</p><div class="table-filter-panel"><div class="form-grid table-filters"><div class="field"><label>Medição</label><input type="search" autocomplete="off" id="completedMeasurementFilter" placeholder="Digite o número"></div><div class="field"><label for="completedStationFilter">Posto</label><select id="completedStationFilter"><option value="">Todos os postos</option>${[...new Set(records.map(record=>String(record.measurement.postoId||"")))].filter(Boolean).sort((a,b)=>postoNome(a).localeCompare(postoNome(b),"pt-BR")).map(id=>`<option value="${esc(id)}">${esc(postoNome(id))}</option>`).join("")}</select></div><div class="field"><label>NF</label><input type="search" autocomplete="off" id="completedInvoiceFilter" placeholder="Digite uma ou mais NFs"></div><div class="field"><label>Acordo/preço</label><select id="completedAgreementFilter"><option value="all">Todos</option><option value="ok">Conforme</option><option value="pending">Com pendência</option></select></div><div class="field"><label>Status</label><select id="completedStatusFilter"><option value="not-approved" selected>Não aprovadas (${records.filter(record=>isUnapprovedMeasurement(record.measurement)).length})</option><option value="all">Todos (${records.length})</option><option value="returned">Devolvida (${records.filter(record=>isReturnedMeasurement(record.measurement)).length})</option><option value="without-sap-order">Sem RC (${records.filter(record=>measurementWithoutSapOrder(db,record.measurement)).length})</option>${statuses.map(status=>`<option value="${esc(status)}">${esc(status)} (${statusCounts.get(status)})</option>`).join("")}</select></div><div class="field"><label>Salvo por</label><input type="search" autocomplete="off" id="completedSavedByFilter" placeholder="Nome ou e-mail"></div><div class="field"><label>Motivo</label><input type="search" autocomplete="off" id="completedReasonFilter" placeholder="Digite para consultar"></div></div><div class="toolbar"><button class="btn primary" id="showAllCompleted">Exibir todas</button>${mayExport?'<button class="btn secondary" id="generateSelectedRcSap" disabled>Gerar RC SAP (0)</button><label style="display:inline-flex;align-items:center;gap:8px"><input type="checkbox" id="selectAllCompletedRc" disabled> Selecionar todas as aprovadas da tela</label>':""}<button class="btn secondary" id="restoreCompletedDefault">Restaurar filtro padrão</button><span class="muted" id="completedMeasurementCount" role="status" aria-live="polite"></span></div></div><div class="table-wrap completed-measurements-wrap" style="margin-top:14px"><table class="completed-measurements-table"><thead><tr><th>Ações</th><th>Medição</th><th>Data de gravação</th><th>Posto</th><th>Período</th><th>Quantidade</th><th>Valor medição</th><th>Valor NF</th><th>Diferença NF</th><th>Acordo/preço</th><th>Impacto</th><th>Status</th><th>Salvo por</th><th>Decisão por</th><th>Motivo</th><th>NF</th><th>Excluir aprovação</th></tr></thead><tbody id="completedMeasurementRows"></tbody></table></div><p class="muted" style="margin-top:10px">Marque as medições aprovadas que deseja incluir na RC SAP. Passe o cursor sobre a diferença da NF para consultar a tolerância aplicada.</p></div>`;
    const createCell=(text,className="",title="")=>{const cell=document.createElement("td");cell.textContent=String(text??"");if(className)cell.className=className;if(title)cell.title=title;return cell;};
    const createBadge=text=>{const value=String(text||"Sem status"),element=document.createElement("span");element.className=`badge ${/ativo|vigente|medido|conciliado|aprovado/i.test(value)?"ok":/pendente|aguardando|atenção|futuro/i.test(value)?"warn":/inativo|cancelado/i.test(value)?"off":"bad"}`;element.textContent=value;return element;};
    const createButton=(label,className,measurement,handler)=>{const button=document.createElement("button");button.type="button";button.className=className;button.dataset.id=String(measurement.id||"");button.textContent=label;button.onclick=()=>handler(measurement);return button;};
    const createMeasurementDetailCell=measurement=>{
      const cell=document.createElement('td'),button=createButton(measurement.numero||measurement.id,'btn small secondary measurementFuelingDetails',measurement,showCompletedMeasurementFuelings);
      button.title='Consultar abastecimentos desta medição';
      button.setAttribute('aria-label',`Consultar abastecimentos da medição ${measurement.numero||measurement.id}`);
      cell.dataset.exportValue=String(measurement.numero||measurement.id||'');
      cell.append(button);return cell;
    };
    const selectedRcIds=new Set(),selectionKey=measurement=>String(measurement.id||measurement.numero||"");
    let visibleRcIds=new Set();
    const updateRcSapButton=()=>{const button=$("#generateSelectedRcSap");if(!button)return;button.disabled=selectedRcIds.size===0;button.textContent=`Gerar RC SAP (${selectedRcIds.size})`;const all=$("#selectAllCompletedRc");if(all){all.disabled=visibleRcIds.size===0;all.checked=visibleRcIds.size>0&&selectedRcIds.size===visibleRcIds.size;all.indeterminate=selectedRcIds.size>0&&selectedRcIds.size<visibleRcIds.size;}};
    const generateSelectedRcSap=(options,back)=>{const measurements=records.map(record=>record.measurement).filter(measurement=>selectedRcIds.has(selectionKey(measurement))&&measurement.status==="Aprovada"),result=window.DirectFuelRcSap?.createBatch(db,measurements,options);if(!result)return toast("Gerador de RC SAP indisponível");if(result.errors.length)return alert(`Não foi possível gerar a RC SAP:\n\n${result.errors.join("\n")}`);const link=document.createElement("a"),generatedAt=new Date().toISOString(),generatedBy=window.DIRECTFUEL_CURRENT_EMAIL||currentUser();link.href=URL.createObjectURL(result.blob);link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);back.remove();measurements.forEach(measurement=>{measurement.rcSapCentroCustoOrigem=options.centroCustoOrigem;measurement.rcSapGeradoEm=generatedAt;measurement.rcSapGeradoPor=generatedBy;measurementHistory(measurement,"RC SAP gerada",`${result.filename} · lote com ${measurements.length} medição(ões) · centro de custo: ${options.centroCustoOrigem === "frota" ? "cadastro da Frota" : `Transitório ${db.config?.params?.rcSapCentroCustoTransitorio||""}`}`);measurement.historico[0].rcAllocations=(result.allocations||[]).filter(item=>item.measurementId===measurement.id);measurement.historico[0].rcItems=result.items.filter(item=>item.measurementId===measurement.id).map(item=>({...item}));});audit("Exportação","RC SAP",`${measurements.map(measurement=>measurement.numero).join(", ")} · ${result.rows.length} linha(s) · ${generatedBy}`);save(`RC SAP gerada para ${measurements.length} medição(ões)`);selectedRcIds.clear();drawFilters();};
    const createActionCell=measurement=>{const cell=document.createElement("td"),terminal=terminalMeasurementStatus(measurement.status),key=selectionKey(measurement),eligible=measurement.status==="Aprovada"&&mayExport,selector=document.createElement("input");selector.type="checkbox";selector.className="rcSapSelection";selector.checked=selectedRcIds.has(key);selector.disabled=!eligible;selector.setAttribute("aria-label",eligible?`Selecionar ${measurement.numero||"medição"} para RC SAP`:`${measurement.numero||"Medição"} ainda não está aprovada`);selector.title=eligible?"Selecionar para gerar RC SAP":"Disponível somente para medições aprovadas";selector.onchange=()=>{if(selector.checked)selectedRcIds.add(key);else selectedRcIds.delete(key);updateRcSapButton();};if(window.directFuelCanAction("medicoes","editar"))cell.append(createButton("Corrigir vencimento","btn small secondary correctDueDate",measurement,correctMeasurementDueDates));cell.append(selector);if(!terminal){if(mayDecide)cell.append(createButton("Aprovar","btn small primary approveDone",measurement,approveMeasurement));if(measurement.status!=="Confirmado"||(window.directFuelCanAction("medicoes","editar")))cell.append(createButton("Editar","btn small secondary editMeasurement",measurement,editMeasurement));if(mayDecide)cell.append(createButton("Devolver para pendentes","btn small warn returnMeasurement",measurement,item=>decideMeasurement(item,"return")));}else{if(measurement.status==="Rejeitada"&&mayDecide)cell.append(createButton("Devolver para pendentes","btn small warn returnMeasurement",measurement,item=>decideMeasurement(item,"return")));const label=document.createElement("span");label.className="muted";label.textContent="Decisão registrada";cell.append(label);}return cell;};
    const measurementRow=({measurement:m,check,nfs,savedAt,reason})=>{const row=document.createElement("tr"),decisionBy=m.aprovadoPor||m.rejeitadaPor||m.devolvidaPor||"-",date=savedAt?new Date(savedAt):null,savedLabel=date&&!Number.isNaN(date.getTime())?date.toLocaleString("pt-BR"):"-";row.className="completed-measurement-row";row.hidden=false;row.style.setProperty("display","table-row","important");row.style.setProperty("visibility","visible","important");row.style.setProperty("opacity","1","important");row.dataset.completedId=String(m.id||"");row.append(createActionCell(m),createMeasurementDetailCell(m),createCell(savedLabel),createCell(postoNome(m.postoId)),createCell(`${dateBR(m.inicio)} a ${dateBR(m.fim)}`),createCell(`${num(check.qt)} L`),createCell(money(check.valor)),createCell(money(check.valorNf)),createCell(money(check.diff),check.valueOk?"price-good":"price-bad",`Tolerância aplicável: ${money(check.tolerance)}`));const agreementCell=document.createElement("td");agreementCell.append(createBadge(check.unresolved.length?`${check.unresolved.length} pendência(s)`:"Conforme"));row.append(agreementCell,createCell(money(check.priceImpact)));const statusCell=document.createElement("td");statusCell.append(createBadge(isReturnedMeasurement(m)?"Devolvida":m.status||"Sem status"));if(measurementWithoutSapOrder(db,m)){const pending=createBadge("Sem RC");pending.className="badge warn";pending.title="Medição aprovada sem pedido vinculado no SAP";statusCell.append(document.createElement("br"),pending);}row.append(statusCell,createCell(m.salvoPor||m._meta?.createdBy||"-"),createCell(decisionBy),createCell(reason||"-","",reason||"-"));const invoiceCell=document.createElement("td"),preview=nfs.slice(0,3);invoiceCell.className="measurement-nf-cell";invoiceCell.dataset.exportValue=nfs.join(", ");invoiceCell.textContent=preview.length?`${preview.join(", ")}${nfs.length>preview.length?` · +${nfs.length-preview.length} NF(s)`:""}`:"-";row.append(invoiceCell);const finalActionCell=document.createElement("td");if(m.status==="Aprovada"&&isAdmin()&&window.directFuelCanAction("medicoes","excluir"))finalActionCell.append(createButton("Excluir aprovação","btn small danger reopenApproval",m,reopenApproval));row.append(finalActionCell);[...row.cells].forEach(cell=>{cell.style.setProperty("display","table-cell","important");cell.style.setProperty("visibility","visible","important");cell.style.setProperty("opacity","1","important");cell.style.setProperty("vertical-align","top","important");});return row;};
    const filterState={number:"",station:"",invoice:"",agreement:"all",status:"not-approved",savedBy:"",reason:""};
    const drawFilters=()=>{const number=normalizedMeasurementSearch(filterState.number),invoiceTerms=normalizedMeasurementSearch(filterState.invoice).split(" ").filter(Boolean),agreement=filterState.agreement,status=filterState.status,savedBy=normalizedMeasurementSearch(filterState.savedBy),reason=normalizedMeasurementSearch(filterState.reason),filtered=records.filter(record=>{const m=record.measurement,agreementStatus=record.check.unresolved.length?"pending":"ok",invoiceText=normalizedMeasurementSearch(record.nfs.join(" "));return (!filterState.station||String(m.postoId||"")===filterState.station)&&(!number||normalizedMeasurementSearch(m.numero).includes(number))&&(!invoiceTerms.length||invoiceTerms.every(term=>invoiceText.includes(term)))&&(agreement==="all"||agreement===agreementStatus)&&(status==="all"||(status==="not-approved"?isUnapprovedMeasurement(m):status==="returned"?isReturnedMeasurement(m):status==="without-sap-order"?measurementWithoutSapOrder(db,m):m.status===status))&&(!savedBy||normalizedMeasurementSearch(m.salvoPor||m._meta?.createdBy).includes(savedBy))&&(!reason||normalizedMeasurementSearch(record.reason).includes(reason));}),tbody=$("#completedMeasurementRows");visibleRcIds=new Set(filtered.filter(record=>mayExport&&record.measurement.status==="Aprovada").map(record=>selectionKey(record.measurement)));for(const key of selectedRcIds)if(!visibleRcIds.has(key))selectedRcIds.delete(key);updateRcSapButton();tbody.hidden=false;tbody.style.setProperty("display","table-row-group","important");tbody.style.setProperty("visibility","visible","important");tbody.replaceChildren();if(filtered.length)filtered.forEach(record=>tbody.append(measurementRow(record)));else{const row=document.createElement("tr"),cell=createCell(records.length?"Nenhuma medição corresponde aos filtros selecionados.":"Nenhuma medição realizada.","muted");cell.colSpan=17;row.append(cell);tbody.append(row);}const renderedCount=filtered.length?tbody.rows.length:0;tbody.dataset.renderedCount=String(renderedCount);$("#completedMeasurementCount").textContent=`${renderedCount} de ${records.length} medições exibidas`;};
    const filterFields={completedMeasurementFilter:"number",completedStationFilter:"station",completedInvoiceFilter:"invoice",completedAgreementFilter:"agreement",completedStatusFilter:"status",completedSavedByFilter:"savedBy",completedReasonFilter:"reason"};Object.entries(filterFields).forEach(([id,key])=>{const field=$("#"+id),update=event=>{filterState[key]=event.target.value;drawFilters();};field.oninput=update;field.onchange=update;});
    const clearCompletedFilters=status=>{Object.assign(filterState,{number:"",station:"",invoice:"",agreement:"all",status,savedBy:"",reason:""});["completedMeasurementFilter","completedStationFilter","completedInvoiceFilter","completedSavedByFilter","completedReasonFilter"].forEach(id=>$("#"+id).value="");$("#completedAgreementFilter").value="all";$("#completedStatusFilter").value=status;drawFilters();};
    $("#showAllCompleted").onclick=()=>clearCompletedFilters("all");$("#restoreCompletedDefault").onclick=()=>clearCompletedFilters("not-approved");if(mayExport){$("#generateSelectedRcSap").onclick=()=>{const taxRows=records.map(r=>r.measurement).filter(m=>selectedRcIds.has(selectionKey(m))).flatMap(m=>(db.abastecimentos||[]).filter(a=>(m.itens||[]).includes(a.id)).map(a=>{const tax=window.DirectFuelRcSap.ivaFor(db,m,a);return `<tr><td>${esc(m.numero)}</td><td>${esc(postoNome(m.postoId))}</td><td>${esc(produtoNome(a.produtoId))}</td><td>${esc(tax.agreementNumber||tax.agreementId)}</td><td>${esc(tax.iva||'—')}</td><td>${esc(tax.error||'Conforme')}</td></tr>`;})).join('');modal("Gerar RC SAP",`<div class="table-wrap" style="max-height:280px;overflow:auto"><table><thead><tr><th>Medição</th><th>Posto</th><th>Produto</th><th>Acordo</th><th>IVA SAP</th><th>Validação</th></tr></thead><tbody>${taxRows}</tbody></table></div><p>${selectedRcIds.size} medição(ões) selecionada(s).</p><fieldset><legend>Formato da RC e centro de custo</legend><label style="display:block;margin:12px 0"><input type="radio" name="rcCostCenterSource" value="rateio" checked> Consolidar por NF/material com Centro de Custo “Rateio” + aba Rateio</label><label style="display:block;margin:12px 0"><input type="radio" name="rcCostCenterSource" value="frota"> Detalhado por abastecimento — centro de custo da Frota</label><label style="display:block;margin:12px 0"><input type="radio" name="rcCostCenterSource" value="transitorio"> Detalhado por abastecimento — Transitório configurado (${esc(db.config?.params?.rcSapCentroCustoTransitorio||"não informado")})</label></fieldset><p class="note">No modo consolidado, cada bloco de rateio fecha 100,0 por item/material, com uma casa decimal e sem símbolo % na planilha; todos os abastecimentos e relatórios detalhados são preservados. Centro de custo, conta contábil, percentual, valor, quantidade e material são as seis colunas do rateio. Categoria, Conta Contábil e Grupo Comprador vêm de Configurações → Conciliação fiscal da medição. A Forma de Pagamento vem do acordo do posto/produto na data do abastecimento: Boleto = B; Depósito em conta = T. Centro e Depósito vêm da unidade Vixpar de cada abastecimento.</p>`,back=>generateSelectedRcSap({centroCustoOrigem:$("input[name=rcCostCenterSource]:checked",back).value},back));const back=document.querySelector(".modal-back:last-child");$(".save",back).textContent="Gerar RC SAP";};$("#selectAllCompletedRc").onchange=event=>{selectedRcIds.clear();if(event.target.checked)visibleRcIds.forEach(key=>selectedRcIds.add(key));drawFilters();};}drawFilters();updateRcSapButton();
  }
  medicoes = pendingMeasurementsPage;

  function agreementForFueling(a) { return agreementForDate(a); }
  function filterFuelings() { return db.abastecimentos.filter((a) => (!val("dFrom") || a.data >= val("dFrom")) && (!val("dTo") || a.data <= val("dTo")) && (!val("dStation") || a.postoId === val("dStation")) && (!val("dUnit") || a.unidadeId === val("dUnit")) && (!val("dProduct") || a.produtoId === val("dProduct"))); }
  function groupRows(rows, keyFn, labelFn) { const map = new Map(); rows.forEach((a) => { const key = keyFn(a), agreement = agreementForFueling(a), ticket = Number(agreement?.ticketlog || a.preco || 0) * Number(a.qt || 0), item = map.get(key) || { label: labelFn(a), volume: 0, total: 0, ticket: 0, count: 0 }; item.volume += Number(a.qt || 0); item.total += Number(a.total || 0); item.ticket += ticket; item.count++; map.set(key, item); }); return [...map.values()].map((item) => ({ ...item, saving: item.ticket - item.total, savingPct: item.ticket ? (item.ticket - item.total) / item.ticket * 100 : 0 })).sort((a, b) => b.volume - a.volume); }
  function workbook(filename, sheets) { const cell = (value) => `<Cell><Data ss:Type="${typeof value === "number" && Number.isFinite(value) ? "Number" : "String"}">${esc(value)}</Data></Cell>`, xmlSheets = sheets.map((sheet) => `<Worksheet ss:Name="${sheet.name.slice(0, 31)}"><Table><Row>${sheet.columns.map(([label]) => cell(label)).join("")}</Row>${sheet.rows.map((row) => `<Row>${sheet.columns.map(([, key]) => cell(row[key] ?? "")).join("")}</Row>`).join("")}</Table></Worksheet>`).join(""), blob = new Blob(["\ufeff", `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${xmlSheets}</Workbook>`], { type: "application/vnd.ms-excel" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }

  dashboard = function () {
    pageTitle("Dashboard executivo", "Custos, saving, medições, rankings e eficiência operacional"); normalizeDatabaseText();
    $("#view").innerHTML = `<div class="panel dashboard-filters"><div class="form-grid"><div class="field"><label>De</label><input type="date" id="dFrom"></div><div class="field"><label>Até</label><input type="date" id="dTo"></div><div class="field"><label>Posto</label><select id="dStation"><option value="">Todos</option>${opts("postos", (x) => x.fantasia || x.razao)}</select></div><div class="field"><label>Filial</label><select id="dUnit"><option value="">Todas</option>${opts("unidades", (x) => x.nome)}</select></div><div class="field"><label>Produto</label><select id="dProduct"><option value="">Todos</option>${opts("produtos", (x) => x.curta)}</select></div><div class="field"><label>&nbsp;</label><button class="btn primary" id="applyDashboard">Aplicar filtros</button></div></div><div class="dashboard-tabs"><button class="btn primary dashTab" data-tab="executive">Resumo executivo</button><button class="btn secondary dashTab" data-tab="rankings">Rankings</button><button class="btn secondary dashTab" data-tab="trends">Tendências</button><button class="btn secondary" id="exportDashboard">Exportar Excel</button></div></div><div id="dashboardContent"></div>`;
    let active = "executive";
    const draw = () => { const rows = filterFuelings(), volume = rows.reduce((s, a) => s + Number(a.qt || 0), 0), total = rows.reduce((s, a) => s + Number(a.total || 0), 0), ticket = rows.reduce((s, a) => s + Number(agreementForFueling(a)?.ticketlog || a.preco || 0) * Number(a.qt || 0), 0), saving = ticket - total, measured = rows.filter((a) => a.medicaoId), pending = rows.filter((a) => !a.medicaoId), medIds = new Set(measured.map((a) => a.medicaoId)), meds = db.medicoes.filter((m) => medIds.has(m.id)), nfVolume = meds.reduce((s, m) => s + Number(m.qtNf || 0), 0), paymentDays = meds.map((m) => m.emissao && m.vencimento ? Math.round((new Date(m.vencimento) - new Date(m.emissao)) / 86400000) : null).filter((x) => x !== null && x >= 0), avgPayment = paymentDays.length ? paymentDays.reduce((s, x) => s + x, 0) / paymentDays.length : 0, days = new Set(rows.map((a) => a.data)).size || 1, stations = groupRows(rows, (a) => a.postoId, (a) => postoNome(a.postoId)), plates = groupRows(rows, (a) => a.placa, (a) => a.placa), drivers = groupRows(rows, (a) => a.motorista || "Sem motorista", (a) => a.motorista || "Sem motorista"), costCenters = groupRows(rows, (a) => a.centroCusto || "Sem centro de custo", (a) => a.centroCusto || "Sem centro de custo"), byDay = groupRows(rows, (a) => a.data, (a) => a.data).sort((a, b) => a.label.localeCompare(b.label)), alerts = generateAlerts(rows).filter((a) => !alertReview(a.id));
      const cards = [["Volume abastecido", `${num(volume)} L`, `${rows.length} abastecimentos`], ["Custo DirectFuel", money(total), "Valor total no período"], ["Custo Ticketlog", money(ticket), "Volume × preço Ticketlog"], ["Saving", money(saving), `${ticket ? num(saving / ticket * 100) : 0}% vs. Ticketlog`], ["Valores medidos", money(measured.reduce((s, a) => s + Number(a.total || 0), 0)), `${measured.length} abastecimentos`], ["Valores pendentes", money(pending.reduce((s, a) => s + Number(a.total || 0), 0)), `${pending.length} abastecimentos`], ["Volume das NFs", `${num(nfVolume)} L`, `${meds.length} medições`], ["Prazo médio de pagamento", `${num(avgPayment)} dias`, `${paymentDays.length} NFs com datas`], ["Média diária", `${num(volume / days)} L/dia`, `${days} dias com movimento`], ["Postos analisados", String(stations.length), `${costCenters.length} centros de custo`], ["Ticket médio", money(rows.length ? total / rows.length : 0), `${num(rows.length ? volume / rows.length : 0)} L por abastecimento`], ["Alertas para checagem", String(alerts.length), "Ocorrências não revisadas"]];
      const rankTable = (title, data) => `<div class="panel"><h2>${title}</h2><div class="table-wrap"><table><thead><tr><th>Posição</th><th>Descrição</th><th>Abastecimentos</th><th>Volume</th><th>Custo DirectFuel</th><th>Custo Ticketlog</th><th>Saving</th><th>Saving %</th></tr></thead><tbody>${data.slice(0, 15).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td>${r.count}</td><td>${num(r.volume)} L</td><td>${money(r.total)}</td><td>${money(r.ticket)}</td><td class="${r.saving >= 0 ? "price-good" : "price-bad"}">${money(r.saving)}</td><td>${num(r.savingPct)}%</td></tr>`).join("")}</tbody></table></div></div>`;
      if (active === "executive") $("#dashboardContent").innerHTML = `<div class="grid executive-cards">${cards.map(([label, value, detail]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${detail}</div></div>`).join("")}</div><div class="split">${rankTable("Saving por posto", [...stations].sort((a, b) => b.saving - a.saving))}${rankTable("Volume por posto", stations)}</div>`;
      if (active === "rankings") $("#dashboardContent").innerHTML = `${rankTable("Ranking por placa", plates)}${rankTable("Ranking por motorista", drivers)}${rankTable("Ranking por centro de custo", costCenters)}`;
      if (active === "trends") $("#dashboardContent").innerHTML = `${rankTable("Evolução diária", byDay)}<div class="grid cards"><div class="card"><div class="label">Maior volume por placa</div><div class="value">${esc(plates[0]?.label || "-")}</div><div class="delta">${num(plates[0]?.volume || 0)} L</div></div><div class="card"><div class="label">Maior volume por motorista</div><div class="value">${esc(drivers[0]?.label || "-")}</div><div class="delta">${num(drivers[0]?.volume || 0)} L</div></div><div class="card"><div class="label">Maior saving por posto</div><div class="value">${esc([...stations].sort((a, b) => b.saving - a.saving)[0]?.label || "-")}</div><div class="delta">${money([...stations].sort((a, b) => b.saving - a.saving)[0]?.saving || 0)}</div></div><div class="card"><div class="label">Abastecimentos por dia</div><div class="value">${num(rows.length / days)}</div><div class="delta">Média no período</div></div></div>`;
      return { cards, stations, plates, drivers, costCenters, byDay };
    };
    let data = draw(); $("#applyDashboard").onclick = () => { data = draw(); }; $$(".dashTab").forEach((button) => button.onclick = () => { active = button.dataset.tab; $$(".dashTab").forEach((item) => item.className = `btn ${item === button ? "primary" : "secondary"} dashTab`); data = draw(); });
    $("#exportDashboard").onclick = () => { data = draw(); const rankCols = [["Descrição", "label"], ["Abastecimentos", "count"], ["Volume", "volume"], ["Custo DirectFuel", "total"], ["Custo Ticketlog", "ticket"], ["Saving", "saving"], ["Saving %", "savingPct"]]; workbook(`dashboard_directfuel_${new Date().toISOString().slice(0, 10)}.xls`, [{ name: "Resumo executivo", columns: [["Indicador", "indicador"], ["Valor", "valor"], ["Detalhe", "detalhe"]], rows: data.cards.map(([indicador, valor, detalhe]) => ({ indicador, valor, detalhe })) }, { name: "Postos", columns: rankCols, rows: data.stations }, { name: "Placas", columns: rankCols, rows: data.plates }, { name: "Motoristas", columns: rankCols, rows: data.drivers }, { name: "Centros de custo", columns: rankCols, rows: data.costCenters }, { name: "Evolução diária", columns: rankCols, rows: data.byDay }]); };
  };

  function alertId(type, key) { let hash = 0, text = `${type}|${key}`; for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0; return `ALT-${Math.abs(hash)}`; }
  function alertReview(id) { return (db.alertReviews || []).find((review) => review.id === id)?.status === "Revisado"; }
  function generateAlerts(source = db.abastecimentos) {
    const alerts = [], push = (type, severity, key, date, stationId, detail) => alerts.push({ id: alertId(type, key), type, severity, date, stationId, detail });
    const duplicate = new Map(), plates = new Map(), drivers = new Map();
    source.forEach((a) => { const dKey = `${a.data}|${a.hora}|${a.postoId}|${a.placa}|${a.qt}|${a.preco}`, pKey = `${a.data}|${a.placa}`, mKey = `${a.data}|${a.motorista || "Sem motorista"}`; duplicate.set(dKey, [...(duplicate.get(dKey) || []), a]); plates.set(pKey, [...(plates.get(pKey) || []), a]); drivers.set(mKey, [...(drivers.get(mKey) || []), a]); const fleet = db.frota.find((f) => f.placa === a.placa), priceCheck = agreementCheck(a); if (!dateIso(a.data)) push("Data inválida", "Alta", a.id, a.data, a.postoId, `Abastecimento ${a.id} com data inválida.`); if (fleet?.capTanque && a.qt > fleet.capTanque) push("Capacidade do tanque excedida", "Alta", a.id, a.data, a.postoId, `${a.placa}: ${num(a.qt)} L para tanque de ${num(fleet.capTanque)} L.`); if (priceCheck.unresolved) push(priceCheck.code, "Alta", a.id, a.data, a.postoId, priceCheck.agreedPrice === null ? `${a.placa}: nenhum acordo válido na data.` : `${a.placa}: ${money(a.preco)}/L, acordo ${money(priceCheck.agreedPrice)}/L, impacto ${money(priceCheck.differenceTotal)}.`); if (a.odometro && Number(a.odometro) % 1000 === 0) push("Hodômetro arredondado", "Baixa", a.id, a.data, a.postoId, `${a.placa}: hodômetro ${num(a.odometro)}.`); });
    duplicate.forEach((items, key) => { if (items.length > 1) push("Possível abastecimento duplicado", "Alta", key, items[0].data, items[0].postoId, `${items.length} registros idênticos para a placa ${items[0].placa}.`); });
    plates.forEach((items, key) => { if (items.length > 1) push("Placa abastecida mais de uma vez no dia", "Média", key, items[0].data, items[0].postoId, `${items[0].placa}: ${items.length} abastecimentos e ${num(items.reduce((s, a) => s + Number(a.qt || 0), 0))} L no dia.`); const timed = items.filter((a) => /^\d{2}:\d{2}/.test(a.hora || "")).sort((a, b) => a.hora.localeCompare(b.hora)); for (let i = 1; i < timed.length; i++) { const minutes = (Number(timed[i].hora.slice(0, 2)) * 60 + Number(timed[i].hora.slice(3, 5))) - (Number(timed[i - 1].hora.slice(0, 2)) * 60 + Number(timed[i - 1].hora.slice(3, 5))); if (minutes >= 0 && minutes < 120) push("Intervalo curto entre abastecimentos", "Alta", `${key}|${i}`, items[0].data, items[0].postoId, `${items[0].placa}: intervalo de ${minutes} minutos.`); } });
    drivers.forEach((items, key) => { if (items.length > 1 && items[0].motorista) push("Motorista abasteceu mais de uma vez no dia", "Média", key, items[0].data, items[0].postoId, `${items[0].motorista}: ${items.length} abastecimentos no dia.`); });
    const byPlate = new Map(); source.filter((a) => a.odometro).forEach((a) => byPlate.set(a.placa, [...(byPlate.get(a.placa) || []), a])); byPlate.forEach((items, plate) => { items.sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`)); for (let i = 1; i < items.length; i++) if (Number(items[i].odometro) <= Number(items[i - 1].odometro)) push("Hodômetro repetido ou decrescente", "Alta", `${plate}|${items[i].id}`, items[i].data, items[i].postoId, `${plate}: ${num(items[i - 1].odometro)} para ${num(items[i].odometro)}.`); });
    const order = { Alta: 0, Média: 1, Baixa: 2 };
    return alerts.sort((a, b) => (order[a.severity] - order[b.severity]) || String(b.date).localeCompare(String(a.date)));
  }
  auditPage = function () {
    pageTitle("Auditoria e alertas", "Ocorrências que merecem checagem e histórico de alterações"); db.alertReviews = db.alertReviews || []; const alerts = generateAlerts();
    $("#view").innerHTML = `<div class="grid cards"><div class="card"><div class="label">Alertas altos</div><div class="value bad-text">${alerts.filter((a) => a.severity === "Alta" && !alertReview(a.id)).length}</div></div><div class="card"><div class="label">Alertas médios</div><div class="value">${alerts.filter((a) => a.severity === "Média" && !alertReview(a.id)).length}</div></div><div class="card"><div class="label">Alertas revisados</div><div class="value">${alerts.filter((a) => alertReview(a.id)).length}</div></div><div class="card"><div class="label">Total identificado</div><div class="value">${alerts.length}</div></div></div><div class="panel"><div class="toolbar"><select id="alertSeverity" class="btn secondary"><option value="">Todas as criticidades</option><option>Alta</option><option>Média</option><option>Baixa</option></select><select id="alertType" class="btn secondary"><option value="">Todos os tipos</option>${[...new Set(alerts.map((a) => a.type))].map((type) => `<option>${esc(type)}</option>`).join("")}</select><select id="alertStatus" class="btn secondary"><option value="">Todos os status</option><option>Pendente</option><option>Revisado</option></select><button class="btn secondary" id="exportAlerts">Exportar Excel</button></div><div id="alertTable"></div></div><div class="panel"><h2>Histórico de alterações</h2><div class="table-wrap"><table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Registro</th><th>Detalhe</th></tr></thead><tbody>${(db.audit || []).map((log) => `<tr><td>${new Date(log.data).toLocaleString("pt-BR")}</td><td>${esc(log.usuario)}</td><td>${esc(log.acao)}</td><td>${esc(log.entidade)}</td><td>${esc(log.registro || "-")}</td><td>${esc(log.detalhe || "-")}</td></tr>`).join("") || '<tr><td colspan="6">Sem alterações registradas.</td></tr>'}</tbody></table></div></div>`;
    const filtered = () => alerts.filter((a) => (!val("alertSeverity") || a.severity === val("alertSeverity")) && (!val("alertType") || a.type === val("alertType")) && (!val("alertStatus") || (alertReview(a.id) ? "Revisado" : "Pendente") === val("alertStatus")));
    const draw = () => { $("#alertTable").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Criticidade</th><th>Data</th><th>Tipo</th><th>Posto</th><th>Detalhe</th><th>Status</th><th>Ação</th></tr></thead><tbody>${filtered().map((a) => `<tr><td>${badge(a.severity)}</td><td>${dateBR(a.date)}</td><td>${esc(a.type)}</td><td>${esc(postoNome(a.stationId))}</td><td>${esc(a.detail)}</td><td>${badge(alertReview(a.id) ? "Revisado" : "Pendente")}</td><td>${alertReview(a.id) ? "-" : `<button class="btn small secondary reviewAlert" data-id="${a.id}">Marcar revisado</button>`}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Nenhum alerta para o filtro.</td></tr>'}</tbody></table></div>`; $$(".reviewAlert").forEach((button) => button.onclick = () => { db.alertReviews = (db.alertReviews || []).filter((r) => r.id !== button.dataset.id); db.alertReviews.push({ id: button.dataset.id, status: "Revisado", usuario: currentUser(), data: new Date().toISOString() }); audit("Revisão", "Alerta", button.dataset.id); save("Alerta marcado como revisado"); auditPage(); }); };
    draw(); ["alertSeverity", "alertType", "alertStatus"].forEach((id) => $("#" + id).onchange = draw); $("#exportAlerts").onclick = () => workbook(`alertas_directfuel_${new Date().toISOString().slice(0, 10)}.xls`, [{ name: "Alertas", columns: [["Criticidade", "severity"], ["Data", "date"], ["Tipo", "type"], ["Posto", "posto"], ["Detalhe", "detail"], ["Status", "status"]], rows: filtered().map((a) => ({ ...a, posto: postoNome(a.stationId), status: alertReview(a.id) ? "Revisado" : "Pendente" })) }]);
  };

  const reportsBeforeEnterprise = relatorios;
  relatorios = function () {
    reportsBeforeEnterprise(); const panels = [...document.querySelectorAll("#view > .panel")]; if (panels.length < 5) return;
    const filterPanel = panels[0], exportPanel = panels[1], measurementPanel = panels[2], pendingPanel = panels[3], pricePanel = panels[4], stationPanel = $("#stationReportPanel"), ticketPanel=$("#ticketStationReportPanel");
    exportPanel.insertAdjacentHTML("afterbegin", `<div class="report-visibility"><label>Relatório exibido na tela</label><select id="visibleReport" class="btn secondary"><option value="measurements">Medições realizadas</option><option value="pending">Medições pendentes</option><option value="prices">Preços e calculadora</option><option value="stations">Posto DirectFuel — cadastro</option><option value="ticketStations">Posto Ticketlog — cadastro</option></select></div>`);
    const show = () => { const selected = val("visibleReport"); measurementPanel.style.display = selected === "measurements" ? "block" : "none"; pendingPanel.style.display = selected === "pending" ? "block" : "none"; pricePanel.style.display = selected === "prices" ? "block" : "none"; if(ticketPanel)ticketPanel.style.display=selected === "ticketStations" ? "block" : "none"; if(selected === "ticketStations")window.directFuelLoadTicketReport?.(); if(stationPanel)stationPanel.style.display=selected === "stations" ? "block" : "none"; filterPanel.style.display = ["prices","stations","ticketStations"].includes(selected) ? "none" : "block"; };
    const selector=$("#visibleReport");selector.style.display='none';
    const reportPages={report_prices:['prices','Preço DirectFuel × Paramétrica × Ticketlog — memória completa'],report_directfuel:['stations','Posto DirectFuel — cadastro'],report_ticketlog:['ticketStations','Posto Ticketlog — cadastro'],report_measurements:['measurements','Medições realizadas'],report_pending:['pending','Medições pendentes']};
    const selectedPage=reportPages[route]||reportPages.report_prices;
    selector.value=selectedPage[0];selector.onchange=show;show();
    $('.report-visibility').style.display='none';
    pageTitle(selectedPage[1],'Relatórios · Filtros e exportação exclusivos deste relatório');

  };

  const renderBeforeEnterprise = render;
  render = function () { normalizeDatabaseText(); if (route === "medicoes_realizadas") { renderNav(); completedMeasurementsPage(); return; } renderBeforeEnterprise(); };
  render();
})();
