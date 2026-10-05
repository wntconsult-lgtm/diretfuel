(() => {
  const escAccess = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const accessDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
  let accessRows = [];

  function filteredAccessRows() {
    const user = String(document.getElementById("accessUser")?.value || "").trim().toLowerCase();
    const from = document.getElementById("accessFrom")?.value || "";
    const to = document.getElementById("accessTo")?.value || "";
    const event = document.getElementById("accessEvent")?.value || "";
    return accessRows.filter((item) => {
      const date = String(item.created_at || "").slice(0, 10);
      const identity = String(item.display_name || "") + " " + String(item.user_email || "");
      return (!user || identity.toLowerCase().includes(user)) && (!from || date >= from) && (!to || date <= to) && (!event || item.event === event);
    });
  }

  function drawAccessRows() {
    const host = document.getElementById("accessTable");
    if (!host) return;
    const rows = filteredAccessRows();
    host.innerHTML = "<div class='table-wrap'><table><thead><tr><th>Data e horário</th><th>Nome</th><th>E-mail ChatGPT</th><th>Resultado</th><th>Página</th><th>Navegador</th></tr></thead><tbody>" +
      (rows.map((item) => "<tr><td>" + accessDateTime(item.created_at) + "</td><td>" + escAccess(item.display_name || "-") + "</td><td>" + escAccess(item.user_email) + "</td><td><span class='badge " + (item.event === "Acesso autorizado" ? "ok'>Autorizado" : "bad'>Recusado") + "</span></td><td>" + escAccess(item.route || "/") + "</td><td class='access-agent' title='" + escAccess(item.user_agent || "") + "'>" + escAccess(item.user_agent || "-") + "</td></tr>").join("") ||
      "<tr><td colspan='6' class='muted'>Nenhum acesso encontrado para os filtros.</td></tr>") +
      "</tbody></table></div>";
  }

  function exportAccessRows() {
    const cell = (value) => "<Cell><Data ss:Type='String'>" + escAccess(value) + "</Data></Cell>";
    const headers = ["Data e horário", "Nome", "E-mail ChatGPT", "Resultado", "Página", "Navegador"];
    const body = filteredAccessRows().map((item) => "<Row>" + [accessDateTime(item.created_at), item.display_name || "", item.user_email, item.event, item.route || "/", item.user_agent || ""].map(cell).join("") + "</Row>").join("");
    const xml = "<?xml version='1.0'?><Workbook xmlns='urn:schemas-microsoft-com:office:spreadsheet' xmlns:ss='urn:schemas-microsoft-com:office:spreadsheet'><Worksheet ss:Name='Acessos'><Table><Row>" + headers.map(cell).join("") + "</Row>" + body + "</Table></Worksheet></Workbook>";
    const blob = new Blob(["\ufeff", xml], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "acessos_directfuel_" + new Date().toISOString().slice(0, 10) + ".xls";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function accessPage() {
    pageTitle("Controle de acessos", "Quem acessou o DirectFuel, data, horário e resultado da autorização");
    document.getElementById("view").innerHTML = "<div class='panel'><p class='muted'>Carregando histórico de acessos...</p></div>";
    try {
      const response = await fetch("/api/security", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os acessos.");
      accessRows = data.accesses || [];
      const authorized = accessRows.filter((item) => item.event === "Acesso autorizado");
      const refused = accessRows.filter((item) => item.event === "Acesso recusado");
      const unique = new Set(authorized.map((item) => String(item.user_email || "").toLowerCase())).size;
      document.getElementById("view").innerHTML =
        "<div class='grid cards'><div class='card'><div class='label'>Usuários identificados</div><div class='value'>" + unique + "</div><div class='delta'>Contas com acesso autorizado</div></div><div class='card'><div class='label'>Acessos autorizados</div><div class='value'>" + authorized.length + "</div><div class='delta'>Últimos 1.000 registros</div></div><div class='card'><div class='label'>Acessos recusados</div><div class='value'>" + refused.length + "</div><div class='delta'>Tentativas bloqueadas</div></div><div class='card'><div class='label'>Último acesso</div><div class='value access-last'>" + escAccess(accessRows[0]?.user_email || "-") + "</div><div class='delta'>" + accessDateTime(accessRows[0]?.created_at) + "</div></div></div>" +
        "<div class='panel'><div class='dashboard-v2-heading'><div><h2>Histórico de acessos</h2><p class='muted'>Exclusivo do proprietário do sistema.</p></div><button class='btn secondary' id='exportAccesses'>Exportar Excel</button></div><div class='form-grid access-filters'><div class='field'><label>Usuário</label><input id='accessUser' placeholder='Nome ou e-mail'></div><div class='field'><label>Data inicial</label><input type='date' id='accessFrom'></div><div class='field'><label>Data final</label><input type='date' id='accessTo'></div><div class='field'><label>Resultado</label><select id='accessEvent'><option value=''>Todos</option><option>Acesso autorizado</option><option>Acesso recusado</option></select></div></div><div id='accessTable' style='margin-top:14px'></div></div>";
      ["accessUser", "accessFrom", "accessTo", "accessEvent"].forEach((id) => document.getElementById(id).addEventListener(id === "accessUser" ? "input" : "change", drawAccessRows));
      document.getElementById("exportAccesses").onclick = exportAccessRows;
      drawAccessRows();
    } catch (error) {
      document.getElementById("view").innerHTML = "<div class='panel'><h2>Acessos indisponíveis</h2><p>" + escAccess(error.message) + "</p></div>";
    }
  }

  const previousRenderNav = renderNav;
  renderNav = function () {
    previousRenderNav();
    if (!window.DIRECTFUEL_IS_OWNER) return;
    if (document.querySelector("[data-route='accesses']")) return;
    const securityButton = document.querySelector("[data-route='security']");
    if (!securityButton) return;
    securityButton.insertAdjacentHTML("afterend", "<button class='nav-item " + (route === "accesses" ? "active" : "") + "' data-route='accesses'>Controle de acessos</button>");
    document.querySelector("[data-route='accesses']").onclick = () => { route = "accesses"; render(); };
  };

  const previousRender = render;
  render = function () {
    if (route === "accesses" && window.DIRECTFUEL_IS_OWNER) { renderNav(); accessPage(); return; }
    previousRender();
  };
  render();
})();
