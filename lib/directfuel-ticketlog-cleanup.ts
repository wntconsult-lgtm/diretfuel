// One-time maintenance authorized by the owner on 10/09/2026.
// Cut by import date (Brazil), never by the date of the fueling.
export const TICKETLOG_CLEANUP_ID = "ticketlog-cleanup-before-2026-09-10";
const CUTOFF = "2026-09-10T03:00:00.000Z";

export async function cleanupPreviousTicketlogImports(
  db: D1Database,
  bucket: R2Bucket,
  access: { isOwner: boolean; user: { email: string } },
) {
  if (!access.isOwner) return;
  const completed = await db.prepare("SELECT id FROM security_audit WHERE id = ? AND workspace_id = ?")
    .bind(TICKETLOG_CLEANUP_ID, "vixpar").first();
  if (completed) return;

  const old = await db.prepare("SELECT * FROM ticketlog_fuelings WHERE workspace_id = ? AND imported_at < ?")
    .bind("vixpar", CUTOFF).all<Record<string, unknown>>();
  const now = new Date().toISOString();
  const objectKey = `vixpar/security-backups/ticketlog/${TICKETLOG_CLEANUP_ID}-${crypto.randomUUID()}.json`;
  // A failed archive stops the cleanup before any deletion.
  await bucket.put(objectKey, JSON.stringify({ cutoff: CUTOFF, createdAt: now, createdBy: access.user.email, records: old.results }),
    { httpMetadata: { contentType: "application/json" } });

  // D1 batch is transactional: the removal and completion marker succeed together.
  // Historical import receipts remain as an audit trail; operational records go away.
  await db.batch([
    db.prepare("DELETE FROM ticketlog_fuelings WHERE workspace_id = ? AND imported_at < ? AND NOT EXISTS (SELECT 1 FROM security_audit WHERE id = ? AND workspace_id = ?)")
      .bind("vixpar", CUTOFF, TICKETLOG_CLEANUP_ID, "vixpar"),
    db.prepare("INSERT OR IGNORE INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(TICKETLOG_CLEANUP_ID, "vixpar", now, access.user.email, "Limpeza das cargas anteriores", "Abastecimentos Ticketlog",
        `${old.results.length} registros importados antes de 10/09/2026 retirados da base operacional. Cargas de 10/09 em diante, cadastros e acordos preservados. Arquivo de recuperação: ${objectKey}`, 0),
  ]);
}
