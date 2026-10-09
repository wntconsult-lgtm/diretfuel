import {hasPermission,hasAction} from './core/directfuel-security.mjs';
const fail=message=>Object.assign(new Error(message),{status:403});
export const accessOf=user=>({isOwner:!!user?.isOwner,user:{email:user?.email},directFuelUser:{perfil:user?.profile,permissoes:user?.permissions||[],acoes:user?.actions||[]}});
const dimensions=['distribuidores','bases','produtos','unidades','postos','frota','rede'];
const operations=['acordos','abastecimentos','medicoes','nfPendencias','docs','accountingAdjustments','sapReturns','fiscalLayouts'];
const groups={distribuidoras:['distribuidores'],bases:['bases'],produtos:['produtos'],unidades:['unidades'],postos:['postos','fiscalLayouts'],frota:['frota'],rede:['rede'],acordos:['acordos'],abastecimentos:['abastecimentos'],medicoes:operations,documentos:['docs','medicoes','nfPendencias','sapReturns','fiscalLayouts'],dashboard:operations,relatorios:operations,analysis_geo:['geoParams','geoStations','stationReviews','acordos','abastecimentos','ticketlogStations','ticketlogFuelings'],ticketlog_import:['ticketlogStations','ticketlogFuelings','ticketlogBatches'],audit:['abastecimentos','medicoes','ticketlogStations','ticketlogFuelings','volumeParameters','volumeParameterHistory','volumeReviews','alertReviews']};
export function visibleKeys(access){
 if(access.isOwner)return null;
 const keys=new Set(['config','users','audit']);
 for(const [permission,collections] of Object.entries(groups))if(hasPermission(access,permission)){
  for(const key of [...dimensions,...collections])keys.add(key);
 }
 return keys;
}
export function clientState(state,access){
 if(!state||access.isOwner)return state;
 const keys=visibleKeys(access),result={};
 for(const [key,value] of Object.entries(state))result[key]=key==='users'?(value||[]).filter(r=>String(r.email||'').toLowerCase()===access.user.email):key==='audit'?[]:keys.has(key)?value:Array.isArray(value)?[]:value&&typeof value==='object'?{}:null;
 return result;
}
export function mergeClientPayload(previous,payload,access){
 if(access.isOwner)return payload;
 const keys=visibleKeys(access),visible=clientState(previous,access);
 if(payload.delta!==undefined){
  for(const key of Object.keys(payload.delta))if(!keys.has(key)||key==='users'||key==='audit')throw fail('Seu acesso não permite alterar esta coleção.');
  return payload;
 }
 const candidate=payload.state;if(!candidate||Array.isArray(candidate)||typeof candidate!=='object')return payload;
 for(const [key,value] of Object.entries(candidate)){
  if(!Object.hasOwn(previous,key))throw fail('Seu acesso não permite criar coleções.');
  if((!keys.has(key)||key==='users'||key==='audit')&&JSON.stringify(value)!==JSON.stringify(visible[key]))throw fail('Seu acesso não permite alterar esta coleção.');
 }
 return {...payload,state:{...previous,...Object.fromEntries(Object.entries(candidate).filter(([key])=>keys.has(key)&&!['users','audit'].includes(key)))}};
}
export function requirePermission(user,permission,action){
 const access=accessOf(user);
 if(!(action?hasAction(access,permission,action):hasPermission(access,permission)))throw fail('Seu acesso não permite esta operação.');
}
export function requireOwner(user){if(!user?.isOwner)throw fail('Somente o proprietário pode realizar esta operação.');}
export function authorizeExtraChanges(access,changes){
 const map={geoParams:'analysis_geo',geoStations:'analysis_geo',stationReviews:'analysis_geo',volumeParameters:'audit',volumeParameterHistory:'audit',volumeReviews:'audit',ticketlogStations:'ticketlog_import',ticketlogFuelings:'ticketlog_import',ticketlogBatches:'ticketlog_import'};
 for(const change of changes){const permission=map[change.collection];if(!permission)continue;for(const [action,count] of [['incluir',change.inserted],['editar',change.updated],['excluir',change.deleted.length]])if(count&&!hasAction(access,permission,action))throw fail('Seu acesso não permite alterar esta coleção.');}
}
