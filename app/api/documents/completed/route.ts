import { env } from 'cloudflare:workers';
import { requireVixparUser, WORKSPACE_ID } from '@/lib/directfuel-access';
import { completedDocumentCandidates } from '@/lib/directfuel-completed-documents';
import { hasPermission } from '@/lib/directfuel-security';
import { decodeStoredState } from '@/lib/directfuel-state-codec';
export const dynamic = 'force-dynamic';
type StateRow={data:string;version:number};
const objectKey=(id:string,type:string)=>`${WORKSPACE_ID}/danfes/${id}.${type}`;
async function current() {
  const row=await env.DB.prepare('SELECT data, version FROM app_state WHERE workspace_id = ?').bind(WORKSPACE_ID).first<StateRow>();
  if(!row) throw Error('Base não encontrada.');
  return {row,state:await decodeStoredState<Record<string,unknown>>(row.data)};
}
export async function GET(request:Request) {
  const access=await requireVixparUser();
  if('error' in access)return Response.json({error:access.error},{status:access.status});
  if(!hasPermission(access,'documentos'))return Response.json({error:'Seu perfil não permite acessar documentos.'},{status:403});
  try {
    const removed=await env.DB.prepare("SELECT object_key, created_at, created_by FROM document_removals WHERE workspace_id = ? AND status = 'deleted'").bind(WORKSPACE_ID).all();
    if(new URL(request.url).searchParams.has('status')) return Response.json({removed:removed.results},{headers:{'cache-control':'private, no-store'}});
    if(!access.isOwner)return Response.json({error:'Somente o Master pode analisar a exclusão.'},{status:403});
    const {row,state}=await current();
    const candidates=completedDocumentCandidates(state);
    const files=[];
    // Only metadata is read; no file is changed during preview.
    for(const file of candidates) {
      const head=await env.BUCKET.head(objectKey(file.id,file.type));
      if(head)files.push({...file,bytes:head.size,etag:head.etag});
    }
    const eligible=files.filter(f=>f.eligible);
    return Response.json({version:row.version,files,eligibleCount:eligible.length,bytes:eligible.reduce((s,f)=>s+f.bytes,0),removed:removed.results},{headers:{'cache-control':'private, no-store'}});
  } catch(error){console.error('Document preview failed',error);return Response.json({error:'Não foi possível analisar os arquivos. Tente novamente.'},{status:503});}
}
export async function POST(request:Request) {
  const access=await requireVixparUser();
  if('error' in access)return Response.json({error:access.error},{status:access.status});
  if(!access.isOwner)return Response.json({error:'Somente o Master pode excluir arquivos concluídos.'},{status:403});
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origem não autorizada.'},{status:403});
  const body=await request.json().catch(()=>({})) as {id?:string;type?:string;version?:number;etag?:string;confirmation?:string};
  if(body.confirmation!=='EXCLUIR SOMENTE ARQUIVOS'||!Number.isInteger(body.version)||!body.id||!/^[A-Za-z0-9_-]{1,100}$/.test(body.id)||!['pdf','xml'].includes(body.type||'')||!body.etag||body.id.startsWith('NF_LAYOUT_'))return Response.json({error:'Confirmação ou arquivo inválido.'},{status:400});
  const key=objectKey(body.id,body.type!),token=crypto.randomUUID(),now=new Date().toISOString();
  let acquired=false,deleted=false;
  try {
    const {row,state}=await current();
    if(row.version!==body.version)return Response.json({error:'A base mudou. Analise novamente antes de excluir.'},{status:409});
    const candidate=completedDocumentCandidates(state).find(f=>f.id===body.id&&f.type===body.type);
    if(!candidate?.eligible)return Response.json({error:'Arquivo protegido: nem todos os vínculos estão concluídos no SAP.'},{status:409});
    const head=await env.BUCKET.head(key);
    if(!head)return Response.json({error:'Arquivo já indisponível. Atualize a análise.'},{status:409});
    if(head.etag!==body.etag)return Response.json({error:'O arquivo mudou. Analise novamente.'},{status:409});
    const detail=JSON.stringify({arquivo:key,referencias:candidate.references,bytes:head.size});
    // Atomic acquisition only while the preview state is current. State writers honor this lock.
    const lock=await env.DB.prepare(`INSERT INTO document_removals (object_key, workspace_id, status, token, expires_at, created_at, created_by, bytes, etag, detail)
      SELECT ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM app_state WHERE workspace_id = ? AND version = ?)
      ON CONFLICT(object_key) DO UPDATE SET status='pending', token=excluded.token, expires_at=excluded.expires_at, created_at=excluded.created_at, created_by=excluded.created_by, bytes=excluded.bytes, etag=excluded.etag, detail=excluded.detail
      WHERE document_removals.status NOT IN ('pending','uploading') OR document_removals.expires_at < ?`).bind(key,WORKSPACE_ID,token,new Date(Date.now()+300000).toISOString(),now,access.user.email,head.size,head.etag,detail,WORKSPACE_ID,body.version,now).run();
    if(!lock.meta.changes)return Response.json({error:'A base mudou ou o arquivo está em processamento. Atualize a análise.'},{status:409});
    acquired=true;
    const latest=await env.BUCKET.head(key);
    if(!latest||latest.etag!==head.etag)throw Error('O arquivo mudou durante a operação; exclusão cancelada.');
    await env.DB.prepare('INSERT INTO security_audit (id,workspace_id,created_at,user_email,action,entity,detail,state_version) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),WORKSPACE_ID,now,access.user.email,'Exclusão de arquivo iniciada','Documentos',detail,body.version).run();
    const lease=await env.DB.prepare("SELECT token FROM document_removals WHERE object_key=? AND token=? AND status='pending' AND expires_at > ?").bind(key,token,new Date(Date.now()+30000).toISOString()).first();
    if(!lease)throw Error('Tempo de processamento excedido; tente novamente.');
    await env.BUCKET.delete(key);
    if(await env.BUCKET.head(key))throw Error('Não foi possível confirmar a exclusão. Tente novamente.');
    deleted=true;
    await env.DB.batch([
      env.DB.prepare("UPDATE document_removals SET status='deleted', expires_at=? WHERE object_key=? AND token=?").bind(now,key,token),
      env.DB.prepare('INSERT INTO security_audit (id,workspace_id,created_at,user_email,action,entity,detail,state_version) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),WORKSPACE_ID,now,access.user.email,'Arquivo removido · dados preservados','Documentos',detail,body.version),
    ]);
    return Response.json({ok:true,bytes:head.size,id:body.id,type:body.type});
  } catch(error) {
    console.error('Completed document deletion failed',error);
    if(acquired) {
      await env.DB.prepare("UPDATE document_removals SET status=?, expires_at=? WHERE object_key=? AND token=?").bind(deleted?'deleted':'failed',now,key,token).run().catch(e=>console.error('Removal ledger failed',e));
      await env.DB.prepare('INSERT INTO security_audit (id,workspace_id,created_at,user_email,action,entity,detail,state_version) VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),WORKSPACE_ID,now,access.user.email,'Falha na exclusão de arquivo','Documentos',JSON.stringify({arquivo:key,removido:deleted,erro:String(error)}),body.version).run().catch(e=>console.error('Removal audit failed',e));
    }
    return Response.json({error:deleted?'Arquivo removido, mas houve falha no registro final. Atualize a análise.':'Não foi possível excluir este arquivo. Atualize a análise e tente novamente.'},{status:503});
  }
}
