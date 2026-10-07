export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const fail = (message,status=400) => Object.assign(new Error(message),{status});
export async function handleDocument({request,route,parsed,document,fetchImpl,url,serviceKey,headers,reply}) {
  const id = route.slice('documents/'.length);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw fail('Documento inválido.');
  const inputType = request.headers.get('content-type') || '';
  const type = parsed.searchParams.get('type')==='xml' || inputType.includes('xml') ? 'xml' : 'pdf';
  const documentId = `${id}:${type}`;
  // Authorize before any storage operation, including upload or bucket provisioning.
  await document('context');
  const storageHeaders = {apikey:serviceKey,authorization:`Bearer ${serviceKey}`};
  const storage = (path,options={}) => fetchImpl(`${url}/storage/v1/${path}`,{...options,headers:{...storageHeaders,...options.headers},signal:AbortSignal.timeout(45000)});
  const objectUrl = path => `object/directfuel-documents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const removeObject = async path => {
    const result = await storage('object/directfuel-documents',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});
    if (!result.ok && result.status!==404) throw fail('O arquivo ficou pendente de limpeza no armazenamento.',503);
  };
  if (request.method==='GET') {
    const meta = await document('get',documentId);
    if (meta.bucket_id!=='directfuel-documents') throw fail('Documento indisponível.',503);
    const result = await storage(objectUrl(meta.object_path).replace('object/','object/authenticated/'));
    if (!result.ok) throw fail('Não foi possível obter o documento.',result.status===404?404:503);
    headers.set('content-type',meta.content_type);
    headers.set('content-disposition',`${type==='pdf'?'inline':'attachment'}; filename="nota-fiscal-${id}.${type}"`);
    return new Response(result.body,{status:200,headers});
  }
  if (request.method==='DELETE') {
    if (id.startsWith('NF_LAYOUT_')) throw fail('Os PDFs de referência dos layouts são preservados.',409);
    const meta = await document('remove',documentId);
    await removeObject(meta.object_path);
    return reply({ok:true});
  }
  if (request.method!=='POST') throw fail('Método não permitido.',405);
  const mime = type==='pdf'?'application/pdf':'application/xml';
  if (type==='pdf' && inputType!=='application/pdf' || type==='xml' && !['application/xml','text/xml','application/octet-stream'].some(t=>inputType.includes(t))) throw fail('Envie um PDF ou XML de NF-e.',415);
  if (Number(request.headers.get('content-length') || 0)>MAX_DOCUMENT_BYTES) throw fail('O documento deve ter no máximo 20 MB.',413);
  const reader = request.body?.getReader(); if (!reader) throw fail('Arquivo vazio.');
  const chunks=[]; let size=0;
  for (;;) { const {value,done}=await reader.read(); if (done) break; size+=value.length;
    if (size>MAX_DOCUMENT_BYTES) { await reader.cancel(); throw fail('O documento deve ter no máximo 20 MB.',413); } chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  const beginning=new TextDecoder().decode(bytes.slice(0,1000));
  if (type==='pdf' && !beginning.startsWith('%PDF-') || type==='xml' && !/<(?:\w+:)?(?:nfeProc|NFe|infNFe)\b/i.test(beginning)) throw fail('O conteúdo enviado não corresponde ao documento.',415);
  let bucket = await storage('bucket/directfuel-documents');
  if (bucket.status===404) {
    const created = await storage('bucket',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'directfuel-documents',name:'directfuel-documents',public:false,file_size_limit:MAX_DOCUMENT_BYTES,allowed_mime_types:['application/pdf','application/xml']})});
    if (!created.ok && created.status!==409) throw fail('Não foi possível preparar o armazenamento privado.',503);
    bucket=await storage('bucket/directfuel-documents');
  }
  if (!bucket.ok || (await bucket.json()).public!==false) throw fail('O armazenamento privado não está disponível.',503);
  const path=`danfes/${crypto.randomUUID()}.${type}`;
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const uploaded=await storage(objectUrl(path),{method:'POST',headers:{'content-type':mime,'x-upsert':'false'},body:bytes});
  if (!uploaded.ok) throw fail('Não foi possível enviar o documento.',503);
  let saved;
  try { saved=await document('put',documentId,{path,filename:`nota-fiscal-${id}.${type}`,type:mime,bytes:size,sha256}); }
  catch (error) { try {await removeObject(path);} catch {} throw error; }
  // Each revision uses an immutable path, so cleanup cannot delete a concurrently uploaded replacement.
  let cleanupPending=false;
  if (saved.oldPath && saved.oldPath!==path) { try {await removeObject(saved.oldPath);} catch {cleanupPending=true;} }
  return reply({ok:true,type,cleanupPending});
}
