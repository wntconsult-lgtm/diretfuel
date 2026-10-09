import {handleTeam} from './team.mjs';
import {createGeoProvider} from './geo-provider.mjs';
import {cachedRoutes,handleGeoProvider} from './geo-routing.mjs';
import {accessOf,clientState,mergeClientPayload,requireOwner,requirePermission,authorizeExtraChanges} from './access.mjs';
import {handleRetention} from './retention.mjs';
import {handleCompleted,documentManifest} from './completed-documents.mjs';
import { readGeo, reviewGeo } from './geo.mjs';
import { handleVolume } from './volume.mjs';
import { readTicketlog, mutateTicketlog } from './ticketlog.mjs';
import { handleDocument, removeDocumentObject } from './documents.mjs';
import { APP_VERSION } from './core/directfuel-version.mjs';
import { applyStateDelta } from './core/directfuel-storage.mjs';
import { protectFiscalMappings } from './core/directfuel-fiscal-protection.mjs';
import { analyzeChanges as analyzeBusinessChanges, assignAutomaticAgreementNumbers, assignAutomaticStationCodes, authorizeChanges, validateBusinessRules, validateState } from './core/directfuel-security.mjs';
import { accountingReport } from './core/directfuel-accounting-report.mjs';

export function analyzeChanges(previous,next){
 const changes=analyzeBusinessChanges(previous,next);
 for(const collection of ['geoParams','geoStations','stationReviews','volumeParameters','volumeParameterHistory','volumeReviews','ticketlogStations','ticketlogFuelings','ticketlogBatches']){
  if(JSON.stringify(previous[collection])===JSON.stringify(next[collection]))continue;
  if(['geoParams','volumeParameters'].includes(collection)){changes.push({collection,inserted:previous[collection]?0:1,updated:previous[collection]?1:0,deleted:[]});continue;}
  const before=new Map((previous[collection]||[]).map(r=>[r.id||r.stationCode,r])),after=new Map((next[collection]||[]).map(r=>[r.id||r.stationCode,r]));
  changes.push({collection,inserted:[...after.keys()].filter(id=>!before.has(id)).length,updated:[...after].filter(([id,r])=>before.has(id)&&JSON.stringify(before.get(id))!==JSON.stringify(r)).length,deleted:[...before].filter(([id])=>!after.has(id)).map(([,r])=>r)});
 }
 return changes;
}

export const TRANSPORT_LIMIT = 32_000_000;
const list = value => Array.isArray(value) ? value : [];
const problem = (error, status = 400, extra = {}) => Object.assign(new Error(error), { status, extra });
const usage = state => {
  const bytes = new TextEncoder().encode(JSON.stringify(state || {})).byteLength, percent = bytes / TRANSPORT_LIMIT * 100;
  return { bytes, limitBytes: TRANSPORT_LIMIT, percent, level: percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'normal', scope: 'sync-envelope' };
};
export function canImport(previous) {
  const excluded = new Set(['users','audit','config']);
  return !Object.entries(previous).some(([key,value]) => !excluded.has(key) && (Array.isArray(value) ? value.length>0 : value && Object.keys(Object(value)).length>0));
}
export function prepareImport(previous, candidate, ownerEmail) {
  // Import is allowed only before the operational collections have been populated.
  if (!canImport(previous)) {
    throw problem('A cópia já possui dados. A importação inicial não pode substituir uma base preenchida.',409);
  }
  if (!candidate || Array.isArray(candidate) || typeof candidate!=='object' || !Array.isArray(candidate.abastecimentos) || !Array.isArray(candidate.medicoes)) throw problem('Selecione o backup geral JSON do DirectFuel.');
  const next = structuredClone(candidate);
  for (const key of Object.keys(next)) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor','prototype','__proto__'].includes(key)) throw problem('Nome de coleção inválido.');
  if (next.audit !== undefined) { next.importedAuditHistory = next.audit; delete next.audit; }
  next.users = list(next.users).map(u => String(u.email || '').toLowerCase()===ownerEmail ? {...u,perfil:'Master',permissoes:['*'],acoes:['*'],ativo:true} : {...u,...(u.perfil==='Master'?{perfil:'Admin'}:{})});
  // Historical identifiers and agreement numbers are preserved, without running automatic numbering.
  const invalid = validateState(next); if (invalid) throw problem(invalid);
  const business = validateBusinessRules(next,next); if (business) throw problem(business,409);
  if (usage(next).bytes>TRANSPORT_LIMIT) throw problem('O backup excedeu o limite de envio.',413);
  return next;
}
export function prepareState(previous, payload, access, preserveRestoredNumbers = false) {
  payload=mergeClientPayload(previous,payload,access);
  let next;
  if (payload.delta !== undefined) {
    const delta = { ...payload.delta }; delete delta.audit;
    next = applyStateDelta(structuredClone(previous), delta);
  } else {
    if (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) throw problem('Estado inválido.');
    next = structuredClone(payload.state);
  }
  delete next.audit;
  for (const key of Object.keys(next)) if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor','prototype','__proto__'].includes(key)) throw problem('Nome de coleção inválido.');
  next.users = list(next.users).map(user => access.isOwner && String(user.email || '').toLowerCase() === access.user.email
    ? { ...user, perfil: 'Master', permissoes: ['*'], acoes: ['*'], ativo: true } : user);
  if (access.isOwner && next.users.some(user => user.perfil === 'Master' && String(user.email || '').toLowerCase() !== access.user.email)) throw problem('O perfil Master é exclusivo do proprietário.', 403);
  const protectedError = protectFiscalMappings(previous, next);
  if (protectedError) throw problem(protectedError, 409);
  if(!preserveRestoredNumbers) next.stationReviews = previous.stationReviews || [];
  // These collections are written only by their dedicated server endpoints.
  if (!preserveRestoredNumbers) for (const key of ['importedAuditHistory','volumeParameters','volumeParameterHistory','volumeReviews','ticketlogStations','ticketlogFuelings','ticketlogBatches']) {
    if (previous[key] !== undefined) next[key] = previous[key]; else delete next[key];
  }
  assignAutomaticStationCodes(previous, next);
  const numberingPrevious = preserveRestoredNumbers ? {...previous,acordos:[...list(previous.acordos),...list(next.acordos).filter(row=>!list(previous.acordos).some(old=>old.id===row.id))]} : previous;
  assignAutomaticAgreementNumbers(numberingPrevious, next);
  const invalid = validateState(next); if (invalid) throw problem(invalid);
  const businessError = validateBusinessRules(previous, next); if (businessError) throw problem(businessError, 409);
  const changes = analyzeChanges(previous, next);
  authorizeExtraChanges(access,changes);
  const denied = authorizeChanges(access, previous, next, changes); if (denied) throw problem(denied, 403);
  if (usage(next).bytes > TRANSPORT_LIMIT) throw problem('O envio excedeu o limite de sincronização. Contate o administrador.', 413);
  return { next, changes };
}
async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > TRANSPORT_LIMIT) throw problem('Envio acima do limite de sincronização.', 413);
  const reader = request.body?.getReader(); if (!reader) throw problem('Solicitação vazia.');
  let size = 0, text = ''; const decoder = new TextDecoder();
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > TRANSPORT_LIMIT) { await reader.cancel(); throw problem('Envio acima do limite de sincronização.', 413); }
    text += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw problem('JSON inválido.'); }
}
export function createHandler({ url, serviceKey, geoApiKey = '', fetchImpl = fetch }) {
  const origins = new Set(['https://wntconsult-lgtm.github.io','http://localhost:4173']);
  return async request => {
    const headers = new Headers({ 'content-type':'application/json; charset=utf-8', 'cache-control':'private, no-store', 'x-content-type-options':'nosniff', vary:'Origin' });
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    const origin = request.headers.get('origin');
    if (origin && !origins.has(origin)) return reply({ error:'Origem não autorizada.' },403);
    if (origin) headers.set('access-control-allow-origin',origin);
    headers.set('access-control-allow-headers','authorization, apikey, content-type, x-client-info');
    headers.set('access-control-allow-methods','GET, PUT, POST, DELETE, OPTIONS');
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization)) return reply({error:'Entre para acessar.'},401);
    if (!url || !serviceKey) return reply({error:'Conexão indisponível.'},503);
    try {
      const auth = await fetchImpl(`${url}/auth/v1/user`,{headers:{apikey:serviceKey,authorization},signal:AbortSignal.timeout(10000)});
      if (!auth.ok) throw problem('Sessão indisponível. Entre novamente.',auth.status>=500?503:401);
      const user = await auth.json();
      if (!user.id || !user.email || !user.email_confirmed_at || user.is_anonymous || user.role!=='authenticated') throw problem('Confirme seu e-mail para acessar.',403);
      const identity = { p_user_id:user.id,p_email:user.email.toLowerCase() };
      async function rpc(name,args = {},timeoutMs=45000) {
        const result = await fetchImpl(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},body:JSON.stringify({...identity,...args}),signal:AbortSignal.timeout(timeoutMs)});
        const data = await result.json();
        if (!result.ok) {
          const status = /^PT[0-9]{3}$/.test(data.code || '') ? Number(data.code.slice(2)) : 503;
          throw problem(status===503?'Não foi possível concluir a operação. Tente novamente.':data.message,status,status===409?{conflict:true}:{});
        }
        return data;
      }
      const parsed = new URL(request.url), segments = parsed.pathname.split('/directfuel-api/');
      if (segments.length!==2) throw problem('Rota não encontrada.',404);
      const route = segments[1];
      const readState = () => rpc('directfuel_state_read');
      const audit = (action,entity,details) => rpc('directfuel_audit',{p_action:action,p_entity:entity,p_details:details});
      const write = (current,next,changes,destructive=false) => rpc('directfuel_state_write',{
        p_version:current.version,p_state:next,p_destructive:destructive || changes.some(c=>c.deleted.length>0),
        p_events:changes.map(c=>({collection:c.collection,inserted:c.inserted,updated:c.updated,deleted:c.deleted,
          summary:`${c.inserted} inclusão(ões), ${c.updated} alteração(ões), ${c.deleted.length} exclusão(ões)`})),
      });
      const document = (action,id=null,metadata=null,timeoutMs=45000) => rpc('directfuel_document',{p_action:action,p_document_id:id,p_metadata:metadata},timeoutMs);
      if(route==='team')return reply(await handleTeam({method:request.method,body:request.method==='POST'?await readJson(request):{},rpc,fetchImpl,url,serviceKey}));
      if(route==='geo-provider'&&request.method==='GET'){
        const context=await document('context');requireOwner(context.user);
        const provider=createGeoProvider({apiKey:geoApiKey,fetchImpl,cache:null});
        return reply({configured:provider.configured,...await rpc('directfuel_geo_cache',{p_action:'usage'},10000)});
      }
      if (route==='version' && request.method==='GET') { await document('context'); return reply({applicationVersion:APP_VERSION}); }
      if (route==='state' && request.method==='GET') {
        const known = parsed.searchParams.get('version');
        if (known!==null && !/^\d+$/.test(known)) throw problem('Versão inválida.');
        if (known===null) await audit('Acesso autorizado','application',{route:'/',userAgent:(request.headers.get('user-agent')||'').slice(0,500)});
        const result = await rpc('directfuel_state_read',{p_known_version:known===null?null:Number(known)});
        const visible=result.unchanged?undefined:clientState(result.state,accessOf(result.user));
        return reply({...result,...(result.unchanged?{}:{state:visible}),applicationVersion:APP_VERSION,...(result.unchanged?{}:{storage:usage(visible)})});
      }
      if(route==='documents/completed')return reply(await handleCompleted({method:request.method,parsed,body:request.method==='POST'?await readJson(request):{},readState,document,removeObject:path=>removeDocumentObject({fetchImpl,url,serviceKey,path})}));
      if(route==='documents/manifest'&&request.method==='GET'){
        const current=await readState(),docs=await document('list');return reply({version:current.version,files:documentManifest(current.state||{},docs),cleanupPending:docs.filter(d=>d.removed_at&&d.cleanup_pending).map(d=>({id:d.measurement_id,type:d.content_type.includes('xml')?'xml':'pdf'}))});
      }
      if (route.startsWith('documents/')) return await handleDocument({request,route,parsed,document,fetchImpl,url,serviceKey,headers,reply,readState});
      if (route==='import' && request.method==='GET') {
        const current = await readState();requireOwner(current.user);
        return reply({canImport:canImport(current.state || {}),version:current.version});
      }
      if (route==='import' && request.method==='POST') {
        const body = await readJson(request), current = await readState();requireOwner(current.user);
        if (!Number.isSafeInteger(body.version) || body.version!==current.version) throw problem('A base foi alterada. Atualize a situação antes de importar.',409,{conflict:true});
        const candidate = body.backup?.state || body.backup;
        const next = prepareImport(current.state || {},candidate,current.user.email);
        const changes = analyzeChanges(current.state || {},next);
        const result = await rpc('directfuel_initial_import',{p_version:current.version,p_state:next,p_events:changes.map(c=>({...c,summary:'Importação inicial validada'}))});
        // The transaction records the imported collections. Client audit history remains in a separate preserved collection.
        return reply({...result,collections:Object.entries(next).filter(([,v])=>Array.isArray(v)).map(([name,v])=>({name,records:v.length})),documentsIncluded:false});
      }
      if (route==='state' && request.method==='PUT') {
        const body = await readJson(request);
        if (!Number.isSafeInteger(body.version) || body.version<0) throw problem('Versão inválida.');
        if (String(body.applicationVersion)!==APP_VERSION) throw problem('Atualize o sistema antes de salvar.',409,{updateRequired:true,applicationVersion:APP_VERSION});
        const current = await readState();
        if (current.version!==body.version) throw problem('Os dados foram alterados por outro usuário. Recarregue antes de salvar.',409,{conflict:true});
        const access = { isOwner:current.user.isOwner,user:{email:current.user.email,displayName:current.user.name},directFuelUser:{perfil:current.user.profile,permissoes:current.user.permissions,acoes:current.user.actions} };
        const {next,changes} = prepareState(current.state || {},body,access);
        return reply({...await write(current,next,changes),storage:usage(next)});
      }
      if (route==='security' && request.method==='GET') {
        const id = parsed.searchParams.get('downloadBackup');
        const result = await rpc('directfuel_security',{p_action:id?'download':'list',p_id:id});
        if (id) headers.set('content-disposition','attachment; filename="directfuel-backup.json"');
        return reply(result);
      }
      if (route==='security' && request.method==='POST') {
        const body = await readJson(request);
        if (body.action==='create_backup') return reply(await rpc('directfuel_security',{p_action:'create_backup'}));
        if (!['restore_backup','restore_deleted'].includes(body.action)) throw problem('Ação inválida.');
        const current = await readState();requireOwner(current.user);const previous = current.state || {}; let proposed;
        if (body.action==='restore_backup') {
          const backup = await rpc('directfuel_security',{p_action:'download',p_id:body.id});
          proposed = {...backup.state,users:previous.users};
        } else {
          const [eventId,recordId] = String(body.id || '').split('::');
          const deleted = await rpc('directfuel_security',{p_action:'deleted_event',p_id:eventId});
          const record = list(deleted.deleted).find(row=>String(row.id)===recordId);
          if (!record || !/^[A-Za-z][A-Za-z0-9_]*$/.test(deleted.collection)) throw problem('Registro não encontrado.',404);
          if (list(previous[deleted.collection]).some(row=>row.id===record.id)) throw problem('Já existe um registro com esse identificador.',409);
          proposed = {...previous,[deleted.collection]:[...list(previous[deleted.collection]),record]};
        }
        const access = {isOwner:true,user:{email:current.user.email},directFuelUser:{perfil:'Master',permissoes:['*'],acoes:['*']}};
        const {next,changes} = prepareState(previous,{state:proposed},access,true);
        return reply(await write(current,next,changes,true));
      }
      if(route==='storage/retention'){
        const current=await readState();requireOwner(current.user);const documents=await document('list'),body=request.method==='POST'?await readJson(request):{};
        return reply(await handleRetention({method:request.method,body,current,documents,limitBytes:TRANSPORT_LIMIT,
          execute:plan=>rpc('directfuel_retention',{p_version:current.version,p_state:plan.state,p_events:analyzeChanges(current.state||{},plan.state).map(c=>({...c,summary:'Retenção fiscal com backup validado'})),p_documents:plan.documents.map(d=>({id:d.id,sha256:d.sha256}))}),
          cleanup:async doc=>{await removeDocumentObject({fetchImpl,url,serviceKey,path:doc.object_path,timeoutMs:10000});await document('cleanup_complete',doc.id,{path:doc.object_path},10000);}
        }));
      }
      if (route==='storage' && request.method==='GET') {
        const current = await readState(), security = await rpc('directfuel_security'), documents = await document('stats'), state = current.state || {};
        return reply({limitBytes:TRANSPORT_LIMIT,state:{bytes:usage(state).bytes,version:current.version},documents,
          backups:{count:security.backups.length,bytes:security.backups.reduce((s,b)=>s+Number(b.size_bytes),0)},
          collections:Object.entries(state).map(([name,value])=>({name,records:Array.isArray(value)?value.length:null,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength})),measuredAt:new Date().toISOString()});
      }
      if (['volume-audit','ticketlog','geo-analysis'].includes(route) && ['GET','POST'].includes(request.method)) {
        
        const body=request.method==='POST'?await readJson(request):{},current=await readState(),state=current.state||{};
        const permission=route==='ticketlog'?'ticketlog_import':route==='geo-analysis'?'analysis_geo':'audit';
        requirePermission(current.user,permission);
        if(request.method==='POST'){
          if(body.action==='reprocess-links')requirePermission(current.user,'analysis_geo','editar');
          else if(route==='ticketlog')requirePermission(current.user,permission,body.action?.startsWith('delete-')?'excluir':'incluir');
          else if(route==='volume-audit'&&body.action==='save')requireOwner(current.user);
          else if(route==='volume-audit'&&['calculate','simulate','summary','history'].includes(body.action)){}
          else requirePermission(current.user,permission,'editar');
        }
        
        const persist=async(next,destructive=false)=>{
          delete next.audit;
          const invalid=validateState(next);if(invalid)throw problem(invalid);
          if(usage(next).bytes>TRANSPORT_LIMIT)throw problem('Envio acima do limite de sincronização.',413);
          const changes=analyzeChanges(state,next);
          return await write(current,next,changes,destructive);
        };
        if(route==='geo-analysis'){
          const cache=(action,options={})=>rpc('directfuel_geo_cache',{p_action:action,p_key:options.key??null,p_kind:options.kind??null,p_payload:options.payload??null,p_token:options.token??null},10000);
          const provider=createGeoProvider({apiKey:geoApiKey,fetchImpl,cache});
          if(request.method==='GET'){
            const entries=provider.configured?await cache('list'):[],routes=await cachedRoutes(state,entries),access=accessOf(current.user);
            return reply({...readGeo(state,parsed,routes),canManage:access.isOwner||access.directFuelUser.acoes.includes('*')||access.directFuelUser.acoes.includes('analysis_geo:editar'),capabilities:{routing:provider.configured,geocoding:provider.configured,sameRoad:false,provider:'Geoapify/OpenStreetMap',manualOnly:true},providerUsage:provider.configured?await cache('usage'):null});
          }
          if(['geocode','route-batch','geocode-ticketlog-station','geocode-ticketlog-batch'].includes(body.action))return reply(await handleGeoProvider({state,body,provider,entries:body.action==='route-batch'&&provider.configured?await cache('list'):[],cache,persist,email:current.user.email}));
          if(body.action!=='reprocess-links')return reply(await reviewGeo({state,body,email:current.user.email,persist}));
        }
        if(route==='volume-audit'){const result=await handleVolume({state,body,method:request.method,email:current.user.email,persist});if(request.method==='GET'){result.canConfigure=!!current.user.isOwner;result.canReview=current.user.isOwner||current.user.actions?.includes('*')||current.user.actions?.includes('audit:editar');}return reply(result);}
        if(request.method==='GET')return reply(readTicketlog(state,parsed.searchParams));
        return reply(await mutateTicketlog({state,body,email:current.user.email,persist}));
      }
      if (route==='accounting-report' && request.method==='POST') {
        const body = await readJson(request), current = await readState();
        if (!Array.isArray(body.measurementIds) || body.measurementIds.some(id=>typeof id!=='string')) throw problem('Seleção inválida.');
        if (body.version!==undefined && body.version!==current.version) throw problem('Os dados foram atualizados. Abra o relatório novamente.',409);
        requirePermission(current.user,'medicoes','exportar');
        const result = accountingReport(current.state || {},body.measurementIds);
        await audit('Relatório de abastecimentos da contabilização','medicoes',{mode:body.mode,measurementIds:body.measurementIds,revision:current.version});
        return reply({...result,version:current.version});
      }
      throw problem('Esta função ainda está em adaptação para a cópia de testes.',501);
    } catch (error) {
      return reply({error:error.status?error.message:'Não foi possível concluir a operação. Tente novamente.',...(error.extra || {})},error.status || 503);
    }
  };
}
