import {completedDocumentCandidates} from './core/directfuel-completed-documents.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const removedRows=docs=>docs.filter(d=>d.removed_at).map(d=>({object_key:`danfes/${d.measurement_id}.${d.content_type.includes('xml')?'xml':'pdf'}`,created_at:d.removed_at,cleanup_pending:d.cleanup_pending}));
export function documentManifest(state,docs){
 const map=new Map(docs.filter(d=>!d.removed_at).map(d=>[d.id,d]));
 return completedDocumentCandidates(state).map(file=>({...file,present:map.has(`${file.id}:${file.type}`),bytes:map.get(`${file.id}:${file.type}`)?.byte_size||0}));
}
export async function handleCompleted({method,parsed,body,readState,document,removeObject}){
 const docs=await document('list'),removed=removedRows(docs);
 if(method==='GET'&&parsed.searchParams.has('status'))return {removed};
 if(method==='POST'&&body.action==='cleanup_pending'){
  if(body.confirmation!=='EXCLUIR SOMENTE ARQUIVOS'||!['pdf','xml'].includes(body.type)||!/^[A-Za-z0-9_-]{1,100}$/.test(body.id||''))throw fail('Confirmação ou arquivo inválido.');
  const doc=docs.find(d=>d.id===`${body.id}:${body.type}`&&d.removed_at&&d.cleanup_pending);
  if(!doc)throw fail('Limpeza pendente não encontrada. Atualize a lista.',409);
  await removeObject(doc.object_path);await document('cleanup_complete',doc.id,{path:doc.object_path});return {ok:true,bytes:Number(doc.byte_size)};
 }

 const current=await readState(),candidates=completedDocumentCandidates(current.state||{}),map=new Map(docs.filter(d=>!d.removed_at).map(d=>[d.id,d]));
 if(method==='GET'){
  const files=candidates.filter(f=>map.has(`${f.id}:${f.type}`)).map(f=>({...f,bytes:map.get(`${f.id}:${f.type}`).byte_size,etag:map.get(`${f.id}:${f.type}`).sha256}));
  return {version:current.version,files,eligibleCount:files.filter(f=>f.eligible).length,bytes:files.filter(f=>f.eligible).reduce((sum,f)=>sum+Number(f.bytes),0),removed};
 }
 if(method!=='POST')throw fail('Método não permitido.',405);
 if(body.confirmation!=='EXCLUIR SOMENTE ARQUIVOS'||!Number.isSafeInteger(body.version)||!body.id||!/^[A-Za-z0-9_-]{1,100}$/.test(body.id)||!['pdf','xml'].includes(body.type)||!body.etag||body.id.startsWith('NF_LAYOUT_'))throw fail('Confirmação ou arquivo inválido.');
 if(current.version!==body.version)throw fail('A base mudou. Analise novamente antes de excluir.',409);
 const candidate=candidates.find(f=>f.id===body.id&&f.type===body.type);
 if(!candidate?.eligible)throw fail('Arquivo protegido: nem todos os vínculos estão concluídos no SAP.',409);
 const doc=map.get(`${body.id}:${body.type}`);if(!doc||doc.sha256!==body.etag)throw fail('O arquivo mudou. Analise novamente.',409);
 // The RPC serializes the revision and document hash check with all state writers and uploads.
 const meta=await document('remove_completed',doc.id,{version:body.version,sha256:body.etag,references:candidate.references});
 await removeObject(meta.object_path);
 await document('cleanup_complete',doc.id,{path:meta.object_path});
 return {ok:true,id:body.id,type:body.type,bytes:Number(meta.byte_size)};
}
