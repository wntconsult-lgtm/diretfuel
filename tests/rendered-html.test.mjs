import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
const root = fileURLToPath(new URL('..', import.meta.url));
const server = path.join(root, 'dist/server');
async function modules(dir) {
  const entries = await readdir(dir, {withFileTypes:true});
  const result=[];
  for(const entry of entries) {
    const name=path.join(dir,entry.name);
    if(entry.isDirectory()) result.push(...await modules(name));
    else if(entry.name.endsWith('.js')) result.push({type:'ESModule',path:name});
  }
  return result;
}
const files = await modules(server);
files.sort((a,b)=>Number(b.path===path.join(server,'index.js'))-Number(a.path===path.join(server,'index.js')));
// Isolated workerd runtime and disposable D1/R2. No production URL or data.
const runtime = new Miniflare({modules:files,modulesRoot:server,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})}});
after(()=>runtime.dispose());
const db=await runtime.getD1Database('DB');
for(const name of (await readdir(path.join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()) {
 const sql=await readFile(path.join(root,'drizzle',name),'utf8');
 const statements=sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
 for(const statement of statements) await db.prepare(statement).run();
}
// The deployed gateway supplies these headers. They are synthetic only in this runtime.
const owner={'oai-authenticated-user-email':'wnt.consult@gmail.com','content-type':'application/json'};
const initial={postos:[],frota:[],produtos:[],acordos:[],abastecimentos:[],medicoes:[],users:[],config:{params:{}}};
await db.prepare('INSERT INTO app_state (workspace_id,data,version,updated_at,updated_by) VALUES (?,?,?,?,?)').bind('vixpar',JSON.stringify(initial),1,'2026-09-10T00:00:00Z','test').run();
const call=(route,options={})=>runtime.dispatchFetch('http://unit.test'+route,options);
test('unauthenticated state API rejects access',async()=>assert.equal((await call('/api/state')).status,401));
test('actual Worker renders DirectFuel and shares version with state API',async()=>{
 const response=await call('/',{headers:owner}); assert.equal(response.status,200);
 const html=await response.text(); assert.match(html,/DirectFuel Vixpar/);
 const state=await (await call('/api/state',{headers:owner})).json();
 assert.ok(state.applicationVersion); assert.ok(html.includes(`data-version="${state.applicationVersion}"`));
});
test('Ticketlog reads empty database without SQL errors',async()=>{
 const response=await call('/api/ticketlog',{headers:owner});assert.equal(response.status,200);const data=await response.json();assert.equal(data.summary.records,0);assert.equal(data.pendingPlates.length,0);
});
test('Ticketlog pending plates normalize and aggregate without losing liters',async()=>{
 for(const [id,plate,liters] of [['1','ABC-1234',100],['2','ABC1234',200]]) await db.prepare("INSERT INTO ticketlog_fuelings (id,workspace_id,transaction_code,occurred_on,plate,service,liters,station_code,station_name,vehicle_link_status,import_batch_id,imported_at,imported_by) VALUES (?, 'vixpar', ?, '2026-09-10', ?, 'Abastecimento', ?, 'TEST', 'TEST STATION', 'Pendente', 'TEST', '2026-09-10T12:00:00Z', 'test')").bind(id,id,plate,liters).run();
 const response=await call('/api/ticketlog',{headers:owner});assert.equal(response.status,200);const data=await response.json();assert.equal(data.summary.records,2);assert.equal(data.pendingPlates.length,1);assert.equal(data.pendingPlates[0].plate,'ABC1234');assert.equal(data.pendingPlates[0].liters,300);
});
test('stale state writes return conflict and preserve existing data',async()=>{
 const response=await call('/api/state',{method:'PUT',headers:owner,body:JSON.stringify({state:initial,version:0})});assert.equal(response.status,409);assert.equal((await (await call('/api/state',{headers:owner})).json()).version,1);
});
test('simultaneous updates cannot silently overwrite one another',async()=>{
 const options={method:'PUT',headers:owner,body:JSON.stringify({state:initial,version:1})};
 const replies=await Promise.all([call('/api/state',options),call('/api/state',options)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
});
test('manual station review requires admin permission',async()=>{
 const response=await call('/api/geo-analysis',{method:'POST',headers:{...owner,'oai-authenticated-user-email':'unknown@example.test'},body:JSON.stringify({action:'review-station',stationCode:'TEST',mode:'different',reason:'test'})});assert.equal(response.status,403);
});

test('volume audit simulation is read-only, parameters are versioned and manual treatment survives recalculation',async()=>{
 const request=(action,extra={})=>call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action,...extra})});
 const config=await (await call('/api/volume-audit',{headers:owner})).json();assert.equal(config.version,0);
 const simulated=await request('simulate',{parameters:config.parameters});assert.equal(simulated.status,200);assert.equal((await (await call('/api/volume-audit',{headers:owner})).json()).version,0);
 const bad=structuredClone(config.parameters);bad.capacidade.atencaoAte=50;assert.equal((await request('save',{parameters:bad,version:0})).status,400);
 const next=structuredClone(config.parameters);next.capacidade.normalAte=65;
 const saved=await request('save',{parameters:next,version:0});assert.equal(saved.status,200);assert.equal((await saved.json()).version,1);
 assert.equal((await request('save',{parameters:next,version:0})).status,409);
 const history=await (await request('history')).json();assert.equal(history.history.length,1);assert.equal(JSON.parse(history.history[0].changes)[0].before,80);
 const result=await (await request('calculate')).json();assert.ok(result.rows.length);const key=result.rows[0].key;
 assert.equal((await request('review',{key,status:'Justificado',observation:'Conferido',updatedAt:null})).status,200);
 const again=await (await request('calculate')).json();assert.equal(again.rows.find(r=>r.key===key).review.observation,'Conferido');
 assert.equal((await request('review',{key,status:'Pendente',observation:'',updatedAt:null})).status,409);
});
test('volume audit rejects unauthorized requests',async()=>assert.equal((await call('/api/volume-audit')).status,401));
test('Ticketlog time import updates existing rows without duplicates and preserves reviews',async()=>{
 const record={transactionCode:'TIME-1',occurredOn:'2026-09-10',plate:'ABC1234',stationCode:'TEST',stationName:'TEST',liters:300,service:'Abastecimento',product:'DIESEL'};
 const send=async r=>{const response=await call('/api/ticketlog',{method:'POST',headers:owner,body:JSON.stringify({action:'import',kind:'fuelings',batchId:'time-test',records:[r]})});assert.equal(response.status,200);return response.json();};
 assert.equal((await send(record)).imported,1);
 let r=await send({...record,occurredTime:'19:47:47'});assert.equal(r.updated,1);assert.equal(r.imported,0);assert.equal(r.duplicated,0);
 r=await send({...record,occurredTime:'19:47:47'});assert.equal(r.updated,0);assert.equal(r.duplicated,1);
 r=await send({...record,occurredTime:''});assert.equal(r.updated,0);
 assert.equal((await db.prepare("SELECT occurred_time FROM ticketlog_fuelings WHERE transaction_code='TIME-1'").first()).occurred_time,'19:47:47');
 r=await send({...record,occurredTime:'25:61:00'});assert.equal(r.rejected,1);
 r=await send({...record,liters:900,occurredTime:'10:00:00'});assert.equal(r.updated,0);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM ticketlog_fuelings WHERE transaction_code='TIME-1'").first()).n,1);
 r=await send({...record,transactionCode:'TIME-2',occurredTime:'00:00:00'});assert.equal(r.imported,1);assert.equal(r.updated,0);
 const finish=await call('/api/ticketlog',{method:'POST',headers:owner,body:JSON.stringify({action:'finish',kind:'fuelings',batchId:'time-test',totals:{imported:2,updated:1,duplicated:2,rejected:1}})});assert.equal(finish.status,200);
 assert.equal((await db.prepare("SELECT updated FROM ticketlog_import_batches WHERE id='time-test'").first()).updated,1);
 const calc=await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'calculate'})});const data=await calc.json();assert.equal(data.rows.find(r=>r.key==='ticket:TIME-1').hora,'19:47:47');assert.equal(data.rows.find(r=>r.key==='ticket:TIME-1').productGroup,'Diesel');
});
test('Ticketlog deletes one fueling or a complete batch and clears linked audit reviews',async()=>{
 await db.prepare("INSERT INTO ticketlog_import_batches (id,workspace_id,kind,filename,imported,duplicated,updated,rejected,created_at,created_by) VALUES ('delete-batch','vixpar','fuelings','carga_errada.csv',2,0,0,0,'2026-09-11T10:00:00Z','test')").run();
 for(const [id,transaction,liters] of [['delete-one','DELETE-TX-1',125],['delete-two','DELETE-TX-2',275]]) await db.prepare("INSERT INTO ticketlog_fuelings (id,workspace_id,transaction_code,occurred_on,plate,service,product,liters,station_code,station_name,vehicle_link_status,import_batch_id,imported_at,imported_by) VALUES (?, 'vixpar', ?, '2026-09-11', 'DEL1A23', 'Abastecimento', 'DIESEL', ?, 'DELETE-STATION', 'POSTO TESTE', 'Pendente', 'delete-batch', '2026-09-11T10:00:00Z', 'test')").bind(id,transaction,liters).run();
 await db.prepare("INSERT INTO volume_reviews (id,workspace_id,record_key,status,observation,updated_at,updated_by) VALUES ('delete-review','vixpar','ticket:DELETE-TX-2','Justificado','teste','2026-09-11T10:01:00Z','test')").run();
 const before=await (await call('/api/ticketlog',{headers:owner})).json(),batch=before.batches.find(x=>x.id==='delete-batch');assert.equal(batch.current_records,2);assert.equal(batch.current_liters,400);assert.equal(before.canDelete,true);
 const filtered=await (await call('/api/ticketlog?fuelingFrom=2026-09-11&fuelingTo=2026-09-11&batchFrom=2026-09-11&batchTo=2026-09-11',{headers:owner})).json();assert.ok(filtered.recent.length>=2);assert.ok(filtered.recent.every(x=>x.occurred_on==='2026-09-11'));assert.ok(filtered.batches.length>=1);assert.ok(filtered.batches.every(x=>x.created_at.startsWith('2026-09-11')));
 assert.equal((await call('/api/ticketlog?fuelingFrom=2026-09-12&fuelingTo=2026-09-11',{headers:owner})).status,400);assert.equal((await call('/api/ticketlog?batchFrom=2026-09-12&batchTo=2026-09-11',{headers:owner})).status,400);
 const individual=await call('/api/ticketlog',{method:'POST',headers:owner,body:JSON.stringify({action:'delete-fueling',fuelingId:'delete-one'})});assert.equal(individual.status,200);assert.equal((await individual.json()).deleted,1);assert.equal((await db.prepare("SELECT COUNT(*) n FROM ticketlog_fuelings WHERE id='delete-one'").first()).n,0);
 const whole=await call('/api/ticketlog',{method:'POST',headers:owner,body:JSON.stringify({action:'delete-batch',batchId:'delete-batch'})});assert.equal(whole.status,200);const deleted=await whole.json();assert.equal(deleted.deleted,1);assert.equal(deleted.liters,275);assert.equal((await db.prepare("SELECT COUNT(*) n FROM ticketlog_fuelings WHERE import_batch_id='delete-batch'").first()).n,0);assert.equal((await db.prepare("SELECT COUNT(*) n FROM ticketlog_import_batches WHERE id='delete-batch'").first()).n,0);assert.equal((await db.prepare("SELECT COUNT(*) n FROM volume_reviews WHERE id='delete-review'").first()).n,0);
 assert.equal((await call('/api/ticketlog',{method:'POST',headers:owner,body:JSON.stringify({action:'delete-batch',batchId:'delete-batch'})})).status,404);
});
test('simplified audit exposes provenance and related sources, and isolates ARLA',async()=>{
 const old=await db.prepare("SELECT data FROM app_state WHERE workspace_id='vixpar'").first();const state=JSON.parse(old.data);
 state.produtos=[{id:'diesel',curta:'Diesel S10'},{id:'arla',curta:'ARLA 32'}];
 state.abastecimentos=[{id:'DIRECT-1',produtoId:'diesel',placa:'ABC1234',data:'2026-09-10',hora:'19:30:00',qt:100,total:600,postoId:'P1',motorista:'Teste'},{id:'DIRECT-ARLA',produtoId:'arla',placa:'ABC1234',data:'2026-09-10',hora:'19:35:00',qt:20,total:60,postoId:'P1'}];state.frota=[{placa:'ABC1234',capTanque:500}];
 await db.prepare("UPDATE app_state SET data=? WHERE workspace_id='vixpar'").bind(JSON.stringify(state)).run();
 const config=await (await call('/api/volume-audit',{headers:owner})).json();assert.deepEqual(Object.keys(config.parameters).sort(),['capacidade','janelasHoras']);
 const response=await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'calculate',filters:{auditType:'window',source:'Ticketlog',product:'Diesel'}})});assert.equal(response.status,200);const result=await response.json();assert.ok(result.rows.every(r=>r.fonte==='Ticketlog'&&r.productGroup==='Diesel'));
 const multiResponse=await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'calculate',filters:{auditType:'capacity',classification:['Normal','Crítico'],status:['Pendente','Justificado']}})});assert.equal(multiResponse.status,200);const multiResult=await multiResponse.json();assert.ok(multiResult.rows.length>0);assert.ok(multiResult.rows.every(r=>['Normal','Crítico'].includes(r.capacityClass)));assert.ok(multiResult.rows.every(r=>['Pendente','Justificado'].includes(r.review?.status||'Pendente')));
 const r=result.rows.find(r=>r.key==='ticket:TIME-1');assert.equal(r.reference,'TIME-1');assert.equal(r.windowClass,'Atenção');assert.ok(r.windows[0].members.some(a=>a.reference==='DIRECT-1'&&a.fonte==='DirectFuel'));assert.ok(r.windows.every(w=>w.members.every(a=>!a.produto.includes('ARLA'))));assert.equal('score'in r,false);
 const summaryResponse=await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'summary',filters:{from:'2026-09-10',to:'2026-09-10'}})});assert.equal(summaryResponse.status,200);const summaryResult=await summaryResponse.json();assert.equal('rows' in summaryResult,false);
 const full=await (await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'calculate',filters:{from:'2026-09-10',to:'2026-09-10'}})})).json();const unique=full.rows.filter(r=>!r.duplicate),flagged=unique.filter(r=>!["Normal","Não avaliada"].includes(r.capacityClass)||r.windowClass==='Atenção');assert.equal(summaryResult.summary.analisados,unique.length);assert.equal(summaryResult.summary.alertas,flagged.length);assert.equal(summaryResult.summary.repeticoes,unique.filter(r=>r.windowClass==='Atenção').length);
 assert.equal((await call('/api/volume-audit',{method:'POST',headers:owner,body:JSON.stringify({action:'summary',filters:{from:'2026-09-11',to:'2026-09-10'}})})).status,400);

 await db.prepare("UPDATE app_state SET data=? WHERE workspace_id='vixpar'").bind(old.data).run();
});
