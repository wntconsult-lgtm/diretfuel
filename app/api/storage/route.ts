import { env } from 'cloudflare:workers';
import { requireVixparUser, WORKSPACE_ID } from '@/lib/directfuel-access';
import { STATE_LIMIT_BYTES } from '@/lib/directfuel-storage';
import { decodeStoredState, storedStateBytes } from '@/lib/directfuel-state-codec';
export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await requireVixparUser();
  if ('error' in access) return Response.json({error:access.error},{status:access.status});
  if (!access.isOwner) return Response.json({error:'Somente o proprietário pode consultar o consumo.'},{status:403});
  try {
    const [stateRow, backups] = await Promise.all([
      env.DB.prepare('SELECT data, version, updated_at FROM app_state WHERE workspace_id = ?').bind(WORKSPACE_ID).first<{data:string;version:number;updated_at:string}>(),
      env.DB.prepare('SELECT count(*) AS count, COALESCE(sum(size_bytes),0) AS bytes FROM state_backups WHERE workspace_id = ?').bind(WORKSPACE_ID).first(),
    ]);
    const decoded = stateRow?.data ? await decodeStoredState<Record<string, unknown>>(stateRow.data) : {};
    const serialized = JSON.stringify(decoded);
    const collections = Object.entries(decoded).map(([name,value])=>({name,bytes:new TextEncoder().encode(JSON.stringify(value)).byteLength,records:Array.isArray(value)?value.length:null})).sort((a,b)=>b.bytes-a.bytes);
    const state = stateRow ? {bytes:new TextEncoder().encode(serialized).byteLength,storedBytes:storedStateBytes(stateRow.data),version:stateRow.version,updated_at:stateRow.updated_at} : null;
    let cursor: string | undefined, documentCount = 0, documentBytes = 0;
    do {
      const page = await env.BUCKET.list({prefix:`${WORKSPACE_ID}/danfes/`,cursor});
      documentCount += page.objects.length;
      documentBytes += page.objects.reduce((sum,item)=>sum+item.size,0);
      cursor = page.truncated ? page.cursor : undefined;
    } while(cursor);
    return Response.json({state,limitBytes:STATE_LIMIT_BYTES,collections,backups,documents:{count:documentCount,bytes:documentBytes},measuredAt:new Date().toISOString(),cloudQuotaBytes:null},{headers:{'cache-control':'private, no-store'}});
  } catch(error) { console.error('Storage metrics unavailable',error);return Response.json({error:'Não foi possível medir o consumo agora.'},{status:503}); }
}
