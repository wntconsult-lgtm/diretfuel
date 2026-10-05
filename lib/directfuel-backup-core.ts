// Dependencies are injected so the exact production flow can be exercised with SQLite.
export async function createVerifiedBackup(db: D1Database, bucket: R2Bucket, workspace: string, state: Record<string, unknown>, version: number, reason: string, email: string, validate: (state: unknown) => string | null | undefined) {
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const objectKey = `${workspace}/security-backups/${now.slice(0, 10)}/${now.replace(/[:.]/g, "-")}-v${version}-${id}.json`;
  const serialized = JSON.stringify({ workspaceId: workspace, version, createdAt: now, createdBy: email, reason, state });
  const size = new TextEncoder().encode(serialized).byteLength;
  const validation = validate(state);
  if (validation) throw new Error(`Backup não restaurável: ${validation}`);
  await bucket.put(objectKey, serialized, { httpMetadata: { contentType: 'application/json' } });
  const saved = await bucket.get(objectKey);
  if (!saved || await saved.text() !== serialized) throw new Error('A leitura do backup não confere com a gravação. Nenhum backup antigo foi removido.');
  const restored = JSON.parse(serialized);
  if (validate(restored.state)) throw new Error('Falha na validação de restauração.');
  await db.prepare('INSERT INTO state_backups (id, workspace_id, state_version, object_key, reason, created_at, created_by, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, workspace, version, objectKey, reason, now, email, size).run();
  const registered = await db.prepare('SELECT id FROM state_backups WHERE id = ? AND workspace_id = ?').bind(id, workspace).first();
  if (!registered) throw new Error('Backup não registrado para restauração.');
  async function log(action: string, detail: unknown) {
    await db.prepare('INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace, new Date().toISOString(), email, action, 'backups', JSON.stringify(detail), version).run();
  }
  // A durable creation log is required before any destructive step.
  await log('Backup validado', { backupCriado: id, objectKey, createdAt: now, bytes: size, restauracaoValidada: true });
  const removed: string[] = [], failures: string[] = [];
  let freedBytes = 0;
  try {
    // SQLite serializes acquisition; only one rotation may delete at a time.
    await db.prepare('CREATE TABLE IF NOT EXISTS backup_rotation_lock (workspace_id TEXT PRIMARY KEY, token TEXT, expires_at TEXT)').run();
    const token = crypto.randomUUID();
    const lock = await db.prepare('INSERT INTO backup_rotation_lock (workspace_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE backup_rotation_lock.expires_at < ?').bind(workspace, token, new Date(Date.now() + 600000).toISOString(), new Date().toISOString()).run();
    if (!lock.meta.changes) {
      await log('Retenção adiada', { backupCriado: id, motivo: 'Outra rotação em andamento; nova tentativa no próximo backup.' });
      return { id, objectKey, createdAt: now, stateVersion: version, reason, removed, freedBytes, pending: true };
    }
    try {
      const rows = await db.prepare('SELECT id, object_key, size_bytes FROM state_backups WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 5').bind(workspace).all<{id: string; object_key: string; size_bytes: number}>();
      for (const row of rows.results) {
        try {
          // Recheck both the lease and newest five immediately before each deletion.
          const owned = await db.prepare('SELECT token FROM backup_rotation_lock WHERE workspace_id = ? AND token = ? AND expires_at > ?').bind(workspace, token, new Date(Date.now() + 30000).toISOString()).first();
          if (!owned) throw new Error('Prazo de rotação expirado; tentar no próximo backup.');
          const protectedRows = await db.prepare('SELECT id FROM state_backups WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 5').bind(workspace).all<{id: string}>();
          if (protectedRows.results.some(x => x.id === row.id) || row.id === id) continue;
          if (!row.object_key.startsWith(`${workspace}/security-backups/`)) throw new Error('Arquivo fora do diretório de backups.');
          const object = await bucket.head(row.object_key);
          const bytes = object?.size || 0;
          await log('Remoção de backup iniciada', { backupCriado: id, backupAntigo: row.id, bytes });
          await bucket.delete(row.object_key);
          if (await bucket.head(row.object_key)) throw new Error('Arquivo ainda presente após exclusão.');
          await db.prepare('DELETE FROM state_backups WHERE id = ? AND workspace_id = ?').bind(row.id, workspace).run();
          removed.push(row.id); freedBytes += bytes;
          await log('Backup antigo removido', { backupCriado: id, backupAntigo: row.id, espacoLiberadoBytes: bytes });
        } catch (error) {
          failures.push(row.id);
          await log('Falha na retenção de backup', { backupCriado: id, backupAntigo: row.id, erro: String(error), novaTentativa: 'Próximo backup manual ou automático' });
        }
      }
    } finally {
      await db.prepare('DELETE FROM backup_rotation_lock WHERE workspace_id = ? AND token = ?').bind(workspace, token).run();
    }
    await log('Retenção de backups', { backupCriado: id, backupsRemovidos: removed, espacoLiberadoBytes: freedBytes, falhas: failures, limite: 5 });
  } catch (error) {
    // A cleanup failure must never turn a valid newly created backup into a failed backup.
    console.error('Retenção pendente', error);
    try { await log('Falha na retenção de backup', { backupCriado: id, erro: String(error), backupsRemovidos: removed, espacoLiberadoBytes: freedBytes }); } catch (auditError) { console.error('Falha ao registrar retenção', auditError); }
    return { id, objectKey, createdAt: now, stateVersion: version, reason, removed, freedBytes, pending: true };
  }
  return { id, objectKey, createdAt: now, stateVersion: version, reason, removed, freedBytes, pending: failures.length > 0 };
}
