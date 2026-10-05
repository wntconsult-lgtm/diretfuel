import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={exports:{},TextEncoder};vm.runInNewContext(transpile(fs.readFileSync('lib/directfuel-storage.ts','utf8')),helpers);
const {applyStateDelta,storageUsage}=helpers.exports;
const browser={window:{}};vm.runInNewContext(fs.readFileSync('public/directfuel-state-delta.js','utf8'),browser);const delta=browser.window.DirectFuelStateDelta.create;
test('record deltas round-trip edits, additions, removals, order and unkeyed arrays',()=>{
 const before={abastecimentos:[{id:'A',qt:2},{id:'B',qt:4}],stationReviews:[{code:'1'}],config:{value:3},gone:1};
 const after={abastecimentos:[{id:'C',qt:7},{id:'A',qt:3}],stationReviews:[{code:'2'}],config:{value:4}};
 assert.equal(JSON.stringify(applyStateDelta(before,delta(before,after))),JSON.stringify(after));
 assert.equal(before.abastecimentos[0].qt,2);
 assert.throws(()=>applyStateDelta(before,JSON.parse('{"__proto__":{"replace":{}}}')),/inválido/);
 assert.throws(()=>applyStateDelta(before,{abastecimentos:{upsert:[],remove:[],order:['A','A']}}),/inválida/);
});
test('backup edit sends only changed fueling and thresholds use UTF-8 bytes',()=>{
 const base={abastecimentos:Array.from({length:1651},(_,i)=>({id:String(i),description:'Abastecimento de teste '.repeat(8),qt:100}))};
 const next=structuredClone(base);next.abastecimentos[10].qt=101;
 const patch=delta(base,next);assert.equal(patch.abastecimentos.upsert.length,1);
 assert.ok(JSON.stringify(patch).length<JSON.stringify(next).length/100);
 assert.equal(storageUsage('á').bytes,2);
 for(const [bytes,level] of [[5599999,'normal'],[5600000,'warning'],[7200000,'critical'],[8000001,'critical']])assert.equal(storageUsage('x'.repeat(bytes)).level,level);
});
test('client never sends the server-owned audit collection',()=>{
 const before={config:{value:1},audit:[{id:'old'}]},after={config:{value:2},audit:[{id:'new'},{id:'old'}]};
 const patch=delta(before,after);assert.equal(patch.audit,undefined);assert.equal(JSON.stringify(patch.config),JSON.stringify({replace:{value:2}}));
});
function setup({failAudit=false,race=false}={}) {
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE app_state(workspace_id TEXT PRIMARY KEY,data TEXT,version INTEGER,updated_at TEXT,updated_by TEXT); CREATE TABLE security_audit(id TEXT PRIMARY KEY,workspace_id TEXT,created_at TEXT,user_email TEXT,action TEXT,entity TEXT,detail TEXT,state_version INTEGER); CREATE TABLE deleted_records(id TEXT PRIMARY KEY,workspace_id TEXT,collection TEXT,record_id TEXT,data TEXT,deleted_at TEXT,deleted_by TEXT)');
 const initial={abastecimentos:[{id:'A',qt:2}],users:[],audit:[]};sql.prepare('INSERT INTO app_state VALUES(?,?,?,?,?)').run('vixpar',JSON.stringify(initial),1,'old','owner');
 if(failAudit)sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON security_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
 const DB={prepare(query){return {args:[],bind(...args){this.args=args;return this},async first(){return sql.prepare(query).get(...this.args)||null},async all(){return {results:sql.prepare(query).all(...this.args)}},runSync(){return {meta:{changes:Number(sql.prepare(query).run(...this.args).changes)}}},async run(){return this.runSync()}}},async batch(statements){if(race)sql.prepare('UPDATE app_state SET version=2').run();sql.exec('BEGIN');try{const r=statements.map(s=>s.runSync());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
 const events=[{id:'E',acao:'Teste',entidade:'abastecimentos',detalhe:'Alteração'}];
 const scope={exports:{},env:{DB},Response,Request,URL,TextEncoder,crypto,console:{error(){}},APP_VERSION:'test',WORKSPACE_ID:'vixpar',OWNER_EMAILS:new Set(['owner']),requireVixparUser:async()=>({isOwner:true,user:{email:'owner'},directFuelUser:{}}),cleanupPreviousTicketlogImports:async()=>{},createStateBackup:async()=>{},ensureDailyBackup:async()=>{},decodeStoredState:async data=>JSON.parse(data),encodeStoredState:async data=>data,storedStateBytes:data=>new TextEncoder().encode(data).byteLength,D1_STATE_ROW_LIMIT_BYTES:1900000,hasPermission:()=>true,protectFiscalMappings:()=>null,assignAutomaticStationCodes(){},assignAutomaticAgreementNumbers(){},validateState:()=>null,validateBusinessRules:()=>null,authorizeChanges:()=>null,analyzeChanges:()=>[{collection:'abastecimentos',deleted:[]}],securityEvents:()=>events,...helpers.exports};
 const source=fs.readFileSync('app/api/state/route.ts','utf8').replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g,'');vm.runInNewContext(transpile(source),scope);
 const request=()=>new Request('https://site.test/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({delta:{abastecimentos:{upsert:[{id:'A',qt:3}],remove:[]}},version:1,applicationVersion:'test'})});
 return {sql,scope,request};
}
test('server ignores audit order from an older client',async()=>{const {sql,scope}=setup();const request=new Request('https://site.test/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({delta:{audit:{upsert:[{id:'new'}],remove:[],order:['new','missing']},abastecimentos:{upsert:[{id:'A',qt:3}],remove:[]}},version:1,applicationVersion:'test'})});const res=await scope.exports.PUT(request);assert.equal(res.status,200);assert.equal(JSON.parse(sql.prepare('SELECT data FROM app_state').get().data).abastecimentos[0].qt,3);sql.close()});
test('state save and audit commit together',async()=>{const {sql,scope,request}=setup();const res=await scope.exports.PUT(request());assert.equal(res.status,200);assert.equal(sql.prepare('SELECT version FROM app_state').get().version,2);assert.equal(sql.prepare('SELECT count(*) n FROM security_audit').get().n,1);assert.equal(JSON.parse(sql.prepare('SELECT data FROM app_state').get().data).abastecimentos[0].qt,3);sql.close()});
test('audit failure rolls back state write',async()=>{const {sql,scope,request}=setup({failAudit:true});assert.equal((await scope.exports.PUT(request())).status,503);assert.equal(sql.prepare('SELECT version FROM app_state').get().version,1);assert.equal(JSON.parse(sql.prepare('SELECT data FROM app_state').get().data).abastecimentos[0].qt,2);sql.close()});
test('concurrent version change creates neither false audit nor lost update',async()=>{const {sql,scope,request}=setup({race:true});assert.equal((await scope.exports.PUT(request())).status,409);assert.equal(sql.prepare('SELECT count(*) n FROM security_audit').get().n,0);assert.equal(JSON.parse(sql.prepare('SELECT data FROM app_state').get().data).abastecimentos[0].qt,2);sql.close()});
test('unchanged polling returns no data payload',async()=>{const {sql,scope}=setup();const res=await scope.exports.GET(new Request('https://site.test/api/state?version=1'));const body=await res.json();assert.equal(body.unchanged,true);assert.equal(body.state,undefined);sql.close()});
