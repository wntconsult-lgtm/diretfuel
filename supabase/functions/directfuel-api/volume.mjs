import {auditSummary,defaults,simpleParameters,validate,calcularAuditoriaVolume,cards,statuses,plate} from './core/directfuel-volume.mjs';
const fault=(message,status=400)=>Object.assign(new Error(message),{status});
export function volumeSource(state){
const direct=(state.abastecimentos||[]).map((r)=>({...r,fonte:String(r.origem||'').toLowerCase().includes('ticket')?'Ticketlog':'DirectFuel',canalOrigem:String(r.origem||'DirectFuel'),reference:String(r.id||''),produto:(state.produtos||[]).find((p)=>p.id===r.produtoId)?.curta||r.produto||'',key:r.id?'direct:'+String(r.id):'direct:fingerprint:'+JSON.stringify([plate(r.placa),r.data,r.hora,r.postoId,r.qt,r.total,r.motorista]),posto:(state.postos||[]).find((p)=>p.id===r.postoId)?.fantasia||r.postoId}));const imported=(state.ticketlogFuelings||[]).map(r=>({fonte:'Ticketlog',canalOrigem:'Importação Ticketlog',reference:String(r.transaction_code),key:'ticket:'+r.transaction_code,id:r.id,placa:r.plate,data:String(r.occurred_on).slice(0,10),produto:r.product,hora:r.occurred_time||String(r.occurred_on).match(/[T ](\d{2}:\d{2}(?::\d{2})?)/)?.[1]||'',qt:r.liters,total:r.final_value,posto:r.station_name,motorista:r.driver_name}));return {rows:[...direct,...imported],fleet:state.frota||[]};}
export async function handleVolume({state,body,method,email,persist}){
 const current={parameters:state.volumeParameters?.parameters?simpleParameters(state.volumeParameters.parameters):defaults,version:Number(state.volumeParameters?.version||0)},now=new Date().toISOString();
 if(method==='GET')return {...current,defaults,statuses,canConfigure:true,canReview:true};
 if(body.action==='history')return {history:(state.volumeParameterHistory||[]).slice(-200).reverse()};
 if(body.action==='save'){
  const error=validate(body.parameters);if(error)throw fault(error);
  if(body.version!==current.version)throw fault('Parâmetros alterados. Reabra a tela antes de salvar.',409);
  const parameters=simpleParameters(body.parameters),changes=[];
  for(const [section,value]of Object.entries(parameters)){
   if(Array.isArray(value)){if(JSON.stringify(value)!==JSON.stringify(current.parameters[section]))changes.push({parameter:section,before:current.parameters[section],after:value});}
   else for(const [key,value2]of Object.entries(value)){const old=current.parameters[section]?.[key];if(old!==value2)changes.push({parameter:section+'.'+key,before:old,after:value2});}
  }
  if(!changes.length)return current;
  const next=structuredClone(state);next.volumeParameters={parameters,version:current.version+1};
  next.volumeParameterHistory=[...(next.volumeParameterHistory||[]),{id:crypto.randomUUID(),version:current.version+1,changes:JSON.stringify(changes),created_at:now,created_by:email}];
  await persist(next);return next.volumeParameters;
 }
 if(body.action==='review'){
  if(!statuses.includes(body.status)||typeof body.key!=='string'||typeof body.observation!=='string'||body.observation.length>3000)throw fault('Tratamento inválido.');
  if(!volumeSource(state).rows.some(r=>r.key===body.key))throw fault('Abastecimento não encontrado.',404);
  const old=(state.volumeReviews||[]).find(r=>r.record_key===body.key);
  if((old?.updated_at||null)!==(body.updatedAt||null))throw fault('Ocorrência tratada por outro usuário. Atualize os resultados.',409);
  const review={id:old?.id||crypto.randomUUID(),record_key:body.key,status:body.status,observation:body.observation,updated_at:new Date(Math.max(Date.now(),Date.parse(old?.updated_at||'')+1||0)).toISOString(),updated_by:email};
  const next=structuredClone(state);next.volumeReviews=[...(next.volumeReviews||[]).filter(r=>r.record_key!==body.key),review];await persist(next);return {review};
 }
 if(!['calculate','simulate','summary'].includes(body.action))throw fault('Ação inválida.');
 const p=body.action==='simulate'?body.parameters:current.parameters,error=validate(p);if(error)throw fault(error);
 const data=volumeSource(state),raw=body.filters||{},one=(key)=>{const value=raw[key];return Array.isArray(value)?String(value[0]||''):String(value||'');},many=(key)=>{const value=raw[key];return (Array.isArray(value)?value:[value]).filter(Boolean).map(String);};
 const f={from:one('from'),to:one('to'),plate:body.action==='summary'?'':one('plate'),station:body.action==='summary'?'':one('station'),driver:body.action==='summary'?'':one('driver'),source:body.action==='summary'?'':one('source'),product:body.action==='summary'?'':one('product'),auditType:body.action==='summary'?'':one('auditType'),classification:body.action==='summary'?[]:many('classification'),status:body.action==='summary'?[]:many('status')};
 if(f.from&&f.to&&f.from>f.to)throw fault('Data inicial deve ser anterior à data final.');
 const selected=data.rows.filter(r=>(!f.from||String(r.data)>=f.from)&&(!f.to||String(r.data)<=f.to)&&(!f.plate||plate(r.placa).includes(plate(f.plate)))&&(!f.station||String(r.posto||'').toLowerCase().includes(String(f.station).toLowerCase()))&&(!f.driver||String(r.motorista||'').toLowerCase().includes(String(f.driver).toLowerCase()))),plates=new Set(selected.map(r=>plate(r.placa))),keys=new Set(selected.map(r=>r.key));
 const relevant=data.rows.filter(r=>plates.has(plate(r.placa))&&(!f.to||String(r.data)<=f.to));const reviewMap=new Map((state.volumeReviews||[]).map(r=>[r.record_key,r]));
 const run=(params)=>calcularAuditoriaVolume(relevant,data.fleet,params).filter(r=>keys.has(r.key)).map(r=>({...r,review:reviewMap.get(r.key)||null})).filter(r=>(!f.classification.length||f.classification.includes(f.auditType==='window'?r.windowClass:r.capacityClass))&&(!f.status.length||f.status.includes(String(r.review?.status||'Pendente')))&&(!f.source||r.fonte===f.source)&&(!f.product||r.productGroup===f.product));
 const rows=run(p);if(body.action==='summary')return ({summary:auditSummary(rows),calculatedAt:now,version:current.version});return ({rows:body.action==='calculate'?rows:[],cards:cards(rows,f.auditType),before:body.action==='simulate'?cards(run(current.parameters),f.auditType):null,version:current.version,calculatedAt:now});
}
