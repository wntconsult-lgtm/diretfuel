import {active,list,clean,numeric,validCoordinates,operationalMaps,alternatives,haversine,matchAlternativeProduct,resolveProductId,reviewedStationMatch} from './core/directfuel-geo-core.mjs';
import {routeCacheKey} from './geo-provider.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function routePairs(state){
 const maps=operationalMaps(state),available=alternatives(state,maps).filter(s=>s.source==='DirectFuel'&&validCoordinates(s.lat,s.lng)),products=new Map();
 for(const row of list(state.ticketlogFuelings)){const code=clean(row.station_code);if(!products.has(code))products.set(code,new Set());products.get(code).add(clean(row.product));}
 const radius=Math.min(100,Math.max(1,numeric(state.geoParams?.maxRoadDistanceKm??state.geoParams?.maxDetourKm)||30)),pairs=[];
 for(const station of list(state.ticketlogStations)){
  if(!validCoordinates(station.latitude,station.longitude))continue;
  const from={lat:numeric(station.latitude),lng:numeric(station.longitude)},code=clean(station.source_code);
  for(const alt of available){
   if(![...(products.get(code)||[])].some(p=>matchAlternativeProduct(p,resolveProductId(p,undefined,maps),alt.productIds,maps)))continue;
   const distance=haversine(from.lat,from.lng,alt.lat,alt.lng);
   if(distance<=0.03||distance>radius||reviewedStationMatch({station_code:code,station_name:station.name,cnpj:station.cnpj,city:station.city,uf:station.uf,latitude:from.lat,longitude:from.lng},alt,state))continue;
   pairs.push({origin_code:code,alternative_id:alt.id,from,to:{lat:alt.lat,lng:alt.lng},distance});
  }
 }
 return pairs.sort((a,b)=>a.distance-b.distance);
}
export async function cachedRoutes(state,entries){
 if(!entries.length)return [];
 const cached=new Map(entries.map(r=>[r.key,r.payload])),result=[];
 for(const pair of routePairs(state)){const payload=cached.get(await routeCacheKey(pair.from,pair.to));if(payload)result.push({origin_code:pair.origin_code,alternative_id:pair.alternative_id,...payload});}
 return result;
}
const normalized=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
function preciseResult(result,station){return result&&['building','amenity'].includes(result.resultType)&&result.confidence>=0.95&&normalized(result.city)===normalized(station.city)&&normalized(result.stateCode)===normalized(station.uf);}
export async function handleGeoProvider({state,body,provider,entries,cache,persist,email}){
 if(!provider.configured)throw fail('Cadastre a chave Geoapify nos segredos do Supabase para ativar rotas e coordenadas.',503);
 if(body.action==='geocode')return provider.geocode(body.address);
 if(body.action==='route-batch'){
  if(body.retryErrors)await cache('invalidate_errors');
  const pairs=routePairs(state),done=new Map(entries.filter(r=>!body.retryErrors||r.payload.status!=='Erro').map(r=>[r.key,r.payload])),pending=[];
  for(const pair of pairs){const key=await routeCacheKey(pair.from,pair.to),old=done.get(key);if(!old)pending.push({...pair,key});}
  let processed=0,calculated=0,errors=0;
  for(const pair of pending.slice(0,2)){
   const result=await provider.route(pair.from,pair.to);processed++;if(result.status==='Calculada')calculated++;else errors++;
   await new Promise(resolve=>setTimeout(resolve,400));
  }
  return {ok:true,totalPairs:pairs.length,processed,calculated,errors,remaining:pending.length-processed};
 }
 if(!['geocode-ticketlog-station','geocode-ticketlog-batch'].includes(body.action))throw fail('Ação geográfica inválida.');
 const single=body.action==='geocode-ticketlog-station',next=structuredClone(state);
 const targets=single?list(next.ticketlogStations).filter(s=>clean(s.source_code)===clean(body.stationCode)):list(next.ticketlogStations).filter(s=>!validCoordinates(s.latitude,s.longitude)&&(body.refresh||!['Não localizado','Dados insuficientes','Revisar endereço'].includes(s.geocode_status))).slice(0,1);
 if(single&&!targets.length)throw fail('Posto Ticketlog não encontrado.',404);
 let processed=0,geocoded=0,notFound=0,insufficient=0,preserved=0;
 for(const station of targets){
  if(validCoordinates(station.latitude,station.longitude)){preserved++;continue;}
  if(clean(station.address).length<5||clean(station.city).length<2||clean(station.uf).length!==2){station.geocode_status='Dados insuficientes';insufficient++;}
  else{
   const result=(await provider.geocode([station.address,station.neighborhood,station.city,station.uf,station.cep,'Brasil'].map(value=>clean(value)).filter(Boolean).join(', '))).results[0];
   if(preciseResult(result,station)){station.latitude=result.latitude;station.longitude=result.longitude;station.geocode_status='Georreferenciado';station.geocode_provider='Geoapify/OpenStreetMap';geocoded++;}
   else{station.geocode_status=result?'Revisar endereço':'Não localizado';notFound++;}
  }
  station.updated_at=new Date().toISOString();station.updated_by=email;processed++;
 }
 if(processed)await persist(next);
 const remaining=list(next.ticketlogStations).filter(s=>!validCoordinates(s.latitude,s.longitude)&&!['Não localizado','Dados insuficientes','Revisar endereço'].includes(s.geocode_status)).length;
 if(single&&processed&&!geocoded)throw fail('O endereço precisa de revisão. Coordenadas imprecisas não foram aplicadas.',422);
 return {ok:true,processed,geocoded,notFound,insufficient,preserved,remaining};
}
