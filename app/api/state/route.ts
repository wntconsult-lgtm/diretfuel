import { applyStateDelta, storageUsage, STATE_LIMIT_BYTES } from "@/lib/directfuel-storage";
import { env } from "cloudflare:workers";
import {
  OWNER_EMAILS,
  requireVixparUser,
  WORKSPACE_ID,
} from "@/lib/directfuel-access";
import { createStateBackup, ensureDailyBackup } from "@/lib/directfuel-backup";
import { cleanupPreviousTicketlogImports } from "@/lib/directfuel-ticketlog-cleanup";
import { protectFiscalMappings } from "@/lib/directfuel-fiscal-protection";
import { APP_VERSION } from "@/lib/directfuel-version";
import { D1_STATE_ROW_LIMIT_BYTES, decodeStoredState, encodeStoredState, storedStateBytes } from "@/lib/directfuel-state-codec";
import {
  analyzeChanges,
  assignAutomaticAgreementNumbers,
  assignAutomaticStationCodes,
  authorizeChanges,
  hasPermission,
  securityEvents,
  validateBusinessRules,
  validateState,
} from "@/lib/directfuel-security";

export const dynamic = "force-dynamic";
type StateRow = {
  data: string;
  version: number;
  updated_at: string;
  updated_by: string;
};

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function publicState(
  state: Record<string, unknown>,
  access: Exclude<
    Awaited<ReturnType<typeof requireVixparUser>>,
    { error: string; status: number }
  >,
) {
  if (access.isOwner) return state;
  return {
    ...state,
    users: Array.isArray(state.users)
      ? state.users.filter(
          (item) =>
            String(
              (item as Record<string, unknown>).email || "",
            ).toLowerCase() === access.user.email.toLowerCase(),
        )
      : [],
  };
}

export async function GET(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access)
    return Response.json({ error: access.error }, { status: access.status });
  try {
    await cleanupPreviousTicketlogImports(env.DB, env.BUCKET, access);
    const knownVersion = new URL(request.url).searchParams.get("version");
    if (knownVersion !== null) {
      const meta = await env.DB.prepare("SELECT version, updated_at FROM app_state WHERE workspace_id = ?").bind(WORKSPACE_ID).first<{version:number;updated_at:string}>();
      if (meta && String(meta.version) === knownVersion) return Response.json({unchanged:true,version:meta.version,applicationVersion:APP_VERSION}, {headers:{"cache-control":"private, no-store"}});
    }
    const row = await env.DB.prepare(
      "SELECT data, version, updated_at, updated_by FROM app_state WHERE workspace_id = ?",
    )
      .bind(WORKSPACE_ID)
      .first<StateRow>();
    let state = row ? await decodeStoredState<Record<string, unknown>>(row.data) : null;
    // Initial cleanup and retries only touch backup records and backup objects.
    // Run against the raw persisted state, before presentation-only audit enrichment.
    if (state && row && access.isOwner) {
      try {
        const backups = await env.DB.prepare("SELECT count(*) AS count FROM state_backups WHERE workspace_id = ?").bind(WORKSPACE_ID).first<{count: number}>();
        if (backups && backups.count > 5) await createStateBackup(state, row.version, "Segurança antes da retenção inicial", access.user.email);
      } catch (error) { console.error("Retenção inicial pendente; dados operacionais preservados", error); }
    }
    const stateStorage = storageUsage(JSON.stringify(state || {}));
    if (state && (access.isOwner || hasPermission(access, "audit"))) {
      const audit = await env.DB.prepare(
        "SELECT id, created_at, user_email, action, entity, detail, state_version FROM security_audit WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 300",
      )
        .bind(WORKSPACE_ID)
        .all<Record<string, unknown>>();
      state = {
        ...state,
        audit: audit.results.map((entry) => ({
          id: entry.id,
          data: entry.created_at,
          usuario: entry.user_email,
          acao: entry.action,
          entidade: entry.entity,
          detalhe: entry.detail,
          version: entry.state_version,
        })),
      };
    }
    return Response.json(
      {
        state: state ? publicState(state, access) : null,
        version: row?.version ?? 0,
        updatedAt: row?.updated_at ?? null,
        updatedBy: row?.updated_by ?? null,
        applicationVersion: APP_VERSION,
        storage: stateStorage,
        user: {
          email: access.user.email,
          name: access.user.displayName,
          profile: String(access.directFuelUser.perfil || "Usuário"),
          permissions: Array.isArray(access.directFuelUser.permissoes)
            ? access.directFuelUser.permissoes
            : [],
          actions: Array.isArray(access.directFuelUser.acoes)
            ? access.directFuelUser.acoes
            : [],
          isOwner: access.isOwner,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("DirectFuel state read failed", error);
    return Response.json(
      { error: "Os dados estão temporariamente indisponíveis." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access)
    return Response.json({ error: access.error }, { status: access.status });
  if (!sameOrigin(request))
    return Response.json(
      { error: "Origem da solicitação não autorizada." },
      { status: 403 },
    );
  try {
    const payload = (await request.json()) as {
      state?: unknown;
      delta?: unknown;
      version?: unknown;
      applicationVersion?: unknown;
    };
    if (
      (!(payload.state && typeof payload.state === "object" && !Array.isArray(payload.state)) && !(payload.delta && typeof payload.delta === "object" && !Array.isArray(payload.delta))) ||
      !Number.isInteger(payload.version) ||
      Number(payload.version) < 0
    )
      return Response.json(
        { error: "Estado ou versão inválida." },
        { status: 400 },
      );
    if (payload.applicationVersion != null && String(payload.applicationVersion) !== APP_VERSION)
      return Response.json({ error: "Uma nova versão está disponível. Atualize o sistema antes de salvar.", updateRequired: true, applicationVersion: APP_VERSION }, { status: 409 });
    const current = await env.DB.prepare(
      "SELECT data, version, updated_at, updated_by FROM app_state WHERE workspace_id = ?",
    )
      .bind(WORKSPACE_ID)
      .first<StateRow>();
    const expectedVersion = Number(payload.version);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion)
      return Response.json(
        {
          error:
            "Os dados foram alterados por outro usuário. Recarregue a versão atual antes de salvar.",
          conflict: true,
          currentVersion,
          updatedAt: current?.updated_at,
          updatedBy: current?.updated_by,
        },
        { status: 409 },
      );

    const previous = current
      ? await decodeStoredState<Record<string, unknown>>(current.data)
      : {};
    let next: Record<string, unknown>;
    try {
      if (payload.delta !== undefined) {
        const safeDelta = { ...(payload.delta as Record<string, unknown>) };
        // A auditoria retornada ao navegador vem da tabela imutável de eventos,
        // não da coleção embutida em app_state. Ignore clientes antigos que a
        // reenviem para evitar conflito artificial de ordenação.
        delete safeDelta.audit;
        next = applyStateDelta(previous, safeDelta);
      } else next = { ...(payload.state as Record<string, unknown>) };
    }
    catch (error) { return Response.json({error:(error as Error).message},{status:400}); }
    if (!access.isOwner) next.users = previous.users || [];
    if (Array.isArray(next.users)) {
      const users = next.users.map((entry) => {
        const user = entry as Record<string, unknown>;
        return OWNER_EMAILS.has(String(user.email || "").toLowerCase())
          ? {
              ...user,
              perfil: "Master",
              permissoes: ["*"],
              acoes: ["*"],
              ativo: true,
            }
          : user;
      });
      next.users = users;
      if (
        users.some(
          (entry) =>
            String((entry as Record<string, unknown>).perfil || "") ===
              "Master" &&
            !OWNER_EMAILS.has(
              String(
                (entry as Record<string, unknown>).email || "",
              ).toLowerCase(),
            ),
        )
      ) {
        return Response.json(
          { error: "O perfil Master é exclusivo do proprietário do sistema." },
          { status: 403 },
        );
      }
    }
    const fiscalProtectionError = protectFiscalMappings(previous, next);
    if (fiscalProtectionError) return Response.json({ error: fiscalProtectionError }, { status: 409 });
    next.stationReviews = previous.stationReviews || [];
    next.audit = previous.audit || [];
    assignAutomaticStationCodes(previous, next);
    assignAutomaticAgreementNumbers(previous, next);
    const validationError = validateState(next);
    if (validationError)
      return Response.json({ error: validationError }, { status: 400 });
    const businessRuleError = validateBusinessRules(previous, next);
    if (businessRuleError)
      return Response.json({ error: businessRuleError }, { status: 409 });
    const changes = analyzeChanges(previous, next);
    const authorizationError = authorizeChanges(
      access,
      previous,
      next,
      changes,
    );
    if (authorizationError)
      return Response.json({ error: authorizationError }, { status: 403 });

    const now = new Date().toISOString();
    const nextVersion = currentVersion + 1;
    const events = securityEvents(changes, access.user.email, nextVersion, now);
    next.audit = [
      ...events,
      ...(Array.isArray(previous.audit) ? previous.audit : []),
    ].slice(0, 300);
    const serialized = JSON.stringify(next);
    if (new TextEncoder().encode(serialized).byteLength > STATE_LIMIT_BYTES)
      return Response.json(
        { error: "A base atingiu o limite de gravação da aplicação. Contate o administrador e baixe suas alterações antes de atualizar.", storage:storageUsage(serialized) },
        { status: 413 },
      );
    const stored = await encodeStoredState(serialized);
    if (storedStateBytes(stored) > D1_STATE_ROW_LIMIT_BYTES)
      return Response.json(
        { error: "A base compactada atingiu o limite seguro de gravação. Execute a política de retenção ou contate o administrador.", storage:storageUsage(serialized) },
        { status: 413 },
      );

    const destructive = changes.some((change) => change.deleted.length > 0);
    if (current && destructive)
      await createStateBackup(
        previous,
        currentVersion,
        "Antes de exclusão",
        access.user.email,
      );
    else if (current)
      await ensureDailyBackup(previous, currentVersion, access.user.email);

    // All audit rows and deletions use the same version predicate. D1 batch is
    // transactional: a failed audit write rolls back the state; a stale writer
    // inserts no history and updates no state.
    const statements: D1PreparedStatement[] = [];
    if (!current) statements.push(env.DB.prepare("INSERT INTO app_state (workspace_id, data, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)").bind(WORKSPACE_ID,stored,now,access.user.email));
    const guard = current ? " WHERE EXISTS (SELECT 1 FROM app_state WHERE workspace_id = ? AND version = ?)" : "";
    const guardValues = current ? [WORKSPACE_ID,currentVersion] : [];
    for (const event of events) statements.push(env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) SELECT ?, ?, ?, ?, ?, ?, ?, ?" + guard).bind(event.id,WORKSPACE_ID,now,access.user.email,event.acao,event.entidade,event.detalhe,nextVersion,...guardValues));
    for (const change of changes) for (const record of change.deleted) statements.push(env.DB.prepare("INSERT INTO deleted_records (id, workspace_id, collection, record_id, data, deleted_at, deleted_by) SELECT ?, ?, ?, ?, ?, ?, ?" + guard).bind(crypto.randomUUID(),WORKSPACE_ID,change.collection,String(record.id || ""),JSON.stringify(record),now,access.user.email,...guardValues));
    if (current) statements.push(env.DB.prepare("UPDATE app_state SET data = ?, version = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM document_removals WHERE workspace_id = app_state.workspace_id AND status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(stored,nextVersion,now,access.user.email,WORKSPACE_ID,currentVersion));
    const result = await env.DB.batch(statements);
    if (current && !result[result.length - 1].meta.changes) return Response.json({error:"Os dados foram alterados por outro usuário. Recarregue antes de salvar.",conflict:true},{status:409});
    return Response.json({ ok: true, version: nextVersion, updatedAt: now, storage:storageUsage(serialized) });
  } catch (error) {
    console.error("DirectFuel state write failed", error);
    return Response.json(
      { error: "Não foi possível salvar. Tente novamente." },
      { status: 503 },
    );
  }
}
