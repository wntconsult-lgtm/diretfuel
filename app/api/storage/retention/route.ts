import { env } from "cloudflare:workers";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";
import { createStateBackup } from "@/lib/directfuel-backup";
import { planDocumentRetention } from "@/lib/directfuel-document-retention";
import { STATE_LIMIT_BYTES } from "@/lib/directfuel-storage";
import { decodeStoredState, encodeStoredState } from "@/lib/directfuel-state-codec";

export const dynamic = "force-dynamic";
type StateRow = { data: string; version: number };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function documentBytes(ids: string[], type: "pdf" | "xml") {
  const sizes = await Promise.all(ids.map(async id => (await env.BUCKET.head(`${WORKSPACE_ID}/danfes/${id}.${type}`))?.size || 0));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function preview(row: StateRow, email: string) {
  const state = await decodeStoredState<Record<string, unknown>>(row.data);
  const plan = planDocumentRetention(state, new Date(), email);
  const documentBytesValue = await documentBytes(plan.pdfIds, "pdf") + await documentBytes(plan.xmlIds, "xml");
  return { version: row.version, retentionDays: plan.retentionDays, policy: plan.policy, cutoff: plan.cutoff, notes: plan.notes, measurements: plan.measurements, documents: plan.pdfIds.length + plan.xmlIds.length, documentBytes: documentBytesValue, stateBytesBefore: plan.beforeBytes, stateBytesAfter: plan.afterBytes, stateBytesSaved: plan.savedBytes, limitBytes: STATE_LIMIT_BYTES };
}

export async function GET() {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!access.isOwner) return Response.json({ error: "Somente o proprietário pode analisar a retenção." }, { status: 403 });
  const row = await env.DB.prepare("SELECT data, version FROM app_state WHERE workspace_id = ?").bind(WORKSPACE_ID).first<StateRow>();
  if (!row) return Response.json({ error: "Base operacional não encontrada." }, { status: 404 });
  return Response.json(await preview(row, access.user.email), { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!access.isOwner) return Response.json({ error: "Somente o proprietário pode executar a retenção." }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { version?: unknown; confirmation?: unknown };
  if (body.confirmation !== "ARQUIVAR DANFES" || !Number.isInteger(body.version)) return Response.json({ error: "Confirmação de segurança inválida." }, { status: 400 });
  const row = await env.DB.prepare("SELECT data, version FROM app_state WHERE workspace_id = ?").bind(WORKSPACE_ID).first<StateRow>();
  if (!row) return Response.json({ error: "Base operacional não encontrada." }, { status: 404 });
  if (row.version !== Number(body.version)) return Response.json({ error: "A base foi alterada. Analise novamente antes de executar.", conflict: true }, { status: 409 });
  const previous = await decodeStoredState<Record<string, unknown>>(row.data);
  const now = new Date();
  const plan = planDocumentRetention(previous, now, access.user.email);
  if (!plan.notes) return Response.json({ ok: true, ...await preview(row, access.user.email), removedDocuments: 0 });
  await createStateBackup(previous, row.version, "Antes da retenção de DANFEs", access.user.email);
  const nextVersion = row.version + 1;
  const auditId = crypto.randomUUID();
  const audit = { id: auditId, data: now.toISOString(), usuario: access.user.email, acao: "Retenção", entidade: "Documentos fiscais", detalhe: `${plan.notes} NF(s) tratadas conforme a política; ${plan.pdfIds.length + plan.xmlIds.length} documento(s) programados para remoção`, version: nextVersion };
  plan.state.audit = [audit, ...(Array.isArray(plan.state.audit) ? plan.state.audit : [])].slice(0, 300);
  const serialized = JSON.stringify(plan.state);
  const stored = await encodeStoredState(serialized);
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM app_state WHERE workspace_id = ? AND version = ?)").bind(auditId, WORKSPACE_ID, now.toISOString(), access.user.email, audit.acao, audit.entidade, audit.detalhe, nextVersion, WORKSPACE_ID, row.version),
    env.DB.prepare("UPDATE app_state SET data = ?, version = ?, updated_at = ?, updated_by = ? WHERE workspace_id = ? AND version = ? AND NOT EXISTS (SELECT 1 FROM document_removals WHERE workspace_id = app_state.workspace_id AND status = 'pending' AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(stored, nextVersion, now.toISOString(), access.user.email, WORKSPACE_ID, row.version),
  ]);
  if (!result[1].meta.changes) return Response.json({ error: "A base foi alterada durante a execução. Tente novamente.", conflict: true }, { status: 409 });
  const objects = [...plan.pdfIds.map(id => `${WORKSPACE_ID}/danfes/${id}.pdf`), ...plan.xmlIds.map(id => `${WORKSPACE_ID}/danfes/${id}.xml`)];
  let removedDocuments = 0;
  for (let index = 0; index < objects.length; index += 1000) {
    const batch = objects.slice(index, index + 1000);
    if (batch.length) { await env.BUCKET.delete(batch); removedDocuments += batch.length; }
  }
  return Response.json({ ok: true, version: nextVersion, notes: plan.notes, measurements: plan.measurements, removedDocuments, stateBytesSaved: plan.savedBytes });
}
