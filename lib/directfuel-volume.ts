export type Row = Record<string, unknown>;
export const defaults = {capacidade:{normalAte:80,atencaoAte:90,suspeitoAte:95},janelasHoras:[2,6,12,24]};
export type Params = typeof defaults;
export const statuses=['Pendente','Justificado','Erro de cadastro','Erro de abastecimento/NF','Abastecimento complementar','Inconsistência confirmada'];
export const plate=(x:unknown)=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const productGroup=(x:unknown)=>{const v=String(x||'').toUpperCase();return v.includes('ARLA')?'ARLA 32':v.includes('DIESEL')||/\bS[- ]?(10|500)\b/.test(v)?'Diesel':v||'Produto não identificado';};
// Reading legacy settings retains only the two supported sections. No historical score is applied.
export function simpleParameters(value: unknown):Params {
 const p=value as {capacidade?:Record<string,unknown>;janelasHoras?:number[]}|null,c=p?.capacidade;
 // Replace the former default bands while preserving genuinely customized legacy limits.
 const legacyDefault=c?.normalAte===70&&c?.atencaoAte===85&&c?.suspeitoAte===95;
 const result={capacidade:legacyDefault||!c?{...defaults.capacidade}:{normalAte:Number(c.normalAte),atencaoAte:Number(c.atencaoAte),suspeitoAte:Number(c.suspeitoAte)},janelasHoras:p?.janelasHoras||[...defaults.janelasHoras]};
 return validate(result)?structuredClone(defaults):result;
}
export function validate(p:Params):string {
 try {
 if(Object.keys(p).some(k=>!['capacidade','janelasHoras'].includes(k)))return 'Use apenas Capacidade do tanque e Janelas de abastecimento.';
 const c=p.capacidade,values=[c.normalAte,c.atencaoAte,c.suspeitoAte];
 if(Object.keys(c).length!==3||values.some((x,i)=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>=100||(i>0&&x<=values[i-1])))return 'Informe três limites crescentes, maiores ou iguais a zero e menores que 100%.';
 if(!Array.isArray(p.janelasHoras)||p.janelasHoras.length!==4||p.janelasHoras.some((x,i)=>typeof x!=='number'||!Number.isFinite(x)||x<=0||x>720||(i>0&&x<=p.janelasHoras[i-1])))return 'Informe quatro janelas crescentes, maiores que zero e até 720 horas.';
 return '';
 }catch{return 'Parâmetros inválidos.';}
}
const num=(x:unknown)=>{const n=Number(x);return Number.isFinite(n)?n:0;};
export function calcularAuditoriaVolume(input:Row[],frota:Row[],p:Params=defaults){
 const error=validate(p);if(error)throw new Error(error);
 const fleet=new Map(frota.map(f=>[plate(f.placa),f])),seen=new Set<string>();
 const rows=input.map(r=>{
 const placa=plate(r.placa),litros=num(r.qt),date=String(r.data||''),hour=String(r.hora||'');
 const validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
 const validHour=/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(hour);
 // Compare source wall-clock timestamps; do not infer or convert a timezone absent in the file.
 const time=validDate&&validHour?Date.parse(`${date}T${hour.length===5?hour+':00':hour}Z`):null;
 const key=String(r.key||r.id||JSON.stringify([placa,date,hour,r.produto,r.posto,litros,r.total,r.motorista]));const duplicate=seen.has(key);seen.add(key);
 return {key,reference:String(r.reference||r.id||key),fonte:String(r.fonte||'Origem não identificada'),canalOrigem:String(r.canalOrigem||''),produto:String(r.produto||''),productGroup:productGroup(r.produto),placa,litros,total:num(r.total),posto:String(r.posto||''),motorista:String(r.motorista||''),data:date,hora:hour,time,day:validDate?date:'',duplicate};
 });
 type Item=typeof rows[number];
 const groups=new Map<string,Item[]>();for(const r of rows){const key=r.placa+'|'+r.productGroup;const g=groups.get(key)||[];g.push(r);groups.set(key,g);}
 const evidence=(r:Item)=>({key:r.key,reference:r.reference,fonte:r.fonte,data:r.data,hora:r.hora,posto:r.posto,motorista:r.motorista,produto:r.produto,litros:r.litros});
 const results=[];
 for(const group of groups.values()){
 const eligible=group.filter(r=>!r.duplicate&&r.litros>0&&r.placa&&r.day&&['Diesel','ARLA 32'].includes(r.productGroup));
 const byDay=new Map<string,Item[]>();for(const r of eligible){const day=byDay.get(r.day)||[];day.push(r);byDay.set(r.day,day);}
 const timed=eligible.filter(r=>r.time!==null).sort((a,b)=>a.time!-b.time!||a.key.localeCompare(b.key));
 const bound=(time:number,inclusive:boolean)=>{let lo=0,hi=timed.length;while(lo<hi){const m=(lo+hi)>>1;if(timed[m].time!<time||(inclusive&&timed[m].time===time))lo=m+1;else hi=m;}return lo;};
 for(const r of group){
 const vehicle=fleet.get(r.placa),knownProduct=['Diesel','ARLA 32'].includes(r.productGroup),valid=!r.duplicate&&r.litros>0&&!!r.placa,issues:string[]=[];
 const cap=r.productGroup==='Diesel'?num(vehicle?.capTanque):r.productGroup==='ARLA 32'?num(vehicle?.capTanqueArla):0;
 const capacidade=cap>0?cap:null,percent=valid&&capacidade?r.litros/capacidade*100:null;
 if(!r.placa)issues.push('Placa ausente');if(!vehicle)issues.push('Placa sem cadastro');if(r.litros<=0)issues.push('Litros inválidos');if(r.duplicate)issues.push('Registro duplicado: excluído dos totais e comparações');if(!r.day)issues.push('Data ausente ou inválida');if(!knownProduct)issues.push('Produto não identificado como diesel ou ARLA');
 if(!r.posto)issues.push('Posto ausente');if(!r.motorista)issues.push('Motorista ausente');
 let capacityClass='Não avaliada',capacityReason='';
 if(percent!==null){const c=p.capacidade;capacityClass=percent<=c.normalAte?'Normal':percent<=c.atencaoAte?'Atenção':percent<=c.suspeitoAte?'Suspeito':percent<=100?'Alta Atenção':'Crítico';capacityReason=`${r.litros.toFixed(2)} L ÷ ${capacidade!.toFixed(2)} L × 100 = ${percent.toFixed(2)}% · ${capacityClass}`;}
 else capacityReason=r.productGroup==='ARLA 32'?'Capacidade do reservatório de ARLA não cadastrada; não utiliza o tanque de diesel.':!capacidade?'Capacidade do tanque não cadastrada ou produto não associado.':'Registro inválido: capacidade não avaliada.';
 const dayItems=valid&&knownProduct&&r.day?(byDay.get(r.day)||[]):[];
 const dayCount=dayItems.length,dayVolume=dayItems.reduce((s,a)=>s+a.litros,0);
 const windows=p.janelasHoras.map(hours=>{const members=valid&&knownProduct&&r.time!==null?timed.slice(bound(r.time-hours*3600000,false),bound(r.time,true)):[];return {hours,count:members.length,liters:r.time!==null&&valid&&knownProduct?members.reduce((s,a)=>s+a.litros,0):null,members:members.map(evidence)};});
 const prevIndex=r.time===null?-1:bound(r.time,false)-1,previous=prevIndex>=0?timed[prevIndex]:undefined;
 const hoursPrevious=valid&&r.time!==null&&previous?(r.time-previous.time!)/3600000:null;
 const repeats=windows.filter(w=>w.count>1),windowReasons:string[]=[];
 if(dayCount>1)windowReasons.push(`${dayCount} abastecimentos de ${r.productGroup} para a mesma placa em ${r.day}: ${dayVolume.toFixed(2)} L no dia.`);
 if(repeats.length)windowReasons.push(...repeats.map(w=>`${w.count} abastecimentos de ${r.productGroup} nas últimas ${w.hours}h: ${w.liters!.toFixed(2)} L.`));
 if(r.time===null)windowReasons.push('Horário ausente ou inválido: apenas a repetição no dia pode ser avaliada.');
 const windowClass=!valid||!r.day||!knownProduct?'Não avaliada':dayCount>1||repeats.length?'Atenção':r.time===null?'Não avaliada':'Normal';
 if(!windowReasons.length)windowReasons.push(windowClass==='Normal'?'Sem repetição nas janelas configuradas ou no mesmo dia.':'Dados insuficientes para avaliar placa, produto ou data.');
 results.push({...r,capacidade,percent,capacityClass,capacityReason,windowClass,windowReasons,dayCount,dayVolume,dayMembers:dayItems.map(evidence),windows,hoursPrevious,issues,capacityLimits:{...p.capacidade}});
 }
 }
 return results.sort((a,b)=>b.data.localeCompare(a.data)||b.hora.localeCompare(a.hora)||a.key.localeCompare(b.key));
}
export function cards(rows:ReturnType<typeof calcularAuditoriaVolume>,type='capacity'){
 const unique=rows.filter(r=>!r.duplicate),classification=(r:typeof rows[number])=>type==='window'?r.windowClass:r.capacityClass;
 const flagged=unique.filter(r=>!['Normal','Não avaliada'].includes(classification(r)));
 return {analisados:unique.length,Normal:unique.filter(r=>classification(r)==='Normal').length,Atenção:unique.filter(r=>classification(r)==='Atenção').length,Suspeito:unique.filter(r=>classification(r)==='Suspeito').length,'Alta Atenção':unique.filter(r=>classification(r)==='Alta Atenção').length,Crítico:unique.filter(r=>classification(r)==='Crítico').length,'Não avaliada':unique.filter(r=>classification(r)==='Não avaliada').length,litros:flagged.reduce((s,r)=>s+Math.max(0,r.litros),0),valor:flagged.reduce((s,r)=>s+Math.max(0,r.total),0)};
}

export function auditSummary(rows:(ReturnType<typeof calcularAuditoriaVolume>[number]&{review?:Row|null})[]){
 const unique=rows.filter(r=>!r.duplicate),isAlert=(c:string)=>!['Normal','Não avaliada'].includes(c);
 const flagged=unique.filter(r=>isAlert(r.capacityClass)||isAlert(r.windowClass)),capacityFlagged=unique.filter(r=>isAlert(r.capacityClass));
 const group=(items:typeof unique)=>({analisados:items.length,alertas:items.filter(r=>isAlert(r.capacityClass)||isAlert(r.windowClass)).length});
 return {analisados:unique.length,alertas:flagged.length,capacidade:capacityFlagged.length,capacidadeResumo:cards(rows,'capacity'),criticos:unique.filter(r=>r.capacityClass==='Crítico').length,repeticoes:unique.filter(r=>isAlert(r.windowClass)).length,pendentes:flagged.filter(r=>(r.review?.status||'Pendente')==='Pendente').length,naoAvaliados:unique.filter(r=>r.capacityClass==='Não avaliada'||r.windowClass==='Não avaliada').length,origens:Object.fromEntries(['Ticketlog','DirectFuel'].map(source=>[source,group(unique.filter(r=>r.fonte===source))])),produtos:Object.fromEntries(['Diesel','ARLA 32'].map(product=>{const items=capacityFlagged.filter(r=>r.productGroup===product),summary=(rows:typeof items)=>({alertas:rows.length,litros:rows.reduce((sum,r)=>sum+Math.max(0,r.litros),0)});return [product,{...summary(items),origens:Object.fromEntries(['Ticketlog','DirectFuel'].map(source=>[source,summary(items.filter(r=>r.fonte===source))]))}];}))};
}
