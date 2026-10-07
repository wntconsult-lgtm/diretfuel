import {completedDocumentCandidates} from './core/directfuel-completed-documents.mjs';
const rows=v=>Array.isArray(v)?v:[],text=v=>String(v??'').trim();
const key=n=>[n.numero,n.serie].map(v=>text(v).replace(/^0+(?=\d)/,'')).join('-');
const validDate=v=>{const s=text(v).slice(0,10),t=Date.parse(s);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:'';};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function planRetention(state,documents,now=new Date(),email='Sistema'){
 const previous=structuredClone(state);delete previous.audit;
 const params=previous.config?.params||{},configured=Number(params.documentRetentionDays),days=Number.isFinite(configured)?Math.min(3650,Math.max(7,Math.round(configured))):180;
 const p=params.documentRetentionPolicy||{},policy={removePdf:p.removePdf!==false,removeXml:p.removeXml!==false,compactFiscalDetails:p.compactFiscalDetails!==false},cutoff=new Date(now.getTime()-days*86400000).toISOString().slice(0,10);
 const postings=rows(previous.sapReturns).filter(r=>!r.voided),eligible=new Set(),references=new Map();
 rows(previous.medicoes).forEach((m,mi)=>rows(m.notasFiscais).forEach((n,ni)=>{
  const id=`${mi}:${ni}`,pdf=text(n.documentoPdfId||(n.pdfDocumento?n.id:'')),xml=n.xmlDocumento?text(n.id):'';
  for(const [docId,type]of [[pdf,'pdf'],[xml,'xml']])if(docId){const k=docId+':'+type;references.set(k,[...(references.get(k)||[]),id]);}
  if(m.status!=='Aprovada'||!text(n.numero)||!text(n.serie)||!/^\d{44}$/.test(text(n.chave||n.chaveNfe).replace(/\D/g,'')))return;
  if(rows(m.notasFiscais).filter(other=>key(other)===key(n)).length!==1)return;
  const matches=postings.filter(r=>text(r.measurementId)===text(m.id)&&key({numero:text(r.invoiceKey).split('-')[0],serie:text(r.invoiceKey).split('-')[1]})===key(n));
  if(!matches.length||!matches.every(r=>r.status==='success'&&/^\d+$/.test(text(r.purchaseOrder))&&validDate(r.postingDate)&&validDate(r.postingDate)<=cutoff))return;
  eligible.add(id);
 }));
 const candidates=new Map(completedDocumentCandidates(previous).map(c=>[c.id+':'+c.type,c])),active=new Map(rows(documents).filter(d=>!d.removed_at).map(d=>[d.id,d])),remove=new Map();let missing=0;
 for(const [id,refs]of references){const type=id.split(':').at(-1);if(!policy[type==='pdf'?'removePdf':'removeXml']||!candidates.get(id)?.eligible||!refs.every(r=>eligible.has(r)))continue;
  const doc=active.get(id);if(doc)remove.set(id,doc);else missing++;
 }
 const next=structuredClone(previous),measurementIds=new Set();let notes=0;
 rows(next.medicoes).forEach((m,mi)=>rows(m.notasFiscais).forEach((n,ni)=>{
  if(!eligible.has(`${mi}:${ni}`))return;const pdf=text(n.documentoPdfId||(n.pdfDocumento?n.id:'')),xml=n.xmlDocumento?text(n.id):'',removePdf=remove.has(pdf+':pdf')&&!n.documentoPdfRemovido,removeXml=remove.has(xml+':xml')&&!n.documentoXmlRemovido,compact=policy.compactFiscalDetails&&!n.arquivada;
  if(!removePdf&&!removeXml&&!compact)return;
  if(compact){for(const field of ['itens','items','parcelas','duplicatas','textoExtraido','danfeTexto','xmlTexto','rawText','rawXml','extractedText'])delete n[field];n.arquivada=true;n.arquivadaEm=now.toISOString();n.arquivadaPor=email;n.detalhesCompactadosEm=now.toISOString();n.consultaExternaPelaChave=Boolean(text(n.chave||n.chaveNfe));}
  if(removePdf){for(const field of ['pdfDocumento','documentoPdfId','pdfNome','pdfPaginaInicial','pdfPaginaFinal'])delete n[field];n.documentoPdfRemovido=true;n.pdfRemovidoEm=now.toISOString();}
  if(removeXml){delete n.xmlDocumento;delete n.xmlNome;n.documentoXmlRemovido=true;n.xmlRemovidoEm=now.toISOString();}
  n.retencaoAplicadaEm=now.toISOString();n.retencaoAplicadaPor=email;notes++;measurementIds.add(m.id);
 }));
 return {state:next,documents:[...remove.values()].sort((a,b)=>a.id.localeCompare(b.id)),retentionDays:days,policy,cutoff,notes,measurements:measurementIds.size,missingDocuments:missing,beforeBytes:bytes(previous),afterBytes:bytes(next),savedBytes:Math.max(0,bytes(previous)-bytes(next))};
}
const preview=(plan,version,limitBytes)=>({version,retentionDays:plan.retentionDays,policy:plan.policy,cutoff:plan.cutoff,notes:plan.notes,measurements:plan.measurements,documents:plan.documents.length,missingDocuments:plan.missingDocuments,documentBytes:plan.documents.reduce((s,d)=>s+Number(d.byte_size),0),stateBytesBefore:plan.beforeBytes,stateBytesAfter:plan.afterBytes,stateBytesSaved:plan.savedBytes,limitBytes});
export async function handleRetention({method,body,current,documents,execute,cleanup,now=new Date(),limitBytes}){
 const plan=planRetention(current.state||{},documents,now,current.user.email),summary=preview(plan,current.version,limitBytes);
 if(method==='GET')return summary;
 if(method!=='POST')throw fail('Método não permitido.',405);
 if(body.confirmation!=='ARQUIVAR DANFES'||!Number.isSafeInteger(body.version))throw fail('Confirmação de segurança inválida.');
 if(body.version!==current.version)throw fail('A base foi alterada. Analise novamente antes de executar.',409);
 if(!plan.notes)return {ok:true,...summary,removedDocuments:0};
 if(plan.afterBytes>limitBytes)throw fail('A base excedeu o limite de sincronização.',413);
 const result=await execute(plan);let removedDocuments=0,cleanupPending=0;
 for(const [index,doc]of result.documents.entries()){if(index>=3){cleanupPending++;continue;}try{await cleanup(doc);removedDocuments++;}catch{cleanupPending++;}}
 return {ok:true,version:result.version,notes:plan.notes,measurements:plan.measurements,removedDocuments,cleanupPending,stateBytesSaved:plan.savedBytes};
}
