const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const upper=(v,max=80)=>clean(v,max).toUpperCase().replace(/\s+/g,'');
const plate=v=>upper(v,20).replace(/[^A-Z0-9]/g,'');
const num=v=>{const s=clean(v,60),n=Number(s.includes(',')?s.replace(/\./g,'').replace(',','.'):s);return Number.isFinite(n)?n:0;};
const fault=(message,status=400)=>Object.assign(new Error(message),{status});
const date=v=>{const s=clean(v,30),a=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/),b=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);const d=a?`${a[1]}-${a[2].padStart(2,'0')}-${a[3].padStart(2,'0')}`:b?`${b[3]}-${b[2].padStart(2,'0')}-${b[1].padStart(2,'0')}`:'';const t=Date.parse(d+'T00:00:00Z');return d&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d?d:'';};
const coordinate=(v,max)=>{let n=num(v);if(Math.abs(n)>max&&Number.isInteger(n)&&Math.abs(n)>=1e6)n/=1e6;return n&&Math.abs(n)<=max?n:null;};
const sum=(rows,key)=>rows.reduce((n,r)=>n+num(r[key]),0);
const nameOrder=(a,b)=>String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id));
export function readTicketlog(state,search){
 const fuelings=state.ticketlogFuelings||[],stations=[...(state.ticketlogStations||[])].sort(nameOrder),batches=state.ticketlogBatches||[];
 if(search.get('report')==='stations'){const offset=Math.max(0,Math.floor(Number(search.get('offset'))||0)),page=stations.slice(offset,offset+1000);return {stations:page,nextOffset:page.length===1000?offset+1000:null};}
 const filters=Object.fromEntries(['fuelingFrom','fuelingTo','batchFrom','batchTo'].map(k=>[k,date(search.get(k))]));
 for(const prefix of ['fueling','batch'])if(filters[prefix+'From']&&filters[prefix+'To']&&filters[prefix+'From']>filters[prefix+'To'])throw fault('A data inicial deve ser anterior à data final.');
 const between=(s,from,to)=>(!from||s>=from)&&(!to||s<=to),pending=fuelings.filter(r=>r.vehicle_link_status!=='Vinculado'),groups=new Map();
 for(const r of pending){const p=plate(r.plate),g=groups.get(p)||{plate:p,vehicle_model:'',records:0,liters:0,first_date:r.occurred_on,last_date:r.occurred_on};g.records++;g.liters+=num(r.liters);g.vehicle_model=[g.vehicle_model,r.vehicle_model||''].sort().at(-1);g.first_date=g.first_date<r.occurred_on?g.first_date:r.occurred_on;g.last_date=g.last_date>r.occurred_on?g.last_date:r.occurred_on;groups.set(p,g);}
 const dates=fuelings.map(r=>r.occurred_on).sort(),geocoded=stations.filter(r=>r.latitude!=null&&r.longitude!=null).length;
 return {summary:{records:fuelings.length,liters:sum(fuelings,'liters'),value:sum(fuelings,'final_value'),linked:fuelings.length-pending.length,pending:pending.length,pending_plates:groups.size,first_date:dates[0]||null,last_date:dates.at(-1)||null},stationSummary:{records:stations.length,geocoded,pending_geocode:stations.length-geocoded},stations:stations.slice(0,2000),recent:fuelings.filter(r=>between(r.occurred_on,filters.fuelingFrom,filters.fuelingTo)).sort((a,b)=>`${b.occurred_on}|${b.occurred_time||''}|${b.transaction_code}`.localeCompare(`${a.occurred_on}|${a.occurred_time||''}|${a.transaction_code}`)).slice(0,500),pendingPlates:[...groups.values()].sort((a,b)=>b.records-a.records||a.plate.localeCompare(b.plate)).slice(0,200),batches:batches.filter(b=>between(b.created_at.slice(0,10),filters.batchFrom,filters.batchTo)).map(b=>{const rows=fuelings.filter(r=>r.import_batch_id===b.id);const {chunks,...publicBatch}=b;return {...publicBatch,current_records:rows.length,current_liters:sum(rows,'liters')};}).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,200),filters,canReprocessLinks:true,canDelete:true};
}
export async function mutateTicketlog({state,body,email,persist}){
 const next=structuredClone(state),now=new Date().toISOString();
 for(const k of ['ticketlogStations','ticketlogFuelings','ticketlogBatches'])next[k]||=[];
 const fleet=new Map((state.frota||[]).map(r=>[plate(r.placa),r.id]));
 if(body.action==='reprocess-links'){
  let linked=0;for(const row of next.ticketlogFuelings){row.vehicle_id=fleet.get(plate(row.plate))||null;row.vehicle_link_status=row.vehicle_id?'Vinculado':'Pendente de vínculo';if(row.vehicle_id)linked++;}
  await persist(next);return {ok:true,records:next.ticketlogFuelings.length,linked,pending:next.ticketlogFuelings.length-linked,fleetPlates:fleet.size};
 }
 if(['delete-fueling','delete-batch'].includes(body.action)){
  let removed,filename,transactionCode;
  if(body.action==='delete-fueling'){const row=next.ticketlogFuelings.find(r=>r.id===body.fuelingId);if(!row)throw fault('Abastecimento não encontrado ou já excluído.',404);removed=[row];transactionCode=row.transaction_code;}
  else {const batch=next.ticketlogBatches.find(r=>r.id===body.batchId);if(!batch)throw fault('Carga não encontrada ou já excluída.',404);if(batch.kind!=='fuelings')throw fault('Postos devem ser corrigidos por uma nova carga.',409);removed=next.ticketlogFuelings.filter(r=>r.import_batch_id===batch.id);filename=batch.filename;next.ticketlogBatches=next.ticketlogBatches.filter(r=>r.id!==batch.id);}
  const ids=new Set(removed.map(r=>r.id)),keys=new Set(removed.map(r=>'ticket:'+r.transaction_code));next.ticketlogFuelings=next.ticketlogFuelings.filter(r=>!ids.has(r.id));next.volumeReviews=(next.volumeReviews||[]).filter(r=>!keys.has(r.record_key));await persist(next,true);return {ok:true,deleted:removed.length,liters:sum(removed,'liters'),filename,transactionCode};
 }
 const kind=body.kind,batchId=clean(body.batchId,80);
 if(!['stations','fuelings'].includes(kind)||!batchId)throw fault('Tipo ou lote de importação inválido.');
 let batch=next.ticketlogBatches.find(b=>b.id===batchId);
 if(batch&&batch.kind!==kind)throw fault('Este lote pertence a outro tipo de carga.',409);
 if(body.action==='finish'){
  if(!batch)throw fault('Importe os registros antes de concluir a carga.',409);
  if(batch.status==='complete')return {ok:true};
  batch.filename=clean(body.filename,220)||'carga.csv';batch.status='complete';await persist(next);return {ok:true};
 }
 if(body.action!=='import'||!Array.isArray(body.records)||!body.records.length||body.records.length>500)throw fault('Envie de 1 a 500 registros por lote.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body.records))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(batch?.chunks?.[hash])return batch.chunks[hash];
 if(batch?.status==='complete')throw fault('Carga concluída. Inicie uma nova importação.',409);
 if(!batch){batch={id:batchId,kind,filename:'Carga em andamento',status:'in_progress',imported:0,duplicated:0,updated:0,rejected:0,created_at:now,created_by:email,chunks:{}};next.ticketlogBatches.push(batch);}
 const result={ok:true,imported:0,duplicated:0,updated:0,rejected:0,geocoded:0,pendingGeocode:0,errors:[]};
 const rows=kind==='stations'?next.ticketlogStations:next.ticketlogFuelings,map=new Map(rows.map(r=>[kind==='stations'?r.source_code:r.transaction_code,r]));
 for(const [index,r]of body.records.entries()){
  if(!r||typeof r!=='object'||Array.isArray(r)){result.rejected++;if(result.errors.length<20)result.errors.push({row:index+1,error:'Registro inválido.'});continue;}
  if(kind==='stations'){
   const code=upper(r.sourceCode||r.stationCode),name=clean(r.name||r.stationName,180),city=clean(r.city,120),uf=upper(r.uf,2);
   if(!code||!name||!city||!/^[A-Z]{2}$/.test(uf)){result.rejected++;if(result.errors.length<20)result.errors.push({row:index+1,error:'Código, posto, município ou UF inválido.'});continue;}
   const old=map.get(code),lat=coordinate(r.latitude,90),lng=coordinate(r.longitude,180),valid=lat!==null&&lng!==null;
   const row={id:old?.id||crypto.randomUUID(),source_code:code,name,cnpj:clean(r.cnpj,30)||null,address:clean(r.address,240)||null,neighborhood:clean(r.neighborhood,120)||null,city,uf,cep:clean(r.cep,20)||null,latitude:valid?lat:null,longitude:valid?lng:null,geocode_status:valid?'Informado':'Pendente',active:clean(r.active??'Sim').toLocaleLowerCase('pt-BR')!=='não'?1:0,created_at:old?.created_at||now,created_by:old?.created_by||email,updated_at:now,updated_by:email};
   if(old)Object.assign(old,row);else{rows.push(row);map.set(code,row);}result.imported++;result[valid?'geocoded':'pendingGeocode']++;continue;
  }
  const rawTime=clean(r.occurredTime,20),time=rawTime?(rawTime.length===5?rawTime+':00':rawTime):null,transaction=clean(r.transactionCode,80),day=date(r.occurredOn),p=upper(r.plate,20),code=upper(r.stationCode),name=clean(r.stationName,180),liters=num(r.liters),service=clean(r.service,80)||'Abastecimento',product=clean(r.product,120);
  if((rawTime&&!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rawTime))||!transaction||!day||!p||!code||!name||liters<=0||service.toLocaleLowerCase('pt-BR')!=='abastecimento'){result.rejected++;if(result.errors.length<20)result.errors.push({row:index+1,error:'Transação, data, horário, placa, posto, serviço ou litros inválido.'});continue;}
  const old=map.get(transaction);
  if(old){if(time&&old.occurred_on===day&&plate(old.plate)===plate(p)&&old.station_code===code&&Math.abs(num(old.liters)-liters)<1e-6&&(old.product||'')===product&&old.occurred_time!==time){old.occurred_time=time;result.updated++;}else result.duplicated++;continue;}
  const row={id:crypto.randomUUID(),transaction_code:transaction,occurred_on:day,occurred_time:time,plate:p,service,product:product||null,liters,station_code:code,station_name:name,uf:upper(r.uf,2)||null,vehicle_id:fleet.get(plate(p))||null,import_batch_id:batchId,imported_at:now,imported_by:email};
  for(const [key,input,max]of [['client_code','clientCode',80],['client_name','clientName',180],['directorate','directorate',120],['responsible','responsible',120],['fleet_type','fleetType',100],['vehicle_model','vehicleModel',140],['driver_code','driverCode',80],['driver_name','driverName',180],['city','city',120]])row[key]=clean(r[input],max)||null;
  for(const [key,input]of [['original_price','originalPrice'],['final_price','finalPrice'],['final_value','finalValue'],['odometer','odometer']])row[key]=num(r[input]);
  row.vehicle_link_status=row.vehicle_id?'Vinculado':'Pendente de vínculo';rows.push(row);map.set(transaction,row);result.imported++;
 }
 batch.chunks||={};batch.chunks[hash]=result;for(const key of ['imported','duplicated','updated','rejected'])batch[key]+=result[key];await persist(next);return result;
}
