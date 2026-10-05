import { createVerifiedBackup } from "./directfuel-backup-core";
import { validateState } from "./directfuel-security";
import { env } from "cloudflare:workers";
import { WORKSPACE_ID } from "@/lib/directfuel-access";

export async function createStateBackup(state: Record<string, unknown>, version: number, reason: string, email: string) {
  return createVerifiedBackup(env.DB, env.BUCKET, WORKSPACE_ID, state, version, reason, email, validateState);
}

export async function ensureDailyBackup(state: Record<string, unknown>, version: number, email: string) {
  const day = new Date().toISOString().slice(0, 10);
  const existing = await env.DB.prepare(`SELECT id FROM state_backups WHERE workspace_id = ? AND reason = 'Diário' AND created_at >= ? LIMIT 1`).bind(WORKSPACE_ID, `${day}T00:00:00.000Z`).first();
  if (!existing) return createStateBackup(state, version, "Diário", email);
  return null;
}
