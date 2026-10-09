import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGeoProvider,routeCacheKey} from '../supabase/functions/directfuel-api/geo-provider.mjs';
import {routePairs,cachedRoutes,handleGeoProvider} from '../supabase/functions/directfuel-api/geo-routing.mjs';
import {readGeo} from '../supabase/functions/directfuel-api/geo.mjs';
import {createHandler} from '../supabase/functions/directfuel-api/handler.mjs';
const secret='synthetic-geographic-key',from={lat:-20.01,lng:-40.01},to={lat:-20,lng:-40};
const state={frota:[{id:'vehicle',placa:'AAA0A00',produtoId:'diesel'}],produtos:[{id:'diesel',curta:'Diesel S10'}],postos:[{id:'station',fantasia:'Synthetic direct',municipio:'Test',uf:'ES',latitude:to.lat,longitude:to.lng}],acordos:[{id:'agreement',postoId:'station',produtoId:'diesel',inicio:'2026-01-01',fim:'2026-12-31',status:'Vigente',preco:5}],ticketlogStations:[{id:'ticket-station',source_code:'SYNTHETIC-TICKET',name:'Synthetic ticket',address:'Synthetic street 123',city:'Test',uf:'ES',latitude:from.lat,longitude:from.lng}],ticketlogFuelings:[{id:'ticket-fueling',transaction_code:'SYNTHETIC-TX',plate:'AAA0A00',product:'Diesel S10',occurred_on:'2026-01-02',liters:20,final_price:6,final_value:120,station_code:'SYNTHETIC-TICKET',station_name:'Synthetic ticket',city:'Test',uf:'ES',vehicle_link_status:'Vinculado'}]};
function setup(response={results:[{distance:2000,distance_units:'Meters',time:120}]}){
 const values=new Map(),calls=[],events=[];
 const cache=async(action,p={})=>{events.push({action,...p});if(action==='get')return values.has(p.key)?{payload:values.get(p.key)}:{};if(action==='reserve')return {token:'synthetic-lease'};if(action==='put'){values.set(p.key,p.payload);return {ok:true};}return {};};
 const provider=createGeoProvider({apiKey:secret,cache,fetchImpl:async(target,options)=>{calls.push({target,options});return response instanceof Response?response.clone():Response.json(response);}});
 return {provider,cache,calls,events,values};
}
test('unconfigured providers and invalid coordinates never call an external service',async()=>{
 let calls=0;const p=createGeoProvider({cache:()=>{calls++;},fetchImpl:()=>{calls++;}});
 assert.equal(p.configured,false);await assert.rejects(()=>p.route(from,to),e=>e.status===503);assert.equal(calls,0);
 const {provider,events}=setup();await assert.rejects(()=>provider.route({lat:NaN,lng:0},to),e=>e.status===400);await assert.rejects(()=>provider.geocode('short'),e=>e.status===400);assert.equal(events.length,0);
});
test('road distance and seconds are converted once, cached and isolated from operational identifiers',async()=>{
 const {provider,calls,events}=setup();const route=await provider.route(from,to);assert.equal(route.distance_km,2);assert.equal(route.duration_minutes,2);assert.equal(route.status,'Calculada');
 assert.deepEqual(await provider.route(from,to),route);assert.equal(calls.length,1);assert.deepEqual(events.map(e=>e.action),['get','reserve','put','get']);
 const target=new URL(calls[0].target);assert.equal(target.origin,'https://api.geoapify.com');assert.equal(target.searchParams.get('waypoints'),'-20.01,-40.01|-20,-40');assert.equal(target.searchParams.get('apiKey'),secret);assert.equal(calls[0].options.redirect,'error');
 assert.doesNotMatch(JSON.stringify(route),/synthetic-geographic-key|AAA0A00|transaction_code|liters|final_value/);
});
test('invalid units and distances are rejected without replacing them with straight-line or zero distances',async()=>{
 for(const record of [{distance:2000,distance_units:'Miles',time:120},{distance:0,distance_units:'Meters',time:120},{distance:-1,distance_units:'Meters',time:120},{distance:2000,distance_units:'Meters',time:-1}]){const m=setup({results:[record]});await assert.rejects(()=>m.provider.route(from,to),e=>e.status===503);assert.equal(m.values.size,0);assert.equal(m.events.at(-1).action,'release');}
 const missing=setup({results:[]});assert.equal((await missing.provider.route(from,to)).status,'Erro');
});
test('provider rejection, rate limits, reserve failures and cache-write failures do not disclose secrets',async()=>{
 for(const status of [401,403,429,500]){const m=setup(Response.json({url:'https://private.example/?apiKey='+secret},{status}));await assert.rejects(()=>m.provider.route(from,to),e=>{assert.doesNotMatch(e.message,/synthetic-geographic-key|private/);return e.status===(status===429?429:503);});assert.equal(m.events.at(-1).action,'release');}
 let calls=0;const p=createGeoProvider({apiKey:secret,cache:async action=>{if(action==='get')return {};throw Object.assign(Error('Daily quota'),{status:429});},fetchImpl:async()=>{calls++;}});await assert.rejects(()=>p.route(from,to),e=>e.status===429);assert.equal(calls,0);
 const m=setup();const failing=createGeoProvider({apiKey:secret,cache:async(a,p)=>{if(a==='put')throw Object.assign(Error('Conflict'),{status:409});return m.cache(a,p);},fetchImpl:async()=>Response.json({results:[{distance:2000,distance_units:'Meters',time:120}]})});await assert.rejects(()=>failing.route(from,to),e=>e.status===409);assert.equal(m.values.size,0);assert.equal(m.events.at(-1).action,'release');
});
test('geocoding stays in Brazil and sanitizes labels without manufacturing precision',async()=>{
 const m=setup({results:[{lat:-20,lon:-40,country_code:'br',formatted:'<Synthetic> street',result_type:'city',city:'Test',state_code:'ES',rank:{confidence:0.8}},{lat:0,lon:0,country_code:'br'},{lat:50,lon:2,country_code:'fr'}]});
 const result=await m.provider.geocode('Synthetic street, Test, ES, Brasil');assert.equal(result.results.length,1);assert.equal(result.results[0].label,'Synthetic street');assert.equal(result.results[0].resultType,'city');assert.equal(result.results[0].confidence,0.8);const url=new URL(m.calls[0].target);assert.equal(url.searchParams.get('filter'),'countrycode:br');assert.equal(url.searchParams.get('format'),'json');
});
test('cached routes affect saving calculations only for the current coordinates and compatible product',async()=>{
 const before=structuredClone(state),pairs=routePairs(state);assert.equal(pairs.length,1);const key=await routeCacheKey(from,to),entries=[{key,payload:{status:'Calculada',distance_km:2,duration_minutes:2,provider:'Geoapify/OpenStreetMap'}}];
 const routes=await cachedRoutes(state,entries);assert.equal(routes.length,1);const result=readGeo(state,new URL('https://synthetic.example.test'),routes);assert.equal(result.summary.opportunities,1);assert.equal(result.rows[0].road_distance_km,2);assert.equal(result.summary.gross_saving,20);
 const moved=structuredClone(state);moved.postos[0].latitude=-20.005;assert.deepEqual(await cachedRoutes(moved,entries),[]);assert.equal(readGeo(moved,new URL('https://synthetic.example.test')).summary.opportunities,0);assert.deepEqual(state,before);
 const incompatible=structuredClone(state);incompatible.ticketlogFuelings[0].product='ARLA';assert.equal(routePairs(incompatible).length,0);
});
test('a route batch is bounded, preserves business state and retries all error caches with one invalidation',async()=>{
 const before=structuredClone(state),m=setup();const response=await handleGeoProvider({state,body:{action:'route-batch'},provider:m.provider,entries:[],cache:m.cache,persist:()=>{throw Error('Routing cannot write fiscal state');}});assert.equal(response.processed,1);assert.equal(response.calculated,1);assert.equal(response.remaining,0);assert.deepEqual(state,before);
 const key=await routeCacheKey(from,to),events=[];await handleGeoProvider({state,body:{action:'route-batch',retryErrors:true},provider:m.provider,entries:[{key,payload:{status:'Erro'}}],cache:async a=>{events.push(a);},persist:()=>{throw Error('No write');}});assert.deepEqual(events,['invalidate_errors']);
});
test('automatic Ticketlog coordinates preserve existing points and reject city centroids, low confidence and mismatched locations',async()=>{
 for(const change of [{resultType:'city'},{confidence:0.94},{city:'Other city'},{stateCode:'SP'}]){
  const candidate={latitude:-20.02,longitude:-40.02,resultType:'building',confidence:1,city:'Test',stateCode:'ES',...change},pending=structuredClone(state);pending.ticketlogStations[0].latitude=null;pending.ticketlogStations[0].longitude=null;let next;
  const result=await handleGeoProvider({state:pending,body:{action:'geocode-ticketlog-batch'},provider:{configured:true,geocode:async()=>({results:[candidate]})},persist:async n=>{next=n;},email:'synthetic@example.test'});assert.equal(result.geocoded,0);assert.equal(next.ticketlogStations[0].latitude,null);assert.equal(next.ticketlogStations[0].geocode_status,'Revisar endereço');assert.equal(next.ticketlogFuelings[0].final_value,120);
 }
 let queries=0,writes=0;const preserved=await handleGeoProvider({state,body:{action:'geocode-ticketlog-station',stationCode:'SYNTHETIC-TICKET'},provider:{configured:true,geocode:async()=>{queries++;}},persist:async()=>{writes++;}});assert.equal(preserved.preserved,1);assert.equal(queries,0);assert.equal(writes,0);
});
test('precise automatic results change only station coordinates and persist through the concurrent writer',async()=>{
 const pending=structuredClone(state);pending.ticketlogStations[0].latitude=null;pending.ticketlogStations[0].longitude=null;const candidate={latitude:-20.02,longitude:-40.02,resultType:'amenity',confidence:1,city:'Test',stateCode:'ES'};let address,next;
 const result=await handleGeoProvider({state:pending,body:{action:'geocode-ticketlog-station',stationCode:'SYNTHETIC-TICKET'},provider:{configured:true,geocode:async text=>{address=text;return {results:[candidate]};}},persist:async n=>{next=n;},email:'synthetic@example.test'});assert.equal(result.geocoded,1);assert.match(address,/Synthetic street 123/);assert.equal(next.ticketlogStations[0].latitude,candidate.latitude);assert.deepEqual(next.ticketlogFuelings,pending.ticketlogFuelings);assert.equal(pending.ticketlogStations[0].latitude,null);
 await assert.rejects(()=>handleGeoProvider({state:pending,body:{action:'geocode-ticketlog-station',stationCode:'SYNTHETIC-TICKET'},provider:{configured:true,geocode:async()=>({results:[candidate]})},persist:async()=>{throw Object.assign(Error('Stale revision'),{status:409});}}),e=>e.status===409);
});
test('a configured geographic GET reads cached results without querying the provider and ignores body-supplied API keys',async()=>{
 let external=0;const user={email:'owner@example.test',isOwner:true};const handler=createHandler({url:'https://synthetic.example.test',serviceKey:'synthetic-server-key',geoApiKey:secret,fetchImpl:async(target,options)=>{
  if(!target.startsWith('https://synthetic.example.test/')){external++;throw Error('Read must never query provider');}
  if(target.endsWith('/user'))return Response.json({id:'synthetic',email:user.email,email_confirmed_at:'2026-01-01',role:'authenticated'});
  if(target.endsWith('/directfuel_state_read'))return Response.json({state,version:4,user});
  if(target.endsWith('/directfuel_geo_cache')){const body=JSON.parse(options.body);return Response.json(body.p_action==='list'?[]:{requests:0,dailyLimit:100});}
  throw Error('Unexpected request');
 }});
 const response=await handler(new Request('https://synthetic.example.test/functions/v1/directfuel-api/geo-analysis',{headers:{authorization:'Bearer synthetic'}}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.capabilities.routing,true);assert.equal(result.capabilities.manualOnly,true);assert.equal(result.capabilities.sameRoad,false);assert.equal(external,0);assert.doesNotMatch(JSON.stringify(result),/synthetic-geographic-key|synthetic-server-key/);
});
test('static pages cannot automatically spend the provider quota or embed its private key',async()=>{
 const script=await readFile(new URL('../dist/pages-preview/app/directfuel-geo.js',import.meta.url),'utf8'),setup=await readFile(new URL('../migration/app/geo-setup.js',import.meta.url),'utf8');
 assert.match(script,/if\(geo\.data\.capabilities\.manualOnly\)return/);assert.match(script,/Math\.min\(pending\.length,20\)/);assert.match(script,/result\.confidence>=0\.95/);assert.match(script,/www\.geoapify\.com/);assert.doesNotMatch(script,/synthetic-geographic-key/);assert.doesNotMatch(setup,/<input[^>]*key|localStorage|apiKey=/i);
});
