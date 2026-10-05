import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createVerifiedBackup } from '../lib/directfuel-backup-core.ts';
function fixture(n=53) {
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE state_backups(id TEXT PRIMARY KEY, workspace_id TEXT, state_version INTEGER, object_key TEXT, reason TEXT, created_at TEXT, created_by TEXT, size_bytes INTEGER); CREATE TABLE security_audit(id TEXT PRIMARY KEY, workspace_id TEXT, created_at TEXT, user_email TEXT, action TEXT, entity TEXT, detail TEXT, state_version INTEGER);`);
 const objects=new Map();
 for(let i=0;i<n;i++){const key=`vixpar/security-backups/old${i}`; objects.set(key,'old'); sql.prepare('INSERT INTO state_backups VALUES(?,?,?,?,?,?,?,?)').run(`old${i}`,'vixpar',i,key,'Diário',new Date(Date.UTC(2026,0,1,0,i)).toISOString(),'user',3);}
 const db={prepare(q){const make=(args=[])=>({bind(...args){return make(args)},async first(){return sql.prepare(q).get(...args)},async all(){return {results:sql.prepare(q).all(...args)}},async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:r.changes}}}});return make()}};
 const bucket={async put(k,v){objects.set(k,v)},async get(k){return objects.has(k)?{async text(){return objects.get(k)}}:null},async head(k){return objects.has(k)?{size:Buffer.byteLength(objects.get(k))}:null},async delete(k){objects.delete(k)}};
 const state={medicoes:[{id:'MED1'}],acordos:[{id:'AC1'}],docs:[{id:'NF1'}],abastecimentos:[{id:'AB1'}],users:[]};
 const run=(reason='Manual')=>createVerifiedBackup(db,bucket,'vixpar',state,42,reason,'owner@example.com',s=>Array.isArray(s.medicoes)?null:'invalid');
 return {sql,db,bucket,objects,state,run};
}
test('53 + safety backup becomes newest 5, exact restoration and log totals',async()=>{
 const f=fixture(), before=JSON.stringify(f.state); const r=await f.run('Limpeza inicial');
 assert.equal(r.removed.length,49);assert.equal(r.freedBytes,147);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM state_backups').get().n,5);
 assert.deepEqual(JSON.parse(f.objects.get(r.objectKey)).state,f.state);
 assert.equal(JSON.stringify(f.state),before);
 assert.deepEqual(f.sql.prepare("SELECT id FROM state_backups WHERE id LIKE 'old%' ORDER BY id").all().map(x=>x.id),['old49','old50','old51','old52']);
 const audit=f.sql.prepare("SELECT * FROM security_audit WHERE action='Retenção de backups'").get();assert.equal(audit.user_email,'owner@example.com');assert.equal(JSON.parse(audit.detail).espacoLiberadoBytes,147);
});
test('failed write or readback never removes old backups',async()=>{for(const failure of ['put','get']){const f=fixture(); f.bucket[failure]=async()=>{throw Error('fail')};await assert.rejects(f.run());assert.equal(f.sql.prepare('SELECT count(*) n FROM state_backups').get().n,53)}});
test('deletion failure preserves valid new backup and retries on next automatic backup',async()=>{
 const f=fixture(); const del=f.bucket.delete; f.bucket.delete=async()=>{throw Error('fail')}; const r=await f.run();assert.equal(r.pending,true);assert.ok(f.objects.has(r.objectKey));assert.equal(f.sql.prepare('SELECT count(*) n FROM state_backups').get().n,54);
 f.bucket.delete=del;const r2=await f.run('Diário');assert.equal(r2.pending,false);assert.equal(f.sql.prepare('SELECT count(*) n FROM state_backups').get().n,5);
});
test('fewer than five retained, distinct object names and concurrent creation',async()=>{
 const f=fixture(0);await Promise.all([f.run(),f.run('Diário')]);assert.equal(f.objects.size,2);assert.equal(f.sql.prepare('SELECT count(*) n FROM state_backups').get().n,2);
});
test('invalid restore payload never starts rotation',async()=>{const f=fixture();f.state.medicoes=null;await assert.rejects(f.run());assert.equal(f.objects.size,53)});
