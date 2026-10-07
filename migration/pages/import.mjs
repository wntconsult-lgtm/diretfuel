export const MAX_BACKUP_BYTES = 31_900_000;
export function inspectBackup(text) {
  let backup; try { backup=JSON.parse(text); } catch {throw new Error('O arquivo não contém um JSON válido.');}
  const state=backup?.state || backup;
  if (!state || typeof state!=='object' || Array.isArray(state) || !Array.isArray(state.abastecimentos) || !Array.isArray(state.medicoes)) throw new Error('Selecione o backup geral JSON exportado pelo DirectFuel.');
  const collections=Object.entries(state).filter(([name,value])=>Array.isArray(value) && !['audit','users'].includes(name)).map(([name,value])=>({name,count:value.length}));
  return {backup,collections,total:collections.reduce((sum,c)=>sum+c.count,0)};
}
export function createMigration(client,url,publicKey,fetchImpl=fetch) {
  return async (method,body) => {
    const {data,error}=await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('Entre novamente para importar.');
    const response=await fetchImpl(`${url}/functions/v1/directfuel-api/import`,{
      method,headers:{apikey:publicKey,authorization:`Bearer ${data.session.access_token}`,...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(120000),
    });
    const result=await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Não foi possível concluir a importação.'),{status:response.status});
    return result;
  };
}
