import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {createGateway} from '../migration/pages/gateway.mjs';
const base='https://wntconsult-lgtm.github.io/diretfuel/app/',config={url:'https://project.example.test',publicKey:'publishable-for-test'};
const client={auth:{getSession:async()=>({data:{session:{access_token:'private-test-session'}}})}};
test('state delta writes preserve content and revision through the authenticated gateway',async()=>{
 const body={delta:{produtos:{upsert:[{id:'test-product',descricao:'Test'}],remove:[]}},version:1,applicationVersion:'231'};
 const gateway=createGateway(client,config,async(request,options)=>{
  assert.equal(request.url,`${config.url}/functions/v1/directfuel-api/state`);assert.equal(request.method,'PUT');
  assert.deepEqual(await request.json(),body);assert.equal(options.headers.get('authorization'),'Bearer private-test-session');
  assert.equal(options.headers.get('apikey'),config.publicKey);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  return Response.json({ok:true,version:2});
 },base);
 assert.equal((await (await gateway('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json()).version,2);
});
test('the gateway preserves requests, queries and binary uploads',async()=>{
 const contents='%PDF-test';const gateway=createGateway(client,config,async(request,options)=>{
  assert.equal(request.url,`${config.url}/functions/v1/directfuel-api/documents/test-id?type=pdf`);assert.equal(request.method,'POST');
  assert.equal(await request.text(),contents);assert.equal(options.headers.get('content-type'),'application/pdf');return Response.json({ok:true});
 },base);
 const request=new Request(new URL('/api/documents/test-id?type=pdf',base),{method:'POST',headers:{'content-type':'application/pdf'},body:contents});
 assert.equal((await gateway(request)).status,200);
});
test('session tokens never leak to external URLs or static files',async()=>{
 let calls=0;const noAuth={auth:{getSession:()=>{throw Error('Session must not be read');}}};
 const gateway=createGateway(noAuth,config,(input,init)=>{calls++;assert.equal(init,undefined);return Response.json({ok:true});},base);
 await gateway('https://external.example.test/api/state');await gateway('./directfuel-app.js');assert.equal(calls,2);
});
test('expired sessions cannot send an API request',async()=>{
 const gateway=createGateway({auth:{getSession:async()=>({data:{session:null}})}},config,()=>{throw Error('Must not fetch');},base);
 assert.equal((await gateway('/api/state')).status,401);
});
test('the static application has an empty seed and no operational browser persistence',async()=>{
 const js=await readFile(new URL('../dist/pages-preview/app/directfuel-app.js',import.meta.url),'utf8');
 const literal=js.slice(js.indexOf('const seed='),js.indexOf('\nlet db=load();'));
 const seed=vm.runInNewContext(literal+'\nseed;');
 for(const [key,value]of Object.entries(seed))if(Array.isArray(value))assert.equal(value.length,0,key);
 assert.doesNotMatch(js,/localStorage\.setItem\(DBKEY|AB1|FORN-001|admin@vix/);
});
test('every bootstrap dependency is present and valid; unsupported modules are not started',async()=>{
 const root=new URL('../dist/pages-preview/app/',import.meta.url),files=await readdir(root);
 const boot=await readFile(new URL('directfuel-bootstrap.js',root),'utf8');
 const modules=JSON.parse(boot.match(/for\(const name of (\[[^\n]+\])/)[1]);
 for(const name of modules){const file=`directfuel-${name}.js`;assert.ok(files.includes(file),file);new vm.Script(await readFile(new URL(file,root),'utf8'),{filename:file});}
 assert.equal(modules.at(-1),'migration-policy');for(const name of ['volume','geo','ticketlog','completed-documents'])assert.ok(!modules.includes(name));
 assert.doesNotMatch(boot,/[`'"]\/directfuel-|unpkg/);
 const html=await readFile(new URL('index.html',root),'utf8');
 for(const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))assert.ok(files.includes(match[1]),match[1]);
 assert.match(html,/Cópia de testes/);assert.match(html,/data-version="231"/);
});
test('opening the app preserves incoming snapshots and cannot automatically write them',async()=>{
 const text=await readFile(new URL('../dist/pages-preview/app/directfuel-online.js',import.meta.url),'utf8');
 const pull=text.slice(text.indexOf('  async function pull('),text.indexOf('  async function flushDanfes('));
 const state={medicoes:[],abastecimentos:[],users:[{id:'owner',email:'owner@example.test'}],audit:[]};let writes=0;
 const ctx={saving:false,pending:false,blockedByConflict:false,staleApplication:false,localRevision:0,pullRequestId:0,remoteVersion:0,lastRemoteStamp:'',acknowledgedState:null,db:{},structuredClone,
 window:{DIRECTFUEL_APP_VERSION:'231',directFuelNormalizeInvoiceState:()=>{throw Error('Must not normalize');}},document:{querySelector:()=>null,getElementById:()=>null},
 fetch:async()=>({applicationVersion:'231',version:1,updatedAt:'2026-10-07T00:00:00Z',state:structuredClone(state),user:{email:'owner@example.test',isOwner:true}}),
 readResponse:async x=>x,userChip:()=>{},cacheState:()=>{},render:()=>{},pill:()=>{},push:()=>{writes++;},console,setTimeout:fn=>{fn();},accessScreen:()=>{},conflictScreen:()=>{}};
 vm.createContext(ctx);vm.runInContext(pull,ctx);await ctx.pull(true);
 assert.equal(ctx.pending,false);assert.equal(writes,0);assert.deepEqual(ctx.db,state);assert.equal(ctx.remoteVersion,1);
});
