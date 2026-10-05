import {env} from 'cloudflare:workers';
import {requireVixparUser,WORKSPACE_ID} from '@/lib/directfuel-access';
import {hasPermission,hasAction} from '@/lib/directfuel-security';
import {accountingReport} from '@/lib/directfuel-accounting-report';
import {decodeStoredState} from '@/lib/directfuel-state-codec';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const access=await requireVixparUser();if('error' in access)return Response.json({error:access.error},{status:access.status});
 if(!hasPermission(access,'medicoes'))return Response.json({error:'Sem acesso às medições.'},{status:403});
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origem inválida.'},{status:403});
 try{const body=await request.json() as {mode?:string;measurementIds?:unknown;version?:number};if(body.mode==='export'&&!hasAction(access,'medicoes','exportar'))return Response.json({error:'Seu acesso não permite exportar medições.'},{status:403});
 if(!Array.isArray(body.measurementIds)||body.measurementIds.some((v:unknown)=>typeof v!=='string'))throw Error('Seleção inválida.');
 const current=await env.DB.prepare('SELECT data, version FROM app_state WHERE workspace_id = ?').bind(WORKSPACE_ID).first<{data:string;version:number}>();if(!current)throw Error('Base indisponível.');
 const result=accountingReport(await decodeStoredState(current.data),body.measurementIds as string[]);
 if(body.version!==undefined&&body.version!==current.version)return Response.json({error:'Os dados foram atualizados. Abra o relatório novamente antes de exportar.'},{status:409});
 await env.DB.prepare('INSERT INTO security_audit (id, workspace_id, created_at, user_email, action, entity, detail, state_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(),WORKSPACE_ID,new Date().toISOString(),access.user.email,'Relatório de abastecimentos da contabilização','medicoes',JSON.stringify({mode:body.mode==='export'?'Exportação Excel':'Consulta',measurementIds:result.measurementIds,medicoes:result.subtotals.map(r=>r.medicao),purchaseOrders:result.purchaseOrders,...result.summary}),current.version).run();
 return Response.json({...result,version:current.version},{headers:{'cache-control':'private, no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Falha ao consultar relatório.'},{status:400});}
}
