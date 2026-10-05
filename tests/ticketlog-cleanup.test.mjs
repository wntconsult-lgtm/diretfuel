import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cleanupPreviousTicketlogImports } from '../lib/directfuel-ticketlog-cleanup.ts';

test('cleanup preserves new imports and other workspaces, archives old data, and runs once', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE ticketlog_fuelings (id TEXT, workspace_id TEXT, imported_at TEXT, occurred_on TEXT);
    CREATE TABLE security_audit (id TEXT PRIMARY KEY, workspace_id TEXT, created_at TEXT, user_email TEXT, action TEXT, entity TEXT, detail TEXT, state_version INTEGER);
    INSERT INTO ticketlog_fuelings VALUES ('old','vixpar','2026-09-07T12:00:00.000Z','2026-08-01'),
    ('today','vixpar','2026-09-10T03:00:00.000Z','2026-08-01'),
    ('future','vixpar','2026-09-11T12:00:00.000Z','2026-08-01'),
    ('other','another','2026-09-07T12:00:00.000Z','2026-08-01');`);
  const db = {
    prepare(query) { return { bind(...args) { return {
      async first() { return sql.prepare(query).get(...args); },
      async all() { return { results: sql.prepare(query).all(...args) }; },
      run() { return sql.prepare(query).run(...args); },
    }; } }; },
    async batch(statements) { sql.exec('BEGIN'); try { const result = statements.map(s => s.run()); sql.exec('COMMIT'); return result; } catch(e) { sql.exec('ROLLBACK'); throw e; } },
  };
  const archives = [];
  const bucket = { async put(key, data) { archives.push(JSON.parse(data)); } };
  const access = { isOwner: true, user: { email: 'owner@example.com' } };
  await cleanupPreviousTicketlogImports(db, bucket, { ...access, isOwner: false });
  assert.equal(archives.length, 0);
  await assert.rejects(cleanupPreviousTicketlogImports(db, { async put() { throw Error('unavailable'); } }, access));
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM ticketlog_fuelings').get().n, 4);
  await cleanupPreviousTicketlogImports(db, bucket, access);
  assert.deepEqual(archives[0].records.map(x => x.id), ['old']);
  assert.deepEqual(sql.prepare('SELECT id FROM ticketlog_fuelings ORDER BY id').all().map(x => x.id), ['future', 'other', 'today']);
  await cleanupPreviousTicketlogImports(db, bucket, access);
  assert.equal(archives.length, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM security_audit').get().n, 1);
  sql.close();
});
