const fail=(message,status=503)=>Object.assign(new Error(message),{status});
const coordinates=(lat,lng)=>typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0);
const text=value=>String(value??'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,500);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
export const routeCacheKey=async(from,to)=>digest(JSON.stringify(['geoapify-v1-drive',from.lat,from.lng,to.lat,to.lng]));
export function createGeoProvider({apiKey='',fetchImpl=fetch,cache}){
 const key=apiKey.trim(),configured=/^[A-Za-z0-9_-]{16,128}$/.test(key);
 async function request(kind,cacheKey,params,parse){
  if(!configured)throw fail('Cadastre a chave Geoapify nos segredos do Supabase para ativar rotas e coordenadas.');
  const existing=await cache('get',{key:cacheKey,kind});if(existing?.payload)return existing.payload;
  const lease=await cache('reserve',{key:cacheKey,kind});if(lease?.payload)return lease.payload;
  try{
   const target=new URL(kind==='route'?'https://api.geoapify.com/v1/routing':'https://api.geoapify.com/v1/geocode/search');
   for(const [name,value]of Object.entries(params))target.searchParams.set(name,String(value));target.searchParams.set('apiKey',key);
   let response;try{response=await fetchImpl(target.href,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{accept:'application/json'}});}catch{throw fail('O serviço de mapas não respondeu. Tente novamente.');}
   if(!response.ok){if(response.status===429)throw fail('O limite do serviço de mapas foi atingido. Aguarde para continuar.',429);if([401,403].includes(response.status))throw fail('A chave do serviço de mapas foi recusada. Confira os segredos do Supabase.');throw fail('O serviço de mapas não conseguiu concluir a consulta.');}
   let data;try{data=await response.json();}catch{throw fail('Resposta inválida do serviço de mapas.');}
   const payload=parse(data);await cache('put',{key:cacheKey,kind,token:lease.token,payload});return payload;
  }catch(error){try{await cache('release',{key:cacheKey,kind,token:lease.token});}catch{}throw error;}
 }
 return {configured,
  async geocode(address){
   const cleaned=text(address);if(cleaned.length<8||String(address||'').length>500)throw fail('Informe um endereço completo de até 500 caracteres.',400);
   const id=await digest(JSON.stringify(['geoapify-v1-br',cleaned.toLocaleLowerCase('pt-BR').replace(/\s+/g,' ')]));
   return request('geocode',id,{text:cleaned,filter:'countrycode:br',format:'json',lang:'pt',limit:3},data=>{
    if(!Array.isArray(data.results))throw fail('Resposta inválida do serviço de coordenadas.');
    return {results:data.results.filter(r=>r.country_code==='br'&&coordinates(r.lat,r.lon)).slice(0,3).map(r=>({latitude:r.lat,longitude:r.lon,label:text(r.formatted),resultType:text(r.result_type),confidence:Number.isFinite(r.rank?.confidence)?r.rank.confidence:0,city:text(r.city||r.town),stateCode:text(r.state_code),provider:'Geoapify/OpenStreetMap'}))};
   });
  },
  async route(from,to){
   if(!coordinates(from.lat,from.lng)||!coordinates(to.lat,to.lng))throw fail('Coordenadas inválidas para calcular a rota.',400);
   return request('route',await routeCacheKey(from,to),{waypoints:`${from.lat},${from.lng}|${to.lat},${to.lng}`,mode:'drive',units:'metric',format:'json',lang:'pt'},data=>{
    const result=data.results?.[0];
    if(!result) return {status:'Erro',error:'Rota não encontrada',provider:'Geoapify/OpenStreetMap'};
    if(result.distance_units!=='Meters'||!Number.isFinite(result.distance)||result.distance<=0||!Number.isFinite(result.time)||result.time<0)throw fail('O serviço devolveu uma distância rodoviária inválida.');
    return {status:'Calculada',distance_km:result.distance/1000,duration_minutes:result.time/60,provider:'Geoapify/OpenStreetMap',calculated_at:new Date().toISOString()};
   });
  }
 };
}
