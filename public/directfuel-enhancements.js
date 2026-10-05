(() => {
  const MENU_OPTIONS = [
    ["dashboard", "Dashboard"],
    ["analysis_geo", "Análise geográfica"],
    ["ticketlog_import", "Carga Ticketlog"],
    ["abastecimentos", "Abastecimentos"],
    ["medicoes", "Medições"],
    ["acordos", "Acordos & Calculadora"],
    ["postos", "Postos"],
    ["rede", "Rede de Atendimento"],
    ["bases", "Bases Supridoras"],
    ["distribuidoras", "Distribuidoras"],
    ["produtos", "Produtos"],
    ["unidades", "Unidades Vixpar"],
    ["frota", "Frota"],
    ["relatorios", "Relatórios"],
    ["documentos", "Documentos"],
    ["users", "Usuários"],
    ["config", "Configurações"],
    ["audit", "Auditoria"],
  ];

  const PROFILE_PRESETS = {
    Master: ["*"],
    Administrador: ["dashboard", "analysis_geo", "ticketlog_import", "abastecimentos", "medicoes", "acordos", "postos", "rede", "bases", "distribuidoras", "produtos", "unidades", "frota", "relatorios", "documentos", "audit"],
    Gestor: ["dashboard", "analysis_geo", "ticketlog_import", "abastecimentos", "medicoes", "acordos", "postos", "rede", "bases", "produtos", "unidades", "frota", "relatorios", "documentos"],
    Operador: ["dashboard", "abastecimentos", "medicoes", "documentos"],
    Consulta: ["dashboard", "analysis_geo", "relatorios", "documentos"],
  };

  const ACTIONS = [
    ["visualizar", "Visualizar"], ["incluir", "Incluir"], ["editar", "Editar"],
    ["excluir", "Excluir"], ["aprovar", "Aprovar"], ["exportar", "Exportar"],
  ];
  const OWNER_ONLY_MENUS = new Set(["users", "config"]);
  const actionToken = (menu, action) => `${menu}:${action}`;
  function presetActions(profile) {
    if (profile === "Master") return ["*"];
    const menus = PROFILE_PRESETS[profile] || [];
    const tokens = [];
    menus.forEach((menu) => {
      tokens.push(actionToken(menu, "visualizar"), actionToken(menu, "exportar"));
      if (profile === "Administrador" && !["dashboard", "relatorios", "audit"].includes(menu)) tokens.push(actionToken(menu, "incluir"), actionToken(menu, "editar"), actionToken(menu, "excluir"));
      if (profile === "Administrador" && menu === "medicoes") tokens.push(actionToken(menu, "aprovar"));
      if (profile === "Gestor" && ["analysis_geo", "ticketlog_import", "abastecimentos", "medicoes", "acordos", "postos", "rede", "bases", "produtos", "unidades", "frota", "documentos"].includes(menu)) tokens.push(actionToken(menu, "incluir"), actionToken(menu, "editar"));
      if (profile === "Gestor" && menu === "medicoes") tokens.push(actionToken(menu, "aprovar"));
      if (profile === "Operador" && ["abastecimentos", "medicoes", "documentos"].includes(menu)) tokens.push(actionToken(menu, "incluir"), actionToken(menu, "editar"));
    });
    return [...new Set(tokens)];
  }

  const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const asNumber = (value) => {
    const raw = String(value ?? "0").trim();
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    return Number(normalized) || 0;
  };
  const asBool = (value) => !/^(0|nao|não|false|inativo)$/i.test(String(value ?? "sim").trim());
  const asPaymentCondition = (value) => {
    const normalized = normalize(value || "Boleto");
    if (normalized === "boleto") return "Boleto";
    if (normalized === "deposito") return "Depósito";
    throw new Error("Condição de pagamento inválida. Use Boleto ou Depósito");
  };
  const asDate = (value) => {
    const raw = String(value ?? "").trim(); if (!raw) return "";
    let match = raw.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/); if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    match = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/); if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    return raw;
  };
  const field = (row, ...names) => {
    for (const name of names) {
      const value = row[normalize(name)];
      if (value !== undefined && value !== "") return String(value).trim();
    }
    return "";
  };
  const nextAgreementNumber = () => {
    const year = new Date().getFullYear();
    const used = new Set((db.acordos || []).map((item) => String(item.numero || "")));
    let sequence = Math.max(0, ...[...used].map((number) => Number(number.match(new RegExp(`^AC-${year}-(\\d+)$`, "i"))?.[1] || 0)));
    let number; do number = `AC-${year}-${String(++sequence).padStart(4, "0")}`; while (used.has(number));
    return number;
  };

  function findRef(arr, value, keys) {
    const wanted = normalize(value);
    if (!wanted) return "";
    const record = (db[arr] || []).find((item) => keys.some((key) => normalize(item[key]) === wanted));
    return record?.id || "";
  }

  function requireRef(arr, value, keys, label) {
    const id = findRef(arr, value, keys);
    if (!id) throw new Error(`${label} não encontrado: ${value || "(vazio)"}`);
    return id;
  }

  const CSV_SCHEMAS = {
    distribuidores: {
      title: "Distribuidoras",
      headers: ["id", "nome", "codigo", "ativo", "observacao"],
      example: ["", "Vibra", "VIBRA", "Sim", ""],
      natural: (x) => normalize(x.codigo || x.nome),
      convert: (r) => ({ id: field(r, "id") || uid("D"), nome: field(r, "nome"), codigo: field(r, "codigo"), ativo: asBool(field(r, "ativo")), obs: field(r, "observacao", "obs") }),
    },
    bases: {
      title: "Bases Supridoras",
      headers: ["id", "codigo", "localidade", "uf", "distribuidora", "ativo"],
      example: ["", "BADUC", "Duque de Caxias", "RJ", "Vibra", "Sim"],
      natural: (x) => normalize(`${x.codigo}|${x.distribuidorId}`),
      convert: (r) => ({ id: field(r, "id") || uid("B"), codigo: field(r, "codigo"), localidade: field(r, "localidade"), uf: field(r, "uf").toUpperCase(), distribuidorId: requireRef("distribuidores", field(r, "distribuidora", "distribuidor"), ["id", "nome", "codigo"], "Distribuidora"), ativo: asBool(field(r, "ativo")) }),
    },
    produtos: {
      title: "Produtos",
      headers: ["id", "descricao", "nome_curto", "familia", "unidade", "codigo_sap", "ativo"],
      example: ["", "Óleo Diesel S10 Comum", "Diesel S10 Comum", "Diesel", "L", "35012671", "Sim"],
      natural: (x) => normalize(x.sap || x.curta || x.descricao),
      convert: (r) => ({ id: field(r, "id") || uid("P"), descricao: field(r, "descricao"), curta: field(r, "nome_curto", "curta"), familia: field(r, "familia"), unidade: field(r, "unidade") || "L", sap: field(r, "codigo_sap", "sap"), ativo: asBool(field(r, "ativo")) }),
    },
    unidades: {
      title: "Unidades Vixpar",
      headers: ["id", "razao_social", "nome", "cnpj", "centro_sap", "municipio", "uf", "centro_custo", "ativo"],
      example: ["", "VIX Logística S.A.", "Canaã dos Carajás", "", "70730", "Canaã dos Carajás", "PA", "CC-CANAA", "Sim"],
      natural: (x) => normalize(x.centroSap || x.nome),
      convert: (r) => ({ id: field(r, "id") || uid("U"), razao: field(r, "razao_social", "razao"), nome: field(r, "nome"), cnpj: field(r, "cnpj"), centroSap: field(r, "centro_sap"), municipio: field(r, "municipio"), uf: field(r, "uf").toUpperCase(), centroCusto: field(r, "centro_custo"), ativo: asBool(field(r, "ativo")) }),
    },
    postos: {
      title: "Postos",
      headers: ["id", "razao_social", "nome_fantasia", "cnpj", "inscricao_estadual", "endereco", "bairro", "municipio", "uf", "cep", "bandeira", "codigo_sap", "base_supridora", "distancia_km", "status", "contato_comercial", "telefone_comercial", "email_comercial", "contato_financeiro", "telefone_financeiro", "email_financeiro"],
      example: ["", "Posto Exemplo Ltda", "Posto Exemplo", "12.345.678/0001-90", "", "Av. Principal, 1000", "Centro", "Canaã dos Carajás", "PA", "", "Branca", "FORN-001", "BADUC", "42", "Ativo", "Carlos Silva", "(94) 99999-1111", "comercial@exemplo.com", "Ana Souza", "(94) 99999-2222", "financeiro@exemplo.com"],
      natural: (x) => normalize(x.cnpj || x.sap || x.fantasia || x.razao),
      convert: (r) => {
        const base = field(r, "base_supridora", "base");
        return { id: field(r, "id") || uid("S"), codigo: field(r, "codigo", "id_posto") || nextPostCode(), razao: field(r, "razao_social", "razao"), fantasia: field(r, "nome_fantasia", "fantasia"), cnpj: field(r, "cnpj"), ie: field(r, "inscricao_estadual", "ie"), endereco: field(r, "endereco"), bairro: field(r, "bairro"), municipio: field(r, "municipio"), uf: field(r, "uf").toUpperCase(), cep: field(r, "cep"), bandeira: field(r, "bandeira"), sap: field(r, "codigo_sap", "sap"), baseId: base ? requireRef("bases", base, ["id", "codigo", "localidade"], "Base supridora") : "", distancia: asNumber(field(r, "distancia_km", "distancia")), status: field(r, "status") || "Ativo", contComercial: field(r, "contato_comercial"), telComercial: field(r, "telefone_comercial"), emailComercial: field(r, "email_comercial"), contFinanceiro: field(r, "contato_financeiro"), telFinanceiro: field(r, "telefone_financeiro"), emailFinanceiro: field(r, "email_financeiro") };
      },
    },
    frota: {
      title: "Frota",
      headers: ["id", "placa", "prefixo", "modelo", "fabricante", "filial", "centro_custo", "tipo", "capacidade_tanque_l", "produto", "ativo"],
      example: ["", "ABC1D23", "VIX-001", "Volvo FH 540", "Volvo", "Canaã dos Carajás", "CC-CANAA", "Cavalo mecânico", "600", "Diesel S10 Comum", "Sim"],
      natural: (x) => normalize(x.placa),
      convert: (r) => ({ id: field(r, "id") || uid("F"), placa: field(r, "placa").toUpperCase(), prefixo: field(r, "prefixo"), modelo: field(r, "modelo"), fabricante: field(r, "fabricante"), unidadeId: requireRef("unidades", field(r, "filial", "unidade"), ["id", "nome", "centroSap"], "Filial"), centroCusto: field(r, "centro_custo"), tipo: field(r, "tipo"), capTanque: asNumber(field(r, "capacidade_tanque_l", "capacidade_tanque")), produtoId: requireRef("produtos", field(r, "produto"), ["id", "curta", "descricao", "sap"], "Produto"), ativo: asBool(field(r, "ativo")) }),
    },
    rede: {
      title: "Rede de Atendimento",
      headers: ["id", "posto", "filial", "produto", "base_supridora", "ativo"],
      example: ["", "Posto Exemplo", "Canaã dos Carajás", "Diesel S10 Comum", "BADUC", "Sim"],
      natural: (x) => normalize(`${x.postoId}|${x.unidadeId}|${x.produtoId}`),
      convert: (r) => ({ id: field(r, "id") || uid("R"), postoId: requireRef("postos", field(r, "posto"), ["id", "fantasia", "razao", "cnpj", "sap"], "Posto"), unidadeId: requireRef("unidades", field(r, "filial", "unidade"), ["id", "nome", "centroSap"], "Filial"), produtoId: requireRef("produtos", field(r, "produto"), ["id", "curta", "descricao", "sap"], "Produto"), baseId: requireRef("bases", field(r, "base_supridora", "base"), ["id", "codigo", "localidade"], "Base supridora"), ativo: asBool(field(r, "ativo")) }),
    },
    acordos: {
      title: "Acordos",
      headers: ["posto", "filial", "produto", "base_supridora", "condicao_pagamento", "inicio", "fim", "preco_posto", "prv_vixpar", "ticketlog", "fob_vista", "frete_litro", "margem_posto_pct", "taxa_adm_pct", "taxa_financeira_pct", "ciclo_dias", "pagamento_dias", "volume_mes_l", "status", "responsavel", "observacao"],
      example: ["Posto Exemplo", "Canaã dos Carajás", "Diesel S10 Comum", "BADUC", "Boleto", "2026-09-01", "2026-12-31", "6,19", "5,98", "6,43", "5,45", "0,18", "8", "1", "1,36", "7", "15", "50000", "Vigente", "Wagner Nicolau", ""],
      natural: (x) => normalize(`${x.postoId}|${x.produtoId}|${x.inicio}`),
      convert: (r) => ({ id: uid("A"), postoId: requireRef("postos", field(r, "posto"), ["id", "fantasia", "razao", "cnpj", "sap"], "Posto"), unidadeId: requireRef("unidades", field(r, "filial", "unidade"), ["id", "nome", "centroSap"], "Filial"), produtoId: requireRef("produtos", field(r, "produto"), ["id", "curta", "descricao", "sap"], "Produto"), baseId: requireRef("bases", field(r, "base_supridora", "base"), ["id", "codigo", "localidade"], "Base supridora"), condicaoPagamento: asPaymentCondition(field(r, "condicao_pagamento", "forma_pagamento")), inicio: asDate(field(r, "inicio", "data_inicio")), fim: asDate(field(r, "fim", "data_fim")), preco: asNumber(field(r, "preco_posto", "preco")), prv: asNumber(field(r, "prv_vixpar", "prv")), ticketlog: asNumber(field(r, "ticketlog")), fob: asNumber(field(r, "fob_vista", "fob")), frete: asNumber(field(r, "frete_litro", "frete")), margem: asNumber(field(r, "margem_posto_pct", "margem")), taxaAdm: asNumber(field(r, "taxa_adm_pct", "taxa_adm")), taxaFin: asNumber(field(r, "taxa_financeira_pct", "taxa_financeira")), ciclo: asNumber(field(r, "ciclo_dias", "ciclo")), pagamento: asNumber(field(r, "pagamento_dias", "pagamento")), volumeMes: asNumber(field(r, "volume_mes_l", "volume_mes")), status: field(r, "status") || "Vigente", responsavel: field(r, "responsavel"), obs: field(r, "observacao", "obs") }),
    },
    users: {
      title: "Usuários",
      headers: ["id", "nome", "email_chatgpt", "perfil", "unidades", "menus", "acoes", "ativo"],
      example: ["", "Nome do usuário", "usuario@gmail.com", "Operador", "Canaã dos Carajás", "dashboard|abastecimentos|medicoes|documentos", "abastecimentos:visualizar|abastecimentos:incluir|medicoes:visualizar|documentos:visualizar", "Sim"],
      natural: (x) => normalize(x.email),
      convert: (r) => {
        const perfil = field(r, "perfil") || "Consulta";
        const raw = field(r, "menus", "permissoes"), rawActions = field(r, "acoes");
        return { id: field(r, "id") || uid("USR"), nome: field(r, "nome"), email: field(r, "email_chatgpt", "email").toLowerCase(), perfil, unidades: field(r, "unidades") || "Todas", permissoes: raw ? raw.split("|").map((item) => item.trim() === "*" ? "*" : normalize(item)).filter(Boolean) : [...(PROFILE_PRESETS[perfil] || [])], acoes: rawActions ? rawActions.split("|").map((item) => item.trim().toLowerCase()).filter(Boolean) : presetActions(perfil), ativo: asBool(field(r, "ativo")) };
      },
    },
    abastecimentos: {
      title: "Abastecimentos",
      filename: "modelo_importacao_abastecimentos_autorizacoes.csv",
      headers: ["Data", "ID Posto", "Posto", "Veículo", "Motorista", "Empresa", "Produto", "Quantidade", "Valor Unitário", "Valor Total", "Modalidade Pagamento", "Número Acordo", "Preço Acordo"],
      example: ["09/09/2026 01:49", "PST-0007", "POSTO ROMA - RIO CASCA MG", "M.BENZ AXOR 2545 LS 6X2 2P (DIESEL) - [ABC1D23]", "NOME DO MOTORISTA", "AUTOPORT TRANSPORTES E LOGISTICA", "Diesel S10", "300", "6,49", "1.947,00", "Acordo", "AC-2026-0001", "6,49"],
      downloadOnly: true,
    },
  };

  function csvCell(value) {
    const text = String(value ?? "");
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadText(filename, content, type = "text/csv;charset=utf-8") {
    const blob = new Blob(["\ufeff", content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadModel(arr) {
    const schema = CSV_SCHEMAS[arr];
    const csv = [schema.headers, schema.example].map((row) => row.map(csvCell).join(";")).join("\r\n");
    downloadText(schema.filename || `modelo_${arr}_directfuel.csv`, csv);
    toast("Modelo CSV baixado");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ";") { row.push(cell.trim()); cell = ""; }
      else if (char === "\n") { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
      else if (char !== "\r") cell += char;
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) throw new Error("O arquivo deve conter cabeçalho e ao menos uma linha de dados.");
    const headers = rows.shift().map(normalize);
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function mergeRecord(arr, record, schema) {
    const providedId = record.id && (db[arr] || []).findIndex((item) => item.id === record.id);
    const natural = schema.natural(record);
    const naturalIndex = (db[arr] || []).findIndex((item) => schema.natural(item) === natural);
    const index = providedId >= 0 ? providedId : naturalIndex;
    if (index >= 0) {
      record.id = db[arr][index].id;
      db[arr][index] = { ...db[arr][index], ...record };
      return "updated";
    }
    db[arr].push(record);
    return "created";
  }

  async function importCadastro(arr, file) {
    const schema = CSV_SCHEMAS[arr];
    const rows = parseCsv(await file.text());
    let created = 0, updated = 0;
    const errors = [];
    rows.forEach((row, index) => {
      try {
        const record = schema.convert(row);
        if (arr === "acordos") {
          const currentAgreement = db.acordos.find((item) => schema.natural(item) === schema.natural(record));
          record.numero = currentAgreement?.numero || nextAgreementNumber();
        }
        const required = arr === "users" ? record.email : (record.nome || record.codigo || record.placa || record.numero || record.razao || record.postoId);
        if (!required) throw new Error("Campo principal não preenchido");
        if (arr === "acordos") {
          const current = db.acordos.find((item) => schema.natural(item) === schema.natural(record));
          const conflict = window.DirectFuelImportRules.agreementDateConflict(record, db.acordos, current?.id);
          if (conflict) throw new Error(`Já existe acordo válido/vigente no período informado para este posto e produto (${conflict.numero || conflict.id}); encerre o acordo existente ou ajuste as datas antes de importar`);
        }
        mergeRecord(arr, record, schema) === "created" ? created++ : updated++;
      } catch (error) {
        errors.push(`Linha ${index + 2}: ${error.message}`);
      }
    });
    if (created || updated) {
      audit("Importação CSV", schema.title, `${created} incluídos; ${updated} atualizados`);
      save(`Importação concluída: ${created} incluídos e ${updated} atualizados`);
      render();
    }
    if (errors.length) alert(`Importação concluída com ${errors.length} erro(s):\n\n${errors.slice(0, 12).join("\n")}${errors.length > 12 ? "\n..." : ""}`);
  }

  function addBulkControls(arr, toolbar) {
    const schema = CSV_SCHEMAS[arr];
    if (!schema || toolbar.querySelector(`[data-model="${arr}"]`)) return;
    const model = document.createElement("button");
    model.type = "button";
    model.className = "btn secondary";
    model.dataset.model = arr;
    model.textContent = "Baixar modelo CSV";
    model.onclick = () => downloadModel(arr);
    toolbar.appendChild(model);
    if (!schema.downloadOnly) {
      const label = document.createElement("label");
      label.className = "btn secondary";
      label.innerHTML = `Importar CSV<input type="file" accept=".csv,text/csv" hidden>`;
      label.querySelector("input").onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try { await importCadastro(arr, file); }
        catch (error) { alert("Não foi possível importar o CSV: " + error.message); }
        event.target.value = "";
      };
      toolbar.appendChild(label);
    }
  }

  window.directFuelAddBulkControls = addBulkControls;

  const originalGenericPage = genericPage;
  genericPage = function (cfg) {
    originalGenericPage(cfg);
    const toolbar = document.querySelector("#view .toolbar");
    if (toolbar) addBulkControls(cfg.arr, toolbar);
  };

  const originalAcordos = acordos;
  acordos = function () {
    originalAcordos();
    const toolbar = document.querySelector("#view .toolbar");
    if (toolbar) addBulkControls("acordos", toolbar);
  };

  const originalAbastecimentos = abastecimentos;
  abastecimentos = function () {
    originalAbastecimentos();
    const toolbar = document.querySelector("#view .toolbar");
    if (toolbar) addBulkControls("abastecimentos", toolbar);
  };

  const adminGroup = navGroups.find(([label]) => label === "ADMINISTRAÇÃO");
  if (adminGroup && !adminGroup[1].some(([key]) => key === "users")) {
    adminGroup[1].unshift(["users", "Usuários", "usuarios"]);
  }

  function currentPermissions() {
    if (window.DIRECTFUEL_IS_OWNER) return ["*"];
    if (Array.isArray(window.DIRECTFUEL_PERMISSIONS)) return window.DIRECTFUEL_PERMISSIONS;
    const email = (window.DIRECTFUEL_CURRENT_EMAIL || "").toLowerCase();
    const record = (db.users || []).find((item) => (item.email || "").toLowerCase() === email && item.ativo !== false);
    return record?.permissoes || PROFILE_PRESETS[record?.perfil] || ["*"];
  }

  function canAccess(key) {
    if (OWNER_ONLY_MENUS.has(key) && !window.DIRECTFUEL_IS_OWNER) return false;
    const permissions = currentPermissions();
    return permissions.includes("*") || permissions.includes(key);
  }

  renderNav = function () {
    let html = "";
    for (const [group, items] of navGroups) {
      const visible = items.filter((item) => (!item[2] || db.config.modules[item[2]] !== false) && canAccess(item[0]));
      if (!visible.length) continue;
      html += `<div class="nav-group"><div class="nav-group-title">${group}</div>${visible.map((item) => `<button class="nav-item ${route === item[0] ? "active" : ""}" data-route="${item[0]}">${item[1]}</button>`).join("")}</div>`;
    }
    $("#nav").innerHTML = html;
    $$(".nav-item").forEach((button) => button.onclick = () => { route = button.dataset.route; render(); });
  };

  const originalRender = render;
  render = function () {
    if (!canAccess(route)) {
      const fallback = MENU_OPTIONS.find(([key]) => canAccess(key));
      route = fallback?.[0] || "dashboard";
    }
    if (route === "users") {
      renderNav();
      usersPage();
      return;
    }
    originalRender();
  };

  function permissionsFor(user) {
    if (Array.isArray(user?.permissoes) && user.permissoes.length) return user.permissoes;
    return [...(PROFILE_PRESETS[user?.perfil] || [])];
  }

  function actionsFor(user) {
    if ((user?.email || "").toLowerCase() === "wnt.consult@gmail.com") return ["*"];
    if (Array.isArray(user?.acoes) && user.acoes.length) return user.acoes;
    return presetActions(user?.perfil || "Consulta");
  }

  function usersPage() {
    pageTitle("Usuários", "Perfis e permissões de acesso ao DirectFuel");
    $("#view").innerHTML = `<div class="panel">
      <div class="toolbar"><button class="btn primary" id="newUser">+ Novo usuário</button></div>
      <p class="note">Cadastre exatamente o e-mail usado pela pessoa no ChatGPT. As permissões definem quais menus ficarão disponíveis.</p>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Nome</th><th>E-mail ChatGPT</th><th>Perfil</th><th>Unidades</th><th>Menus liberados</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${(db.users || []).map((user) => { const owner = (user.email || "").toLowerCase() === "wnt.consult@gmail.com"; return `<tr><td>${user.nome || "-"}</td><td>${user.email || "-"}</td><td>${owner ? "Master · Proprietário" : user.perfil || "-"}</td><td>${user.unidades || "Todas"}</td><td>${owner ? "Acesso total" : `${permissionsFor(user).length} menus · ${actionsFor(user).length} ações`}</td><td>${badge(user.ativo !== false ? "Ativo" : "Inativo")}</td><td>${owner ? '<span class="muted">Protegido</span>' : `<button class="btn small secondary editUser" data-id="${user.id}">Editar</button> <button class="btn small danger delUser" data-id="${user.id}">Excluir</button>`}</td></tr>`; }).join("") || '<tr><td colspan="7" class="muted">Nenhum usuário cadastrado.</td></tr>'}</tbody></table></div>
    </div>`;
    const toolbar = document.querySelector("#view .toolbar");
    addBulkControls("users", toolbar);
    $("#newUser").onclick = () => userForm();
    $$(".editUser").forEach((button) => button.onclick = () => userForm((db.users || []).find((user) => user.id === button.dataset.id)));
    $$(".delUser").forEach((button) => button.onclick = () => {
      const user = (db.users || []).find((item) => item.id === button.dataset.id);
      if (!user) return;
      if ((user.email || "").toLowerCase() === "wnt.consult@gmail.com") return toast("O administrador principal não pode ser excluído");
      if (confirm(`Excluir o usuário ${user.nome || user.email}?`)) {
        db.users = db.users.filter((item) => item.id !== user.id);
        audit("Exclusão", "Usuário", user.email);
        save("Usuário excluído");
        render();
      }
    });
  }

  function userForm(user = null) {
    const selected = permissionsFor(user || { perfil: "Consulta" });
    const selectedActions = actionsFor(user || { perfil: "Consulta" });
    if ((user?.email || "").toLowerCase() === "wnt.consult@gmail.com") return toast("O usuário proprietário é protegido e possui acesso total");
    modal(user ? "Editar usuário" : "Novo usuário", `<div class="form-grid two">
      <div class="field"><label>Nome</label><input id="uNome" value="${user?.nome || ""}"></div>
      <div class="field"><label>E-mail usado no ChatGPT</label><input id="uEmail" type="email" value="${user?.email || ""}" placeholder="usuario@gmail.com"></div>
      <div class="field"><label>Perfil</label><select id="uPerfil">${Object.keys(PROFILE_PRESETS).filter((profile) => profile !== "Master").map((profile) => `<option ${user?.perfil === profile || (!user && profile === "Consulta") ? "selected" : ""}>${profile}</option>`).join("")}</select></div>
      <div class="field"><label>Unidades</label><input id="uUnidades" value="${user?.unidades || "Todas"}" placeholder="Todas ou nomes separados por vírgula"></div>
      <div class="field"><label>Status</label><select id="uAtivo"><option value="1" ${user?.ativo !== false ? "selected" : ""}>Ativo</option><option value="0" ${user?.ativo === false ? "selected" : ""}>Inativo</option></select></div>
    </div>
    <div class="section-title">Permissões por menu e ação</div>
    <p class="note">Visualizar libera a aba. As demais ações são verificadas também no servidor. Usuários e Configurações são exclusivos do proprietário.</p>
    <div class="permission-matrix"><table><thead><tr><th>Menu</th>${ACTIONS.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${MENU_OPTIONS.filter(([key]) => !OWNER_ONLY_MENUS.has(key)).map(([key, label]) => `<tr><td><strong>${label}</strong></td>${ACTIONS.map(([action]) => `<td><input type="checkbox" class="uAction" data-menu="${key}" data-action="${action}" ${selectedActions.includes("*") || selectedActions.includes(actionToken(key, action)) || action === "visualizar" && (selected.includes("*") || selected.includes(key)) ? "checked" : ""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="import-help">O perfil aplica uma sugestão inicial, que pode ser ajustada ação por ação.</p>`, (back) => {
      const nome = $("#uNome").value.trim();
      const email = $("#uEmail").value.trim().toLowerCase();
      if (!nome || !email || !email.includes("@")) return toast("Informe nome e e-mail válido");
      const duplicate = (db.users || []).find((item) => item.id !== user?.id && (item.email || "").toLowerCase() === email);
      if (duplicate) return toast("Este e-mail já está cadastrado");
      const actions = $$(".uAction", back).filter((item) => item.checked).map((item) => actionToken(item.dataset.menu, item.dataset.action));
      const permissions = [...new Set(actions.filter((item) => item.endsWith(":visualizar")).map((item) => item.split(":")[0]))];
      if (!permissions.length) return toast("Selecione ao menos um menu");
      const record = { id: user?.id || uid("USR"), nome, email, perfil: $("#uPerfil").value, unidades: $("#uUnidades").value.trim() || "Todas", permissoes: permissions, acoes: actions, ativo: $("#uAtivo").value === "1" };
      const index = (db.users || []).findIndex((item) => item.id === record.id);
      if (index >= 0) db.users[index] = record; else db.users.push(record);
      audit(index >= 0 ? "Alteração" : "Inclusão", "Usuário", email);
      save("Usuário salvo");
      back.remove();
      render();
    });
    const profile = $("#uPerfil");
    profile.onchange = () => {
      const preset = presetActions(profile.value);
      $$(".uAction").forEach((item) => item.checked = preset.includes("*") || preset.includes(actionToken(item.dataset.menu, item.dataset.action)));
    };
    $$(".uAction").forEach((item) => item.onchange = () => {
      const sameMenu = $$(".uAction").filter((candidate) => candidate.dataset.menu === item.dataset.menu);
      const view = sameMenu.find((candidate) => candidate.dataset.action === "visualizar");
      if (item.dataset.action !== "visualizar" && item.checked && view) view.checked = true;
      if (item.dataset.action === "visualizar" && !item.checked) sameMenu.forEach((candidate) => candidate.checked = false);
    });
  }

  function exportGeneralBackup() {
    downloadText(`backup_geral_directfuel_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(db, null, 2), "application/json");
    toast("Backup geral gerado");
  }

  async function clearAllData() {
    const wantsBackup = confirm("Deseja fazer o backup geral dos dados antes de zerar o site?");
    if (wantsBackup) exportGeneralBackup();
    if (!confirm("Confirma a exclusão de todos os cadastros, acordos, abastecimentos, medições, relatórios e documentos? Esta ação não pode ser desfeita sem um backup.")) return;
    const users = structuredClone(db.users || []);
    const systemConfig = structuredClone(db.config);
    db = {
      config: systemConfig,
      distribuidores: [],
      bases: [],
      produtos: [],
      unidades: [],
      postos: [],
      frota: [],
      rede: [],
      acordos: [],
      abastecimentos: [],
      medicoes: [],
      docs: [],
      users,
      audit: [],
    };
    audit("Zerar dados", "Sistema", "Base preparada para novo teste");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("danfe_")) localStorage.removeItem(key);
    }
    save("Dados zerados. O site está pronto para um novo teste.");
    fetch("/api/documents", { method: "DELETE" }).catch((error) => console.error("Limpeza de documentos", error));
    route = "dashboard";
    render();
  }

  const previousConfig = config;
  config = function () {
    previousConfig();
    const userPanel = [...document.querySelectorAll("#view .panel")].find((panel) => panel.querySelector("h2")?.textContent === "Usuários e acesso");
    userPanel?.remove();
    $("#view").insertAdjacentHTML("beforeend", `<div class="panel danger-zone"><h2>Dados de teste</h2><p>Gere um backup ou zere a base para iniciar uma nova rodada de testes. Configurações e usuários serão preservados.</p><div class="toolbar"><button class="btn secondary" id="backupGeneral">Fazer backup geral</button><button class="btn danger" id="clearAllData">Zerar dados do site</button></div></div>`);
    $("#backupGeneral").onclick = exportGeneralBackup;
    $("#clearAllData").onclick = clearAllData;
  };

  const oldReset = document.getElementById("btnReset");
  if (oldReset) oldReset.style.display = "none";
  render();
})();
