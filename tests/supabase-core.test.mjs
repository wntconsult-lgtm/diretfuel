import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,prepareImport,prepareState} from '../supabase/functions/directfuel-api/handler.mjs';
import {inspectBackup,createMigration} from '../migration/pages/import.mjs';
const owner='owner@example.test', url='https://project.example.test', serviceKey='server-key-for-tests';
const access={isOwner:true,user:{email:owner},directFuelUser:{perfil:'Master',permissoes:['*'],acoes:['*']}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const req=(route,method='GET',body,headers={})=>new Request(`${url}/functions/v1/directfuel-api/${route}`,{method,headers:{authorization:'Bearer test-user-token',origin:'https://wntconsult-lgtm.github.io',...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
function mock(overrides={}) {
 const calls=[];
 const fetchImpl=async (target,options={})=>{
  calls.push({target,...options});
  if (target.endsWith('/auth/v1/user')) return json({id:'test-user-id',email:owner,email_confirmed_at:'2026-01-01',role:'authenticated'});
  const rpc=target.split('/rpc/')[1];
  if (overrides[rpc]) return overrides[rpc](JSON.parse(options.body));
  if (rpc==='directfuel_state_read') return json({state:null,version:0,user:{email:owner,name:'Owner',profile:'Master',permissions:['*'],actions:['*'],isOwner:true}});
  if (rpc==='directfuel_document') return json({revision:0});
  throw Error(`Unexpected ${target}`);
 };
 return {handler:createHandler({url,serviceKey,fetchImpl}),calls};
}
test('rejected origins and missing authentication never reach the upstream',async()=>{
 const {handler,calls}=mock();
 assert.equal((await handler(req('import','GET',null,{origin:'https://attacker.example.test'}))).status,403);
 assert.equal((await handler(req('import','GET',null,{authorization:''}))).status,401);
 assert.equal(calls.length,0);
});
test('version authenticates with lightweight owner context and never loads business state',async()=>{
 const {handler,calls}=mock(); assert.equal((await handler(req('version'))).status,200);
 assert.equal(calls.length,2); assert.ok(calls[1].target.endsWith('/directfuel_document'));
 assert.equal(JSON.parse(calls[1].body).p_action,'context');
 assert.equal(calls[0].headers.authorization,'Bearer test-user-token');
 assert.equal(calls[1].headers.authorization,`Bearer ${serviceKey}`);
});
test('an authenticated but inactive account cannot reach storage',async()=>{
 const {handler,calls}=mock({directfuel_document:()=>json({code:'PT403',message:'Acesso não autorizado.'},403)});
 assert.equal((await handler(req('documents/test-id'))).status,403);
 assert.equal(calls.length,2);
});
test('initial import preserves historical agreement numbers and original input',()=>{
 const state={abastecimentos:[],medicoes:[],acordos:[{id:'historical',numero:'AC-2024-0412',status:'Cancelado'}],users:[{id:'u',email:owner,perfil:'Usuário'}],audit:[{id:'old',acao:'historical'}]};
 const copy=structuredClone(state), result=prepareImport({},state,owner);
 assert.equal(result.acordos[0].numero,'AC-2024-0412'); assert.equal(result.users[0].perfil,'Master');
 assert.deepEqual(result.importedAuditHistory,state.audit); assert.equal(result.audit,undefined); assert.deepEqual(state,copy);
});
test('import rejects a filled destination, malformed backup, unsafe markup and duplicate IDs',()=>{
 const valid={abastecimentos:[],medicoes:[]};
 assert.throws(()=>prepareImport({produtos:[{id:'exists'}]},valid,owner),error=>error.status===409);
 assert.throws(()=>prepareImport({},[],owner),/backup geral/);
 assert.throws(()=>prepareImport({},{...valid,config:{value:'<script>alert(1)</script>'}},owner),/texto inválido/);
 assert.throws(()=>prepareImport({},{...valid,produtos:[{id:'dup'},{id:'dup'}]},owner),/duplicado/);
});
test('delta normalization cannot mutate the previous snapshot and cannot overwrite protected history',()=>{
 const previous={postos:[{id:'p',fantasia:'Test'}],importedAuditHistory:[{id:'history'}]}; const copy=structuredClone(previous);
 const result=prepareState(previous,{delta:{config:{replace:{theme:'test'}},importedAuditHistory:{replace:[]}}},access);
 assert.deepEqual(previous,copy); assert.equal(result.next.postos[0].codigo,'PST-0001'); assert.deepEqual(result.next.importedAuditHistory,copy.importedAuditHistory);
});
test('stale initial import cannot write; valid import uses the atomic import RPC',async()=>{
 const {handler,calls}=mock({directfuel_initial_import:args=>{assert.equal(args.p_version,0);return json({ok:true,version:1,backupId:'validated-backup'});}});
 assert.equal((await handler(req('import','POST',{version:2,backup:{abastecimentos:[],medicoes:[]}}))).status,409);
 assert.equal(calls.filter(c=>c.target.endsWith('/directfuel_initial_import')).length,0);
 const response=await handler(req('import','POST',{version:0,backup:{abastecimentos:[],medicoes:[]}}));
 assert.equal(response.status,200); assert.equal((await response.json()).backupId,'validated-backup');
});
test('write conflicts and internal errors do not reveal server credentials',async()=>{
 const {handler}=mock({directfuel_initial_import:()=>json({code:'PT409',message:'Concurrent write'},409)});
 const response=await handler(req('import','POST',{version:0,backup:{abastecimentos:[],medicoes:[]}}));
 assert.equal(response.status,409);assert.equal((await response.json()).conflict,true);
 const broken=createHandler({url,serviceKey,fetchImpl:async()=>{throw Error(serviceKey);}});
 const text=await (await broken(req('import'))).text(); assert.ok(!text.includes(serviceKey));
});
test('invalid PDF contents are rejected before storage access',async()=>{
 const {handler,calls}=mock();
 const request=new Request(`${url}/functions/v1/directfuel-api/documents/doc-id`,{method:'POST',headers:{authorization:'Bearer test-user-token','content-type':'application/pdf'},body:'not a PDF'});
 assert.equal((await handler(request)).status,415); assert.equal(calls.length,2);
});
test('backup inspection handles general exports and wrapped backups without injecting markup',()=>{
 const data={abastecimentos:[],medicoes:[],produtos:[{id:'x'}]};
 assert.equal(inspectBackup(JSON.stringify(data)).total,1);
 assert.equal(inspectBackup(JSON.stringify({state:data})).total,1);
 assert.throws(()=>inspectBackup('{'),/JSON válido/);
 assert.throws(()=>inspectBackup('{}'),/backup geral/);
});
test('frontend import sends a private user token and rejects missing sessions before upload',async()=>{
 const client={auth:{getSession:async()=>({data:{session:{access_token:'user-session'}}})}};
 const send=createMigration(client,url,'publishable',async(target,options)=>{
  assert.equal(target,`${url}/functions/v1/directfuel-api/import`);assert.equal(options.headers.authorization,'Bearer user-session');
  assert.equal(options.headers.apikey,'publishable');assert.equal(options.cache,'no-store');return json({version:1});
 });
 assert.equal((await send('POST',{version:0,backup:{abastecimentos:[],medicoes:[]}})).version,1);
 client.auth.getSession=async()=>({data:{session:null}});
 await assert.rejects(send('GET'),/Entre novamente/);
});
