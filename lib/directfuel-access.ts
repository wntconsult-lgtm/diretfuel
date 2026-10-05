import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";
import { decodeStoredState } from "@/lib/directfuel-state-codec";

export const WORKSPACE_ID = "vixpar";
export const OWNER_EMAILS = new Set(["wnt.consult@gmail.com"]);

export async function recordAccess(input: { email: string; displayName?: string; event: "Acesso autorizado" | "Acesso recusado"; route?: string; userAgent?: string }) {
  const now = new Date().toISOString();
  const retention = new Date(Date.now() - 180 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO access_logs (id, workspace_id, user_email, display_name, event, route, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), WORKSPACE_ID, input.email.toLowerCase(), input.displayName || null, input.event, input.route || "/", now, input.userAgent?.slice(0, 500) || null),
    env.DB.prepare("DELETE FROM access_logs WHERE workspace_id = ? AND created_at < ?").bind(WORKSPACE_ID, retention),
  ]);
}

export async function requireVixparUser() {
  const user = await getChatGPTUser();
  if (!user) return { error: "Faça login no ChatGPT para acessar o DirectFuel.", status: 401 } as const;
  const email = user.email.toLowerCase();
  if (OWNER_EMAILS.has(email)) {
    return { user, directFuelUser: { email, perfil: "Master", permissoes: ["*"], acoes: ["*"], ativo: true }, isOwner: true } as const;
  }
  try {
    const row = await env.DB.prepare(
      "SELECT data FROM app_state WHERE workspace_id = ?"
    ).bind(WORKSPACE_ID).first<{ data: string }>();
    const state = row?.data ? await decodeStoredState<{ users?: Array<Record<string, unknown>> }>(row.data) : null;
    const directFuelUser = state?.users?.find((candidate) =>
      String(candidate.email || "").toLowerCase() === email && candidate.ativo !== false
    );
    if (!directFuelUser) {
      return { error: "Seu e-mail ainda não foi cadastrado por um administrador do DirectFuel.", status: 403 } as const;
    }
    return { user, directFuelUser, isOwner: false } as const;
  } catch (error) {
    console.error("DirectFuel authorization failed", error);
    return { error: "Não foi possível validar seu acesso agora.", status: 503 } as const;
  }
}
