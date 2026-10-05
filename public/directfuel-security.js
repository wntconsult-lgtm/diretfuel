(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "—";
  const administrator = () => !!window.DIRECTFUEL_IS_OWNER;

  const previousNav = renderNav;
  renderNav = function () {
    previousNav();
    if (!administrator() || document.querySelector('[data-route="security"]')) return;
    const group = document.createElement("div");
    group.className = "nav-group";
    group.innerHTML = `<div class="nav-group-title">SEGURANÇA</div><button class="nav-item ${route === "security" ? "active" : ""}" data-route="security">Segurança e acessos</button>`;
    $("#nav").appendChild(group);
    group.querySelector("button").onclick = () => { route = "security"; render(); };
  };

  async function request(body) {
    const response = await fetch("/api/security", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
    return payload;
  }

  function localRecoveriesPanel() {
    if(!administrator())return;
    const copies=[];let error="";
    try {for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith("directfuel_recovery_"))continue;try{const raw=localStorage.getItem(key),copy=JSON.parse(raw);if(copy?.state&&typeof copy.state==="object")copies.push({key,copy,size:raw.length});}catch{}}}catch{error="Não foi possível ler as cópias deste navegador.";}
    copies.sort((a,b)=>String(b.copy.savedAt).localeCompare(String(a.copy.savedAt)));
    const panel=document.createElement("div");panel.className="panel";
    panel.innerHTML=`<h2>Cópias de recuperação deste navegador</h2><p class="note">Cópias locais feitas durante conflitos ou gravações pendentes. Baixar não restaura nem altera a base. Use o mesmo navegador e perfil em que ocorreu o problema.</p><div class="table-wrap"><table><thead><tr><th>Data</th><th>Motivo</th><th>Versão dos dados</th><th>Medições</th><th>MED-2026-0007</th><th>Ação</th></tr></thead><tbody>${copies.map(({copy},i)=>`<tr><td>${esc(dateTime(copy.savedAt))}</td><td>${esc(copy.reason)}</td><td>${esc(copy.version)}</td><td>${Array.isArray(copy.state.medicoes)?copy.state.medicoes.length:0}</td><td>${(copy.state.medicoes||[]).some(m=>String(m.numero||"").toUpperCase()==="MED-2026-0007")?"Presente":"Não encontrada"}</td><td><button type="button" class="btn small secondary" data-recovery-download="${i}">Baixar cópia</button></td></tr>`).join("")||`<tr><td colspan="6">${esc(error||"Nenhuma cópia de recuperação encontrada neste navegador.")}</td></tr>`}</tbody></table></div>`;
    $("#view").prepend(panel);
    panel.querySelectorAll("[data-recovery-download]").forEach(button=>button.onclick=()=>{const entry=copies[Number(button.dataset.recoveryDownload)],raw=localStorage.getItem(entry.key);if(!raw)return toast("Esta cópia não está mais disponível.");const url=URL.createObjectURL(new Blob([raw],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download=`directfuel-recuperacao-${String(entry.copy.savedAt||"copia").replace(/[^0-9A-Za-z-]/g,"-")}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  }

  async function securityPage() {
    pageTitle("Segurança e acessos", "Acessos, backups, lixeira e trilha independente de auditoria");
    $("#view").innerHTML = '<div class="panel"><p class="muted">Carregando controles de segurança...</p></div>';
    try {
      const data = await request();
      $("#view").innerHTML = `<div class="grid cards">
        <div class="card"><div class="label">Backups disponíveis</div><div class="value">${data.backups.length}</div><div class="delta">Cópias fora da base principal</div></div>
        <div class="card"><div class="label">Itens na lixeira</div><div class="value">${data.deleted.length}</div><div class="delta">Registros recuperáveis</div></div>
        <div class="card"><div class="label">Eventos de auditoria</div><div class="value">${data.audits.length}</div><div class="delta">Últimos eventos imutáveis</div></div>
      </div>
      <div class="panel"><div class="toolbar"><div><h2>Backups da base</h2><p class="note">Há um backup diário no primeiro salvamento do dia e uma cópia adicional antes de exclusões ou restaurações.</p></div><button class="btn primary" id="createSecurityBackup">Criar backup agora</button></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Versão</th><th>Motivo</th><th>Criado por</th><th>Tamanho</th><th>Ação</th></tr></thead><tbody>${data.backups.map((item) => `<tr><td>${dateTime(item.created_at)}</td><td>${item.state_version}</td><td>${esc(item.reason)}</td><td>${esc(item.created_by)}</td><td>${Math.max(1, Math.round(Number(item.size_bytes || 0) / 1024))} KB</td><td><a class="btn small secondary" href="/api/security?downloadBackup=${encodeURIComponent(item.id)}">Baixar</a> ${data.isMaster ? `<button class="btn small restoreBackup" data-id="${esc(item.id)}">Restaurar</button>` : "Somente Master"}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Nenhum backup criado ainda.</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h2>Lixeira recuperável</h2><p class="note">Exclusões feitas pelo sistema aparecem aqui. A restauração não apaga o histórico.</p><div class="table-wrap"><table><thead><tr><th>Excluído em</th><th>Tipo</th><th>Identificador</th><th>Excluído por</th><th>Ação</th></tr></thead><tbody>${data.deleted.map((item) => `<tr><td>${dateTime(item.deleted_at)}</td><td>${esc(item.collection)}</td><td>${esc(item.record_id)}</td><td>${esc(item.deleted_by)}</td><td><button class="btn small restoreDeleted" data-id="${esc(item.id)}">Restaurar</button></td></tr>`).join("") || '<tr><td colspan="5" class="muted">A lixeira está vazia.</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h2>Auditoria independente</h2><div class="table-wrap"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhe</th><th>Versão</th></tr></thead><tbody>${data.audits.map((item) => `<tr><td>${dateTime(item.created_at)}</td><td>${esc(item.user_email)}</td><td>${esc(item.action)}</td><td>${esc(item.entity)}</td><td>${esc(item.detail)}</td><td>${item.state_version}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Nenhum evento registrado ainda.</td></tr>'}</tbody></table></div></div>`;

      localRecoveriesPanel();
      $("#createSecurityBackup").onclick = async () => { try { await request({ action: "create_backup" }); toast("Backup criado com sucesso"); securityPage(); } catch (error) { toast(error.message); } };
      $$(".restoreDeleted").forEach((button) => button.onclick = async () => { if (!confirm("Deseja restaurar este registro na base atual?")) return; try { await request({ action: "restore_deleted", id: button.dataset.id }); toast("Registro restaurado"); location.reload(); } catch (error) { toast(error.message); } });
      $$(".restoreBackup").forEach((button) => button.onclick = async () => { if (!confirm("Restaurar este backup completo? Um backup da situação atual será criado e os usuários atuais serão preservados.")) return; try { await request({ action: "restore_backup", id: button.dataset.id }); toast("Backup restaurado"); location.reload(); } catch (error) { toast(error.message); } });
      window.directFuelAddScreenExport?.();
    } catch (error) {
      $("#view").innerHTML = `<div class="panel"><h2>Acesso indisponível</h2><p>${esc(error.message)}</p></div>`;
      localRecoveriesPanel();
    }
  }

  const previousRender = render;
  render = function () {
    if (route === "security") { renderNav(); securityPage(); return; }
    previousRender();
  };
  render();
})();
