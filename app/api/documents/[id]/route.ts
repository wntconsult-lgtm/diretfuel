import { env } from "cloudflare:workers";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";
import { hasAction, hasPermission } from "@/lib/directfuel-security";

export const dynamic = "force-dynamic";
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function safeId(value: string) {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}

function documentType(request: Request, contentType = "") {
  const requested = new URL(request.url).searchParams.get("type");
  return requested === "xml" || contentType.includes("xml") ? "xml" as const : "pdf" as const;
}

function objectKey(id: string, type: "pdf" | "xml") {
  return `${WORKSPACE_ID}/danfes/${id}.${type}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!hasAction(access, "documentos", "incluir")) return Response.json({ error: "Seu perfil não permite enviar documentos." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = safeId(rawId);
  if (!id) return Response.json({ error: "Documento inválido." }, { status: 400 });
  const contentType = request.headers.get("content-type") || "";
  const type = documentType(request, contentType);
  if (type === "pdf" && contentType !== "application/pdf") return Response.json({ error: "Envie um arquivo PDF ou XML de NF-e." }, { status: 415 });
  if (type === "xml" && !["application/xml", "text/xml", "application/octet-stream"].some((value) => contentType.includes(value))) return Response.json({ error: "Envie um XML de NF-e válido." }, { status: 415 });
  if (id.startsWith("NF_LAYOUT_") && await env.BUCKET.head(objectKey(id,type))) return Response.json({error:"O PDF de referência de um layout é imutável."},{status:409});
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return Response.json({ error: "O documento deve ter no máximo 20 MB." }, { status: 413 });
  if (type === "pdf" && (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")) return Response.json({ error: "O conteúdo enviado não é um PDF válido." }, { status: 415 });
  if (type === "xml") {
    const beginning = new TextDecoder().decode(bytes.slice(0, 1000));
    if (!/<(?:\w+:)?(?:nfeProc|NFe|infNFe)\b/i.test(beginning)) return Response.json({ error: "O XML não possui uma NF-e reconhecível." }, { status: 415 });
  }
  const key = objectKey(id, type);
  const token=crypto.randomUUID(), now=new Date().toISOString();
  const lock=await env.DB.prepare("INSERT INTO document_removals (object_key,workspace_id,status,token,expires_at,created_at,created_by,bytes,etag,detail) VALUES (?,?,'uploading',?,?,?,?,?,'','') ON CONFLICT(object_key) DO UPDATE SET status='uploading',token=excluded.token,expires_at=excluded.expires_at WHERE document_removals.status NOT IN ('pending','uploading') OR document_removals.expires_at < ?").bind(key,WORKSPACE_ID,token,new Date(Date.now()+300000).toISOString(),now,access.user.email,bytes.byteLength,now).run();
  if(!lock.meta.changes)return Response.json({error:"Arquivo em processamento. Tente novamente."},{status:409});
  try {
    await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type === "pdf" ? "application/pdf" : "application/xml" }, customMetadata: { uploadedBy: access.user.email, documentType: type } });
  } finally {
    await env.DB.prepare("DELETE FROM document_removals WHERE object_key=? AND token=?").bind(key,token).run();
  }
  return Response.json({ ok: true, path: key, type });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!hasPermission(access, "documentos")) return new Response("Seu perfil não permite acessar documentos.", { status: 403 });
  const { id: rawId } = await context.params;
  const id = safeId(rawId);
  if (!id) return new Response("Documento inválido.", { status: 400 });
  const type = documentType(request);
  const object = await env.BUCKET.get(objectKey(id, type));
  if (!object) return new Response("Documento não encontrado.", { status: 404 });
  return new Response(object.body, { headers: { "content-type": type === "pdf" ? "application/pdf" : "application/xml; charset=utf-8", "content-disposition": `${type === "pdf" ? "inline" : "attachment"}; filename="nota-fiscal-${id}.${type}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!hasAction(access, "documentos", "excluir")) return Response.json({ error: "Seu perfil não permite excluir documentos." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Origem da solicitação não autorizada." }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = safeId(rawId);
  if (!id) return Response.json({ error: "Documento inválido." }, { status: 400 });
  const type = documentType(request);
  if (id.startsWith("NF_LAYOUT_")) return Response.json({error:"Os PDFs de referência dos layouts são preservados no histórico."},{status:409});
  await env.BUCKET.delete(objectKey(id, type));
  return Response.json({ ok: true });
}
