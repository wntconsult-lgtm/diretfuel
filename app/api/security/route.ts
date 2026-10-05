import { env } from "cloudflare:workers";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";
import { createStateBackup } from "@/lib/directfuel-backup";
import { isMaster, validateState } from "@/lib/directfuel-security";
import { decodeStoredState, encodeStoredState } from "@/lib/directfuel-state-codec";

export const dynamic = "force-dynamic";
type StateRow = { data: string; version: number };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function audit(email: string, action: string, entity: string, detail: string, version: number) {
  await env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), WORKSPACE_ID, new Date().toISOString(), email, action, entity, detail, version).run();
}

export async function GET(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!access.isOwner) return Response.json({ error: "Somente o proprietário pode acessar Segurança e acessos." }, { status: 403 });
  try {
    const backupId = new URL(request.url).searchParams.get("downloadBackup");
    if (backupId) {
      const backup = await env.DB.prepare("SELECT object_key, state_version FROM state_backups WHERE id = ? AND workspace_id = ?").bind(backupId, WORKSPACE_ID).first<{object_key: string; state_version: number}>();
      if (!backup) return Response.json({error:"Backup não encontrado."},{status:404});
      const object = await env.BUCKET.get(backup.object_key);
      if (!object) return Response.json({error:"Arquivo do backup indisponível."},{status:404});
      return new Response(object.body,{headers:{"content-type":"application/json","content-disposition":`attachment; filename="directfuel-backup-v${backup.state_version}.json"`,"cache-control":"private, no-store"}});
    }
    const [backups, deleted, audits, accesses] = await Promise.all([
      env.DB.prepare("SELECT id, state_version, reason, created_at, created_by, size_bytes FROM state_backups WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").bind(WORKSPACE_ID).all(),
      env.DB.prepare("SELECT id, collection, record_id, deleted_at, deleted_by FROM deleted_records WHERE workspace_id = ? AND restored_at IS NULL ORDER BY deleted_at DESC LIMIT 200").bind(WORKSPACE_ID).all(),
      env.DB.prepare("SELECT id, created_at, user_email, action, entity, detail, state_version FROM security_audit WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 300").bind(WORKSPACE_ID).all(),
      env.DB.prepare("SELECT id, user_email, display_name, event, route, created_at, user_agent FROM access_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1000").bind(WORKSPACE_ID).all(),
    ]);
    return Response.json({ backups: backups.results, deleted: deleted.results, audits: audits.results, accesses: accesses.results, isMaster: isMaster(access) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("Security data read failed", error);
    return Response.json({ error: "Não foi possível carregar os dados de segurança." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!access.isOwner) return Response.json({ error: "Somente o proprietário pode executar esta ação." }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  try {
    const body = await request.json() as { action?: string; id?: string };
    const current = await env.DB.prepare("SELECT data, version FROM app_state WHERE workspace_id = ?").bind(WORKSPACE_ID).first<StateRow>();
    if (!current) return Response.json({ error: "A base de dados ainda não foi criada." }, { status: 404 });
    const state = await decodeStoredState<Record<string, unknown>>(current.data);

    if (body.action === "create_backup") {
      const backup = await createStateBackup(state, current.version, "Manual", access.user.email);
      await audit(access.user.email, "Backup manual", "seguranca", `Backup da versão ${current.version} criado.`, current.version);
      return Response.json({ ok: true, backup });
    }

    if (body.action === "restore_deleted") {
      const deleted = await env.DB.prepare("SELECT id, collection, record_id, data FROM deleted_records WHERE id = ? AND workspace_id = ? AND restored_at IS NULL").bind(String(body.id || ""), WORKSPACE_ID).first<{ id: string; collection: string; record_id: string; data: string }>();
      if (!deleted) return Response.json({ error: "Registro excluído não encontrado ou já restaurado." }, { status: 404 });
      const list = Array.isArray(state[deleted.collection]) ? [...state[deleted.collection] as unknown[]] : [];
      if (list.some((item) => String((item as Record<string, unknown>).id || "") === deleted.record_id)) return Response.json({ error: "Já existe um registro com o mesmo identificador." }, { status: 409 });
      await createStateBackup(state, current.version, "Antes de restaurar registro", access.user.email);
      list.push(JSON.parse(deleted.data));
      state[deleted.collection] = list;
      const validation = validateState(state);
      if (validation) return Response.json({ error: validation }, { status: 400 });
      const now = new Date().toISOString();
      const write = await env.DB.prepare("UPDATE app_state SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM document_removals WHERE workspace_id = app_state.workspace_id AND status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(await encodeStoredState(JSON.stringify(state)), now, access.user.email, WORKSPACE_ID, current.version).run();
      if (!write.meta.changes) return Response.json({ error: "A base mudou durante a restauração. Tente novamente." }, { status: 409 });
      await env.DB.prepare("UPDATE deleted_records SET restored_at = ?, restored_by = ? WHERE id = ? AND restored_at IS NULL").bind(now, access.user.email, deleted.id).run();
      await audit(access.user.email, "Registro restaurado", deleted.collection, `Registro ${deleted.record_id} restaurado da lixeira.`, current.version + 1);
      return Response.json({ ok: true, version: current.version + 1 });
    }

    if (body.action === "restore_backup") {
      if (!isMaster(access)) return Response.json({ error: "Somente o usuário Master pode restaurar um backup completo." }, { status: 403 });
      const backup = await env.DB.prepare("SELECT id, object_key, state_version FROM state_backups WHERE id = ? AND workspace_id = ?").bind(String(body.id || ""), WORKSPACE_ID).first<{ id: string; object_key: string; state_version: number }>();
      if (!backup) return Response.json({ error: "Backup não encontrado." }, { status: 404 });
      const object = await env.BUCKET.get(backup.object_key);
      if (!object) return Response.json({ error: "O arquivo deste backup não está disponível." }, { status: 404 });
      const restored = JSON.parse(await object.text()) as { state?: Record<string, unknown> };
      if (!restored.state) return Response.json({ error: "Backup inválido." }, { status: 400 });
      restored.state.users = state.users || [];
      const validation = validateState(restored.state);
      if (validation) return Response.json({ error: validation }, { status: 400 });
      await createStateBackup(state, current.version, "Antes de restaurar backup", access.user.email);
      const now = new Date().toISOString();
      const write = await env.DB.prepare("UPDATE app_state SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM document_removals WHERE workspace_id = app_state.workspace_id AND status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(await encodeStoredState(JSON.stringify(restored.state)), now, access.user.email, WORKSPACE_ID, current.version).run();
      if (!write.meta.changes) return Response.json({ error: "A base mudou durante a restauração. Tente novamente." }, { status: 409 });
      await audit(access.user.email, "Backup restaurado", "seguranca", `Backup da versão ${backup.state_version} restaurado; usuários atuais preservados.`, current.version + 1);
      return Response.json({ ok: true, version: current.version + 1 });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    console.error("Security action failed", error);
    return Response.json({ error: "Não foi possível concluir a ação de segurança." }, { status: 503 });
  }
}
