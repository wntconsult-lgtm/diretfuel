import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {readGeo,reviewGeo} from '../supabase/functions/directfuel-api/geo.mjs';
import {documentManifest,handleCompleted} from '../supabase/functions/directfuel-api/completed-documents.mjs';
import {handleDocument} from '../supabase/functions/directfuel-api/documents.mjs';
import {prepareState,analyzeChanges,createHandler} from '../supabase/functions/directfuel-api/handler.mjs';
const owner='owner@example.test';
const geoSeed={frota:[{id:'vehicle',placa:'AAA0A00',produtoId:'diesel'}],produtos:[{id:'diesel',curta:'Diesel S10'}],postos:[{id:'station',codigo:'SYNTHETIC-DIRECT',fantasia:'Synthetic direct',municipio:'Test',uf:'ES',latitude:-20,longitude:-40}],acordos:[{id:'agreement',postoId:'station',produtoId:'diesel',inicio:'2026-01-01',fim:'2026-12-31',status:'Vigente',preco:5}],abastecimentos:[{id:'direct-fueling',placa:'AAA0A00',postoId:'station',produtoId:'diesel',data:'2026-01-02',qt:10,total:50}],ticketlogStations:[{id:'ticket-station',source_code:'SYNTHETIC-TICKET',name:'Synthetic ticket',city:'Test',uf:'ES',latitude:-20.01,longitude:-40.01}],ticketlogFuelings:[{id:'ticket-fueling',transaction_code:'SYNTHETIC-TX',plate:'AAA0A00',product:'Diesel S10',occurred_on:'2026-01-02',liters:20,final_price:6,final_value:120,station_code:'SYNTHETIC-TICKET',station_name:'Synthetic ticket',city:'Test',uf:'ES',vehicle_link_status:'Vinculado'}]};
const geo=(state=geoSeed,query='')=>readGeo(state,new URL('https://example.test/api/geo-analysis?'+query));
test('geographic map integrates both sources with product, date and origin filters without changing state',()=>{
 const before=structuredClone(geoSeed),result=geo();assert.equal(result.rows.length,1);assert.equal(result.directFuelRows.length,1);assert.equal(result.summary.liters,20);assert.equal(result.directFuelSummary.liters,10);assert.deepEqual(geoSeed,before);
 assert.equal(geo(geoSeed,'origin=DirectFuel').rows.length,0);assert.equal(geo(geoSeed,'origin=Ticketlog').directFuelRows.length,0);assert.equal(geo(geoSeed,'from=2026-01-03').rows.length,0);assert.equal(geo(geoSeed,'product=ARLA').rows.length,0);assert.equal(geo(geoSeed,'product=Diesel+S10&product=ARLA').rows.length,1);
 assert.throws(()=>geo(geoSeed,'from=2026-01-03&to=2026-01-02'),e=>e.status===400);
});
test('geographic volume filters apply per station and missing roads cannot become saving opportunities',()=>{
 const state=structuredClone(geoSeed);state.ticketlogFuelings.push({...state.ticketlogFuelings[0],id:'second',transaction_code:'SYNTHETIC-TX-2',liters:20});const result=geo(state,'minLiters=30');assert.equal(result.rows.length,2);assert.equal(result.summary.opportunities,0);assert.equal(result.summary.gross_saving,0);assert.ok(result.rows.every(r=>r.analysis_status==='route_pending'));
 assert.equal(geo(state,'maxLiters=30').rows.length,0);assert.throws(()=>geo(state,'minLiters=30&maxLiters=20'),e=>e.status===400);
});
test('station reviews validate targets and stale treatments and are recorded in the protected audit',async()=>{
 let state=structuredClone(geoSeed);const persist=async next=>{state=next;};
 await assert.rejects(()=>reviewGeo({state,body:{action:'review-station',stationCode:'SYNTHETIC-TICKET',mode:'same',targetId:'missing',reason:'Synthetic reason'},email:owner,persist}),e=>e.status===400);
 const before=structuredClone(state);await reviewGeo({state,body:{action:'review-station',stationCode:'SYNTHETIC-TICKET',mode:'same',targetId:'station',reason:'Synthetic reason'},email:owner,persist});
 assert.equal(analyzeChanges(before,state).find(c=>c.collection==='stationReviews').inserted,1);
 await assert.rejects(()=>reviewGeo({state,body:{action:'review-station',stationCode:'SYNTHETIC-TICKET',mode:'different',reason:'Synthetic reason'},email:owner,persist}),e=>e.status===409);
 const access={isOwner:true,user:{email:owner},directFuelUser:{perfil:'Master',permissoes:['*'],acoes:['*']}};assert.deepEqual(prepareState(state,{state:{...state,stationReviews:[]}},access).next.stationReviews,state.stationReviews);
 await reviewGeo({state,body:{action:'review-station',stationCode:'SYNTHETIC-TICKET',mode:'automatic',reason:'Synthetic reset',reviewedAt:state.stationReviews[0].reviewedAt},email:owner,persist});assert.equal(state.stationReviews.length,0);
});
const fiscalSeed={medicoes:[{id:'m',numero:'SYNTHETIC-M',status:'Aprovada',notasFiscais:[{id:'invoice',numero:'1',serie:'1',pdfDocumento:true,pdfNome:'synthetic.pdf',xmlDocumento:true,xmlNome:'synthetic.xml'}]}],sapReturns:[{id:'sap',measurementId:'m',invoiceKey:'1-1',purchaseOrder:'1234567890',status:'success',postingDate:'2026-01-02'}]};
const doc={id:'invoice:pdf',measurement_id:'invoice',content_type:'application/pdf',byte_size:100,sha256:'a'.repeat(64),object_path:'danfes/synthetic.pdf',removed_at:null};
test('document manifest distinguishes missing and present files and protects incomplete or shared references',()=>{
 const result=documentManifest(fiscalSeed,[doc]);assert.equal(result.find(f=>f.type==='pdf').present,true);assert.equal(result.find(f=>f.type==='xml').present,false);assert.equal(result.find(f=>f.type==='pdf').eligible,true);
 const pending=structuredClone(fiscalSeed);pending.sapReturns.push({...pending.sapReturns[0],id:'partial',status:'partial'});assert.equal(documentManifest(pending,[doc])[0].eligible,false);
 const shared={...fiscalSeed,additional:[{id:'shared',documentoPdfId:'invoice'}]};assert.equal(documentManifest(shared,[doc])[0].eligible,false);
});
function completedMock(state=fiscalSeed){const calls=[];const document=async(action,id,meta)=>{calls.push({action,id,meta});if(action==='list')return [doc];if(action==='remove_completed')return doc;if(action==='cleanup_complete')return {ok:true};throw Error(action);};return {calls,args:{document,readState:async()=>({state,version:3}),parsed:new URL('https://example.test/api/documents/completed'),removeObject:async path=>{calls.push({action:'physical-cleanup',path});}}};}
test('completed preview is read-only and deletion checks both state revision and exact file hash',async()=>{
 const m=completedMock();const preview=await handleCompleted({...m.args,method:'GET'});assert.equal(preview.eligibleCount,1);assert.equal(preview.bytes,100);assert.deepEqual(m.calls.map(c=>c.action),['list']);
 const body={id:'invoice',type:'pdf',etag:doc.sha256,version:3,confirmation:'EXCLUIR SOMENTE ARQUIVOS'};
 await assert.rejects(()=>handleCompleted({...m.args,method:'POST',body:{...body,version:2}}),e=>e.status===409);await assert.rejects(()=>handleCompleted({...m.args,method:'POST',body:{...body,etag:'wrong'}}),e=>e.status===409);assert.ok(m.calls.every(c=>c.action==='list'));
 const result=await handleCompleted({...m.args,method:'POST',body});assert.equal(result.bytes,100);assert.deepEqual(m.calls.slice(-3).map(c=>c.action),['remove_completed','physical-cleanup','cleanup_complete']);assert.equal(m.calls.at(-3).meta.version,3);
});
test('ineligible invoice references block physical deletion and cleanup failures never report success',async()=>{
 const pending={...fiscalSeed,sapReturns:[]},m=completedMock(pending),body={id:'invoice',type:'pdf',etag:doc.sha256,version:3,confirmation:'EXCLUIR SOMENTE ARQUIVOS'};
 await assert.rejects(()=>handleCompleted({...m.args,method:'POST',body}),e=>e.status===409);assert.deepEqual(m.calls.map(c=>c.action),['list']);
 const good=completedMock();await assert.rejects(()=>handleCompleted({...good.args,method:'POST',body,removeObject:async()=>{throw Object.assign(Error('Synthetic storage failure'),{status:503});}}),e=>e.status===503);assert.ok(!good.calls.some(c=>c.action==='cleanup_complete'));
});
test('migration upload refuses unknown references and cleans its new object when another upload wins',async()=>{
 const calls=[],args={route:'documents/invoice',parsed:new URL('https://example.test/api/documents/invoice?migration=1'),url:'https://synthetic.example.test',serviceKey:'synthetic-service',headers:new Headers(),reply:Response.json,readState:async()=>({state:fiscalSeed,version:3}),document:async(action,id,metadata)=>{calls.push({action,id,metadata});if(action==='context')return {};if(action==='put'){assert.equal(metadata.onlyMissing,true);assert.equal(metadata.version,3);throw Object.assign(Error('Synthetic conflict'),{status:409});}throw Error(action);},fetchImpl:async(url,options)=>{calls.push({url,method:options?.method});if(url.includes('/bucket/'))return Response.json({public:false});return Response.json({ok:true});}};
 const request=()=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/pdf'},body:'%PDF-synthetic-document'});
 await assert.rejects(()=>handleDocument({...args,request:request(),route:'documents/unknown'}),e=>e.status===400);assert.equal(calls.length,0);
 await assert.rejects(()=>handleDocument({...args,request:request()}),e=>e.status===409);assert.equal(calls.filter(c=>c.method==='DELETE').length,1);assert.ok(!calls.some(c=>c.action==='remove'));
});
test('geographic API reads require membership and disabled provider actions never send operational data externally',async()=>{
 let denied=false,writes=0;const handler=createHandler({url:'https://synthetic.example.test',serviceKey:'synthetic-service',fetchImpl:async(url,options)=>{
  assert.ok(url.startsWith('https://synthetic.example.test/'));
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'synthetic-owner',email:owner,email_confirmed_at:'2026-01-01',role:'authenticated'});
  if(url.endsWith('/directfuel_state_read'))return denied?Response.json({code:'PT403',message:'Acesso não autorizado.'},{status:403}):Response.json({state:geoSeed,version:1,user:{email:owner}});
  writes++;throw Error('Unexpected write');
 }});
 const request=(body)=>new Request('https://synthetic.example.test/functions/v1/directfuel-api/geo-analysis',{method:body?'POST':'GET',headers:{authorization:'Bearer synthetic-token',origin:'https://wntconsult-lgtm.github.io',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await handler(request());assert.equal(result.status,200);assert.equal((await result.json()).capabilities.routing,false);
 assert.equal((await handler(request({action:'route-batch'}))).status,503);assert.equal(writes,0);denied=true;assert.equal((await handler(request())).status,403);
});
test('static map pins Leaflet and permits only its required tile source; migration UI never inserts filenames as HTML',async()=>{
 const html=await readFile(new URL('../dist/pages-preview/app/index.html',import.meta.url),'utf8'),geo=await readFile(new URL('../dist/pages-preview/app/directfuel-geo.js',import.meta.url),'utf8'),migration=await readFile(new URL('../migration/app/document-migration.js',import.meta.url),'utf8');
 assert.match(html,/leaflet@1\.9\.4/);assert.match(html,/https:\/\/tile\.openstreetmap\.org/);assert.match(geo,/if\(!geo\.data\?\.capabilities\?\.routing\)return/);assert.match(geo,/reviewedAt: previous\?\.reviewedAt \|\| null/);assert.match(migration,/name\.textContent=file\.name/);assert.doesNotMatch(migration,/innerHTML\s*=.*file\.name/);
});
test('pending cleanup deletes only the immutable path already marked removed and acknowledges completion',async()=>{
 const calls=[],removed={...doc,removed_at:'2026-01-03T00:00:00Z',cleanup_pending:true};
 const result=await handleCompleted({method:'POST',body:{action:'cleanup_pending',id:'invoice',type:'pdf',confirmation:'EXCLUIR SOMENTE ARQUIVOS'},document:async(action,id,meta)=>{calls.push({action,id,meta});if(action==='list')return [removed];return {ok:true};},removeObject:async path=>{calls.push({action:'physical-cleanup',path});},readState:()=>{throw Error('Cleanup must not alter operational state');}});
 assert.equal(result.bytes,100);assert.equal(calls[1].path,doc.object_path);assert.equal(calls[2].action,'cleanup_complete');
});
