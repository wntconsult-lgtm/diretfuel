import Script from "next/script";
import { headers } from "next/headers";
import { recordAccess, requireVixparUser } from "@/lib/directfuel-access";
import { requireChatGPTUser } from "./chatgpt-auth";
import { APP_VERSION } from "@/lib/directfuel-version";

export const dynamic = "force-dynamic";

export default async function DirectFuelPage() {
  await requireChatGPTUser("/");
  const access = await requireVixparUser();
  const requestHeaders = await headers();
  const accessIdentity =
    "error" in access ? await requireChatGPTUser("/") : access.user;
  try {
    await recordAccess({
      email: accessIdentity.email,
      displayName: accessIdentity.displayName,
      event: "error" in access ? "Acesso recusado" : "Acesso autorizado",
      route: "/",
      userAgent: requestHeaders.get("user-agent") || undefined,
    });
  } catch (error) {
    console.error("DirectFuel access log failed", error);
  }
  if ("error" in access) {
    return (
      <main className="access-page">
        <section className="login-card">
          <img className="access-logo" src="/logo-vixpar.png" alt="Vixpar" />
          <div className="login-brand">DirectFuel Vixpar</div>
          <p>{access.error}</p>
          <a
            className="btn primary"
            href="/signout-with-chatgpt?return_to=/"
            target="_top"
          >
            Entrar com outra conta
          </a>
        </section>
      </main>
    );
  }
  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossOrigin="anonymous" />
      <link rel="stylesheet" href={`/directfuel-dashboard-v2.css?v=${APP_VERSION}`} />
      <link rel="stylesheet" href="/directfuel-price-saving.css?v=44" />
      <link rel="stylesheet" href={`/directfuel-geo.css?v=${APP_VERSION}`} />
      <style id="directfuel-loading-style">{`#app { visibility: hidden; pointer-events: none; }`}</style>
      <div id="directfuel-loading" role="status" data-version={APP_VERSION} style={{position:"fixed",inset:0,display:"grid",placeContent:"center",textAlign:"center",background:"#f5f7f8",zIndex:10000,padding:24}}>
        <h2>DirectFuel Vixpar</h2><p id="directfuel-loading-message">Carregando a versão atual e os dados…</p>
        {/* A plain link deliberately forces a full reload after a stale deployment is detected. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" id="directfuel-loading-retry" hidden>Recarregar o sistema</a>
      </div>
      <noscript>Ative o JavaScript para acessar o DirectFuel.</noscript>
      <div id="app">
        <aside className="sidebar">
          <div className="vixpar-brand">
            <img src="/logo-vixpar.png" alt="Vixpar e empresas do grupo" />
          </div>
          <div className="brand product-brand">
            <div className="logo">DF</div>
            <div>
              <strong>DirectFuel</strong>
              <span>VIXPAR</span>
            </div>
          </div>
          <nav id="nav" aria-label="Navegação principal" />
          <div className="side-footer">
            <button id="btnExport" className="ghost">
              Exportar backup
            </button>
            <label className="ghost file-label">
              Importar backup
              <input
                id="fileImport"
                type="file"
                accept="application/json"
                hidden
              />
            </label>
          </div>
        </aside>
        <main>
          <header>
            <div>
              <h1 id="pageTitle">Dashboard</h1>
              <p id="pageSub">Gestão de abastecimento</p>
            </div>
            <div className="header-actions">
              <span id="versionBadge" className="version-badge">
                Sistema v{APP_VERSION} · Dados carregando
              </span>
              <span id="clock" />
              <button id="btnReset" className="danger ghost">
                Restaurar dados de demonstração
              </button>
            </div>
          </header>
          <section id="view" aria-live="polite" />
        </main>
      </div>
      <div id="toast" aria-live="polite" />
      <Script src={`/directfuel-bootstrap.js?v=${APP_VERSION}`} strategy="afterInteractive" />
    </>
  );
}
