import { env } from "cloudflare:workers";
import { requireVixparUser, WORKSPACE_ID } from "@/lib/directfuel-access";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const access = await requireVixparUser();
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  if (!access.isOwner) return Response.json({ error: "Somente o proprietário pode zerar todos os documentos." }, { status: 403 });
  try {
    let cursor: string | undefined;
    let removed = 0;
    do {
      const page = await env.BUCKET.list({ prefix: `${WORKSPACE_ID}/danfes/`, cursor });
      const keys = page.objects.map((item) => item.key);
      if (keys.length) {
        await env.BUCKET.delete(keys);
        removed += keys.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return Response.json({ ok: true, removed });
  } catch (error) {
    console.error("DirectFuel document reset failed", error);
    return Response.json({ error: "Não foi possível remover todos os documentos." }, { status: 503 });
  }
}
