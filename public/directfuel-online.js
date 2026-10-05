(() => {
  let saving = false;
  let pending = false;
  let lastRemoteStamp = "";
  let remoteVersion = 0;
  let blockedByConflict = false;
  let saveTimer = null;
  let initialized = false;
  let staleApplication = false;
  let localRevision = 0;
  let pullRequestId = 0;
  let acknowledgedState = null;

  function pill(text, ok = false) {
    let el = document.getElementById("onlinePill");
    if (!el) {
      el = document.createElement("div");
      el.id = "onlinePill";
      el.className = "online-pill";
      el.setAttribute("role", "status");
      document.querySelector(".header-actions").appendChild(el);
    }
    el.className = "online-pill " + (ok ? "ok" : "warn");
    el.textContent = text;
  }

  function accessScreen(message) {
    if (document.getElementById("accessBack")) return;
    const overlay = document.createElement("div");
    overlay.id = "accessBack";
    overlay.className = "login-back";
    overlay.innerHTML = `<div class="login-card">
      <div class="login-brand">DirectFuel Vixpar</div>
      <div class="login-sub">Acesso corporativo</div>
      <div class="login-error" style="display:block;margin:18px 0">${message}</div>
      <a class="btn primary" href="/signout-with-chatgpt?return_to=/">Trocar conta</a>
      <p class="note" style="margin-top:16px">Entre com a conta ChatGPT autorizada para este site.</p>
    </div>`;
    document.body.appendChild(overlay);
  }

  function saveRecoveryDraft(reason) {
    const key = `directfuel_recovery_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try { localStorage.setItem(
      key,
      JSON.stringify({
        reason,
        version: remoteVersion,
        savedAt: new Date().toISOString(),
        state: db,
      }),
    );
    return key; } catch(error) { console.error("Não foi possível criar cópia local",error); return null; }
  }

  function conflictScreen(message) {
    blockedByConflict = true;
    if (document.getElementById("conflictBack")) return;
    const draftKey = saveRecoveryDraft(message);
    const overlay = document.createElement("div");
    overlay.id = "conflictBack";
    overlay.className = "login-back";
    overlay.innerHTML = `<div class="login-card">
      <div class="login-brand">Alterações protegidas</div>
      <p style="margin:16px 0">${message}</p>
      <p class="note">${draftKey ? "Uma cópia local das alterações foi criada." : "Não foi possível criar a cópia local. Baixe suas alterações antes de atualizar."}</p>
      <div class="actions" style="margin-top:18px;justify-content:center">
        <button class="btn" id="downloadConflict">Baixar minhas alterações</button>
        <button class="btn primary" id="reloadConflict">Atualizar sistema</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById("downloadConflict").onclick = () => {
      const blob = new Blob([JSON.stringify(db, null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `directfuel-alteracoes-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    };
    document.getElementById("reloadConflict").onclick = () => location.reload();
  }

  function userChip(user) {
    const header = document.querySelector(".header-actions");

    window.DIRECTFUEL_CURRENT_USER = user.name || user.email;
    window.DIRECTFUEL_CURRENT_EMAIL = user.email.toLowerCase();
    window.DIRECTFUEL_CURRENT_PROFILE = user.profile || "Usuário";
    window.DIRECTFUEL_PERMISSIONS = user.permissions || [];
    window.DIRECTFUEL_ACTIONS = user.actions || [];
    window.DIRECTFUEL_IS_OWNER = !!user.isOwner;
    db.users = db.users || [];
    if (
      user.isOwner &&
      !db.users.some(
        (item) => (item.email || "").toLowerCase() === user.email.toLowerCase(),
      )
    ) {
      db.users.unshift({
        id: uid("USR"),
        nome: user.name || "Wagner Nicolau",
        email: user.email.toLowerCase(),
        perfil: "Master",
        unidades: "Todas",
        permissoes: ["*"],
        acoes: ["*"],
        ativo: true,
      });
      pending = true;
    }
    if (!header || document.getElementById("userChip")) return;
    const chip = document.createElement("span");
    chip.id = "userChip";
    chip.className = "user-chip";
    chip.innerHTML = `${user.email} · <a href="/signout-with-chatgpt?return_to=/">sair</a>`;
    header.appendChild(chip);
  }

  async function readResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Falha de comunicação.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function checkApplicationVersion() {
    const response=await fetch("/api/version",{cache:"no-store"});
    if(!response.ok)return false;
    const payload=await response.json();
    if(!payload.applicationVersion||String(payload.applicationVersion)===window.DIRECTFUEL_APP_VERSION)return false;
    if(!staleApplication&&(pending||saving||blockedByConflict))saveRecoveryDraft("Nova versão disponível com alterações locais");
    staleApplication=true;
    pill("Nova versão disponível • atualize o sistema");
    window.directFuelVersionMismatch?.();
    return true;
  }
  async function pull(initial = false) {
    if (saving || pending || blockedByConflict || staleApplication || (!initial && document.querySelector(".modal-back"))) {
      try { await checkApplicationVersion(); } catch(error) { console.error("Falha ao verificar atualização",error); }
      return;
    }
    const requestedRevision = localRevision, requestId = ++pullRequestId;
    try {
      const payload = await readResponse(
        await fetch(initial ? "/api/state" : `/api/state?version=${remoteVersion}`, { cache: "no-store" }),
      );
      if (String(payload.applicationVersion) !== window.DIRECTFUEL_APP_VERSION) {
        staleApplication = true;
        window.directFuelVersionMismatch?.();
        if (initial) throw new Error("Uma nova versão foi publicada. Recarregue o sistema.");
        return;
      }
      // A read that started before a local edit cannot replace that edit or its revision.
      if (requestedRevision !== localRevision || requestId !== pullRequestId || saving || pending || blockedByConflict || (!initial && document.querySelector(".modal-back"))) return;
      if (payload.unchanged) return;
      remoteVersion = Number(payload.version || 0);
      const versionBadge = document.getElementById("versionBadge");
      if (versionBadge) {
        versionBadge.textContent = `Sistema v${window.DIRECTFUEL_APP_VERSION} · Dados v${remoteVersion}`;
        versionBadge.title = payload.updatedAt
          ? `Última sincronização: ${new Date(payload.updatedAt).toLocaleString("pt-BR")}`
          : "Base ainda sem registros";
      }
      userChip(payload.user);
      window.directFuelStorageUsage?.(payload.storage);
      if (payload.state) {
        if (
          initial ||
          (payload.updatedAt && payload.updatedAt !== lastRemoteStamp)
        ) {
          acknowledgedState = structuredClone(payload.state);
          db = payload.state;
          db.users = db.users || [];
          if (window.directFuelNormalizeInvoiceState?.()) pending = true;
          if (
            payload.user.isOwner &&
            !db.users.some(
              (item) =>
                (item.email || "").toLowerCase() ===
                payload.user.email.toLowerCase(),
            )
          ) {
            db.users.unshift({
              id: uid("USR"),
              nome: payload.user.name || "Wagner Nicolau",
              email: payload.user.email.toLowerCase(),
              perfil: "Master",
              unidades: "Todas",
              permissoes: ["*"],
              acoes: ["*"],
              ativo: true,
            });
            pending = true;
          }
          cacheState();
          lastRemoteStamp = payload.updatedAt || "";
          window.directFuelSyncSnapshot?.(db);
          render();
          if (pending) setTimeout(push, 250);
          pill(
            initial
              ? "Online • dados carregados"
              : "Online • atualizado por outro usuário",
            true,
          );
        }
      } else if (initial) {
        db = structuredClone(seed);
        for (const key of [
          "distribuidores",
          "bases",
          "produtos",
          "unidades",
          "postos",
          "frota",
          "rede",
          "acordos",
          "abastecimentos",
          "medicoes",
          "docs",
          "audit",
        ])
          db[key] = [];
        db.users = [
          {
            id: uid("USR"),
            nome: payload.user.name || "Usuário master",
            email: payload.user.email.toLowerCase(),
            perfil: "Master",
            unidades: "Todas",
            permissoes: ["*"],
            acoes: ["*"],
            ativo: true,
          },
        ];
        pending = true;
        await push();
      }
    } catch (error) {
      if (initial) throw error;
      if (error.status === 401 || error.status === 403)
        accessScreen(error.message);
      pill(
        error.status === 403
          ? "Acesso não autorizado"
          : "Falha ao carregar dados",
      );
      console.error(error);
    }
  }

  async function flushDanfes() {
    let changed = false;
    for (const medicao of db.medicoes || []) {
      if (medicao.danfePath) continue;
      let raw;
      try { raw = localStorage.getItem("danfe_" + medicao.id); }
      catch (error) { console.warn("Armazenamento local indisponível para DANFEs", error); continue; }
      if (!raw) continue;
      try {
        const blob = await (await fetch(raw)).blob();
        const payload = await readResponse(
          await fetch("/api/documents/" + encodeURIComponent(medicao.id), {
            method: "POST",
            headers: { "content-type": "application/pdf" },
            body: blob,
          }),
        );
        medicao.danfePath = payload.path;
        localStorage.removeItem("danfe_" + medicao.id);
        changed = true;
      } catch (error) {
        console.error("Falha ao enviar DANFE", error);
        pill("Dados salvos • DANFE pendente");
      }
    }
    return changed;
  }

  async function push() {
    if (saving || !pending || staleApplication || blockedByConflict) return;
    saving = true;
    pending = false;
    pill("Salvando...", true);
    try {
      const sentState = structuredClone(db);
      const change = acknowledgedState && window.DirectFuelStateDelta ? {delta:window.DirectFuelStateDelta.create(acknowledgedState, sentState)} : {state:sentState};
      const payload = await readResponse(
        await fetch("/api/state", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...change, version: remoteVersion, applicationVersion: window.DIRECTFUEL_APP_VERSION }),
        }),
      );
      acknowledgedState = sentState;
      window.directFuelStorageUsage?.(payload.storage);
      remoteVersion = Number(payload.version || remoteVersion);
      lastRemoteStamp = payload.updatedAt || lastRemoteStamp;
      const versionBadge = document.getElementById("versionBadge");
      if (versionBadge) {
        versionBadge.textContent = `Sistema v${window.DIRECTFUEL_APP_VERSION} · Dados v${remoteVersion}`;
        versionBadge.title = `Última sincronização: ${new Date(lastRemoteStamp).toLocaleString("pt-BR")}`;
      }
      pill(pending ? "Salvamento em andamento • há novas alterações" : "Online • dados sincronizados", true);
      if (!pending) toast("Alterações salvas no servidor.");
      if (await flushDanfes()) {
        cacheState();
        pending = true;
      }
    } catch (error) {
      if (error.payload?.updateRequired) {
        pending = true;
        saveRecoveryDraft("Atualização necessária antes de salvar");
        staleApplication = true;
        pill("Nova versão disponível • atualize o sistema");
        window.directFuelVersionMismatch?.();
      } else if (error.status === 409) {
        pending = false;
        pill(error.payload?.conflict ? "Conflito de dados • alterações protegidas" : "Gravação bloqueada • confira o motivo");
        conflictScreen(error.message);
      } else if (error.status === 400 || error.status === 403 || error.status === 413) {
        pending = false;
        pill("Alteração bloqueada por segurança");
        conflictScreen(error.message);
      } else {
        pending = true;
        pill("Falha ao salvar • nova tentativa automática");
      }
      console.error(error);
    } finally {
      saving = false;
      if (pending && !staleApplication && !blockedByConflict) setTimeout(push, 900);
    }
  }

  const localSave = save;
  save = function (message) {
    if (!initialized) return;
    localRevision++;
    if (blockedByConflict && !staleApplication) { saveRecoveryDraft("Alteração durante bloqueio de gravação"); toast("Resolva o aviso de gravação antes de continuar."); return; }
    if (staleApplication) { pending = true; saveRecoveryDraft("Alteração realizada após atualização do sistema"); window.directFuelVersionMismatch?.(); return; }
    localSave("Alterações locais • aguardando confirmação do servidor");
    pending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 180);
  };

  reset = function () {
    toast(
      "A restauração dos dados de teste foi desativada. Use Configurações para fazer backup ou zerar a base.",
    );
  };

  const localDocumentos = documentos;
  documentos = function () {
    localDocumentos();
    $$(".openDoc").forEach((button) => {
      button.onclick = () => {
        const medicao = db.medicoes.find(
          (item) => item.id === button.dataset.id,
        );
        if (medicao?.danfePath) {
          window.open(
            "/api/documents/" + encodeURIComponent(medicao.id),
            "_blank",
            "noopener",
          );
          return;
        }
        const local = localStorage.getItem("danfe_" + button.dataset.id);
        if (local) window.open(local, "_blank", "noopener");
        else toast("Arquivo ainda não está disponível");
      };
    });
  };

  const localConfig = config;
  config = function () {
    localConfig();
    const accessNote = [...document.querySelectorAll(".note")].find((item) =>
      item.textContent.includes("e-mail corporativo @vix.com.br"),
    );
    if (accessNote)
      accessNote.textContent =
        "O acesso ao site exige uma conta ChatGPT autorizada.";
  };

  pill("Online • conectando...");
  window.directFuelStartSync = async () => {
    await pull(true);
    if (pending) { await push(); if (pending || blockedByConflict) throw new Error("Não foi possível concluir a sincronização inicial."); }
    initialized = true;
    const checkForRelease = async () => {
      try { return await checkApplicationVersion(); }
      catch (error) { console.error("Falha ao verificar nova versão", error); return false; }
    };
    setInterval(async () => { if (!await checkForRelease()) await pull(false); }, 8000);
    window.addEventListener("focus", checkForRelease);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkForRelease(); });
  };
  window.addEventListener("beforeunload", event => {
    if (!pending && !saving && !blockedByConflict) return;
    saveRecoveryDraft("Saída antes da confirmação de salvamento");
    event.preventDefault();event.returnValue="";
  });
  document.addEventListener("visibilitychange", () => {
    if (initialized && document.visibilityState === "visible") pull(false);
  });
})();
