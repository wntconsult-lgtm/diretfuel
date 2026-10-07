import test from 'node:test';
import assert from 'node:assert/strict';
import {handleVolume} from '../supabase/functions/directfuel-api/volume.mjs';
import {mutateTicketlog,readTicketlog} from '../supabase/functions/directfuel-api/ticketlog.mjs';
import {createHandler,analyzeChanges,prepareState} from '../supabase/functions/directfuel-api/handler.mjs';
import {defaults} from '../supabase/functions/directfuel-api/core/directfuel-volume.mjs';
const owner='owner@example.test',seed={frota:[{id:'vehicle',placa:'AAA-0A00',capTanque:100,capTanqueArla:20}],abastecimentos:[{id:'earlier',placa:'AAA0A00',data:'2026-01-01',hora:'23:00',produto:'Diesel',qt:30,total:150,postoId:'other',motorista:'Other'},{id:'selected',placa:'AAA0A00',data:'2026-01-02',hora:'00:00',produto:'Diesel',qt:90,total:450,postoId:'selected',motorista:'Driver'}],medicoes:[]};
const volume=(state,body,persist=()=>{throw Error('Read cannot write');})=>handleVolume({state,body,method:'POST',email:owner,persist});
function memory(state=seed){let saved=structuredClone(state),writes=0,destructive=false;return {get state(){return saved;},get writes(){return writes;},get destructive(){return destructive;},async mutate(body){return mutateTicketlog({state:saved,body,email:owner,persist:async(next,flag)=>{saved=next;writes++;destructive=flag;}});}};}
const record={transactionCode:'SYNTHETIC-001',occurredOn:'02/01/2026',occurredTime:'00:00',plate:'AAA-0A00',stationCode:'TEST',stationName:'Synthetic station',liters:'90,00',product:'Diesel',finalValue:450,vehicleId:'forged',vehicleLinkStatus:'forged'};
const load=(records=[record],batchId='synthetic-batch')=>({action:'import',kind:'fuelings',batchId,records});
test('volume filters keep prior-day and other-station window evidence',async()=>{
 const r=await volume(seed,{action:'calculate',filters:{from:'2026-01-02',to:'2026-01-02',station:'selected'}});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].windows[0].count,2);assert.equal(r.rows[0].windows[0].liters,120);assert.equal(r.rows[0].windowClass,'Atenção');assert.equal(r.rows[0].capacityClass,'Atenção');
});
test('summary respects dates and ignores display source and classification filters; simulation never writes',async()=>{
 const r=await volume(seed,{action:'summary',filters:{from:'2026-01-02',to:'2026-01-02',source:'Ticketlog',classification:['Crítico']}});assert.equal(r.summary.analisados,1);
 const sim=await volume(seed,{action:'simulate',parameters:{...defaults,capacidade:{normalAte:91,atencaoAte:94,suspeitoAte:96}}});assert.equal(sim.rows.length,0);assert.equal(sim.cards.Normal,2);assert.equal(sim.before.Normal,1);
 await assert.rejects(()=>volume(seed,{action:'calculate',filters:{from:'2026-01-03',to:'2026-01-02'}}),e=>e.status===400);
});
test('calibration and manual treatments preserve originals and reject stale revisions',async()=>{
 let state=structuredClone(seed);const persist=async s=>{state=s;};
 await volume(state,{action:'save',version:0,parameters:{...defaults,capacidade:{normalAte:81,atencaoAte:91,suspeitoAte:96}}},persist);
 assert.equal(state.volumeParameters.version,1);assert.equal(state.volumeParameterHistory.length,1);assert.deepEqual(state.abastecimentos,seed.abastecimentos);
 await assert.rejects(()=>volume(state,{action:'save',version:0,parameters:defaults},persist),e=>e.status===409);
 const first=await volume(state,{action:'review',key:'direct:selected',status:'Justificado',observation:'Synthetic explanation'},persist);
 await assert.rejects(()=>volume(state,{action:'review',key:'direct:selected',status:'Pendente',observation:''},persist),e=>e.status===409);
 const second=await volume(state,{action:'review',key:'direct:selected',status:'Pendente',observation:'',updatedAt:first.review.updated_at},persist);assert.ok(second.review.updated_at>first.review.updated_at);
});
test('Ticketlog derives vehicle links from fleet and repeated chunks are idempotent',async()=>{
 const m=memory(),before=structuredClone(seed);const result=await m.mutate(load());assert.equal(result.imported,1);assert.equal(m.state.ticketlogFuelings[0].vehicle_id,'vehicle');assert.equal(m.state.ticketlogFuelings[0].vehicle_link_status,'Vinculado');
 assert.deepEqual(await m.mutate(load()),result);assert.equal(m.writes,1);assert.deepEqual(seed,before);
 await m.mutate({action:'finish',kind:'fuelings',batchId:'synthetic-batch',filename:'synthetic.csv',totals:{imported:99999}});assert.equal(m.state.ticketlogBatches[0].imported,1);
 await m.mutate({action:'finish',kind:'fuelings',batchId:'synthetic-batch',filename:'synthetic.csv'});assert.equal(m.writes,2);
});
test('duplicates only correct compatible nonblank times and reject invalid calendar dates',async()=>{
 const m=memory();await m.mutate(load());const original=structuredClone(m.state.ticketlogFuelings[0]);
 assert.equal((await m.mutate(load([{...record,occurredTime:'01:00'}],'correction'))).updated,1);
 assert.equal((await m.mutate(load([{...record,occurredTime:''}],'blank'))).duplicated,1);assert.equal(m.state.ticketlogFuelings[0].occurred_time,'01:00:00');
 assert.equal((await m.mutate(load([{...record,liters:150,occurredTime:'02:00'}],'conflict'))).duplicated,1);assert.equal(m.state.ticketlogFuelings[0].liters,original.liters);
 const bad=await m.mutate(load([{...record,transactionCode:'bad',occurredOn:'31/02/2026'},{...record,transactionCode:'bad2',occurredOn:'2026-13-01'},{...record,transactionCode:'bad3',occurredTime:'25:00'}],'invalid'));assert.equal(bad.rejected,3);assert.equal(m.state.ticketlogFuelings.length,1);
});
test('station upserts preserve IDs and report pagination covers more than 2000 stations',async()=>{
 const m=memory(),station={sourceCode:'SYNTHETIC',name:'Synthetic',city:'Test',uf:'ES',latitude:-20000000,longitude:-40000000};
 const body={action:'import',kind:'stations',batchId:'stations',records:[station]};assert.equal((await m.mutate(body)).geocoded,1);const id=m.state.ticketlogStations[0].id;
 await m.mutate({...body,batchId:'update',records:[{...station,name:'Synthetic updated'}]});assert.equal(m.state.ticketlogStations[0].id,id);assert.equal(m.state.ticketlogStations[0].latitude,-20);
 const rows=Array.from({length:2001},(_,n)=>({id:`S-${n}`,name:`Synthetic-${String(n).padStart(4,'0')}`})),state={ticketlogStations:rows};let offset=0,total=0;
 do{const r=readTicketlog(state,new URLSearchParams({report:'stations',offset:String(offset)}));total+=r.stations.length;offset=r.nextOffset;}while(offset!==null);assert.equal(total,2001);
});
test('deleting a batch also deletes associated reviews and creates auditable deletion data',async()=>{
 const m=memory();await m.mutate(load());m.state.volumeReviews=[{id:'review',record_key:'ticket:SYNTHETIC-001',status:'Justificado'}];const before=structuredClone(m.state);
 assert.equal((await m.mutate({action:'delete-batch',batchId:'synthetic-batch'})).deleted,1);assert.equal(m.state.ticketlogFuelings.length,0);assert.equal(m.state.volumeReviews.length,0);assert.equal(m.destructive,true);
 const changes=analyzeChanges(before,m.state);assert.equal(changes.find(c=>c.collection==='ticketlogFuelings').deleted[0].transaction_code,record.transactionCode);
});
test('ordinary state edits cannot forge Ticketlog; trusted restoration restores its backed-up collections',()=>{
 const access={isOwner:true,user:{email:owner},directFuelUser:{perfil:'Master',permissoes:['*'],acoes:['*']}},previous={ticketlogFuelings:[{id:'protected'}]};
 assert.deepEqual(prepareState(previous,{state:{ticketlogFuelings:[]}},access).next.ticketlogFuelings,previous.ticketlogFuelings);
 assert.deepEqual(prepareState(previous,{state:{ticketlogFuelings:[{id:'restored'}]}},access,true).next.ticketlogFuelings,[{id:'restored'}]);
});
test('native API enforces owner access, rejects unsafe markup before write, and preserves conflict responses',async()=>{
 let writes=0,denied=false;const url='https://synthetic.example.test';const handler=createHandler({url,serviceKey:'synthetic-service',fetchImpl:async(target,options)=>{
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'synthetic-user',email:owner,email_confirmed_at:'2026-01-01',role:'authenticated'});
  if(target.endsWith('/directfuel_state_read'))return denied?Response.json({code:'PT403',message:'Acesso não autorizado.'},{status:403}):Response.json({state:seed,version:1,user:{email:owner,isOwner:true}});
  if(target.endsWith('/directfuel_state_write')){writes++;const p=JSON.parse(options.body);assert.equal(p.p_version,1);assert.ok(p.p_events.some(e=>e.collection==='ticketlogFuelings'));return Response.json({code:'PT409',message:'Dados alterados.'},{status:409});}
  throw Error('Unexpected request');
 }});
 const call=body=>handler(new Request(url+'/functions/v1/directfuel-api/ticketlog',{method:'POST',headers:{authorization:'Bearer synthetic-token',origin:'https://wntconsult-lgtm.github.io','content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await call(load([{...record,driverName:'<script>unsafe</script>'}]))).status,400);assert.equal(writes,0);
 const conflict=await call(load());assert.equal(conflict.status,409);assert.equal((await conflict.json()).conflict,true);
 denied=true;assert.equal((await call(load())).status,403);assert.equal(writes,1);
});
test('fleet relinking and Ticketlog date filters are authoritative and read-only',async()=>{
 const m=memory({frota:[],abastecimentos:[],medicoes:[]});await m.mutate(load());assert.equal(m.state.ticketlogFuelings[0].vehicle_id,null);
 m.state.frota=[{id:'verified-vehicle',placa:'AAA0A00'}];const result=await m.mutate({action:'reprocess-links'});assert.equal(result.linked,1);assert.equal(m.state.ticketlogFuelings[0].vehicle_id,'verified-vehicle');
 const before=structuredClone(m.state),read=readTicketlog(m.state,new URLSearchParams({fuelingFrom:'2026-01-03'}));assert.equal(read.recent.length,0);assert.equal(read.summary.records,1);assert.deepEqual(m.state,before);
 assert.throws(()=>readTicketlog(m.state,new URLSearchParams({batchFrom:'2026-01-03',batchTo:'2026-01-02'})),e=>e.status===400);
});
test('ARLA uses its reservoir and cannot reuse diesel capacity',async()=>{
 const state={...seed,abastecimentos:[{id:'arla',placa:'AAA0A00',data:'2026-01-02',hora:'01:00',produto:'ARLA 32',qt:25,total:100}]};
 const result=await volume(state,{action:'calculate'});assert.equal(result.rows[0].capacidade,20);assert.equal(result.rows[0].capacityClass,'Crítico');
});
