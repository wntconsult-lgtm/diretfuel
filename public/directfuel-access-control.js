(() => {
  const routePermission = (value) => value.startsWith("report_") ? "relatorios" : value === "price_evolution" ? "dashboard" : ["medicoes_realizadas", "accounting"].includes(value) ? "medicoes" : value;
  const can = (action, requestedRoute) => {
    if (window.DIRECTFUEL_IS_OWNER) return true;
    const activeRoute = requestedRoute || (typeof route !== "undefined" ? route : "dashboard");
    const permission = routePermission(activeRoute);
    const actions = Array.isArray(window.DIRECTFUEL_ACTIONS) ? window.DIRECTFUEL_ACTIONS : [];
    return actions.includes("*") || actions.includes(`${permission}:${action}`);
  };

  function remove(selector) {
    document.querySelectorAll(selector).forEach((element) => element.remove());
  }

  function applyControls() {
    if (!window.DIRECTFUEL_IS_OWNER) {
      document.querySelectorAll('[data-route="users"],[data-route="config"],[data-route="security"]').forEach((item) => item.remove());
      document.querySelector("#fileImport")?.closest("label")?.remove();
      remove("#btnExport");
    }
    if (!can("incluir")) {
      remove("#newRec,#newAb,#newAcordo,#criarM,#createMeasurement");
      document.querySelectorAll('#view label input[type="file"]').forEach((input) => input.closest("label")?.remove());
    }
    if (!can("editar")) remove(".edit,.editFuel,.editA,.editMeasurement,#saveAccounting,.reviewAlert,.geo-edit,#geoSaveParams");
    if (!can("excluir")) remove(".del,.deleteFuel,.deleteAdjustment,.geo-delete");
    if (!can("aprovar")) remove(".approveM,.approveDone");
    if (!can("exportar")) remove(".screen-export,.geo-export,#exportExcel,#exportDashboard,#exportDashV2,#exportDashPdf,#exportPricePdf,#exportAlerts,#exportAccountingList,.exportAdjustment,.exportFuelings,.generateRcSap,.printA,[data-model]");

    if (!window.DIRECTFUEL_IS_OWNER && !document.querySelector("#view .access-level-note")) {
      const view = document.getElementById("view");
      if (view) view.insertAdjacentHTML("afterbegin", `<div class="access-level-note">Acesso aplicado: somente as ações autorizadas pelo proprietário estão disponíveis.</div>`);
    }
  }

  const previousRender = window.render;
  if (typeof previousRender === "function") {
    window.render = function () {
      const result = previousRender.apply(this, arguments);
      queueMicrotask(applyControls);
      return result;
    };
  }
  window.directFuelCanAction = (requestedRoute, action) => can(action, requestedRoute);
  applyControls();
})();
