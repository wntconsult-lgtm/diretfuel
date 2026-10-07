export function createGateway(client,config,fetchImpl=fetch,baseHref=location.href) {
  const page=new URL(baseHref);
  return async (input,init) => {
    const target=new URL(input instanceof Request?input.url:String(input),page);
    if (target.origin!==page.origin || !target.pathname.startsWith('/api/')) return fetchImpl(input,init);
    const original=input instanceof Request?new Request(input,init):new Request(target,init);
    const {data,error}=await client.auth.getSession();
    if (error || !data.session?.access_token) return Response.json({error:'Entre novamente para acessar.'},{status:401});
    const headers=new Headers(original.headers);
    headers.set('authorization',`Bearer ${data.session.access_token}`);headers.set('apikey',config.publicKey);
    // No session credentials are appended to URLs or sent to asset/CDN requests.
    const url=`${config.url}/functions/v1/directfuel-api/${target.pathname.slice(5)}${target.search}`;
    return fetchImpl(new Request(url,original),{headers,cache:'no-store',credentials:'omit',redirect:'error'});
  };
}
