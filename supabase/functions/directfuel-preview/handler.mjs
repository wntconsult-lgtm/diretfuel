// No external packages. Authentication is checked online with Supabase Auth.
export function createHandler({ url, serviceKey, fetchImpl = fetch }) {
  const allowedOrigins = new Set(['https://wntconsult-lgtm.github.io', 'http://localhost:4173']);
  return async function handler(request) {
    const origin = request.headers.get('origin');
    const headers = new Headers({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'vary': 'Origin',
    });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.has(origin)) return reply({ error: 'Origem não autorizada.' }, 403);
    if (origin) headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-headers', 'authorization, apikey, content-type, x-client-info');
    headers.set('access-control-allow-methods', 'GET, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return reply({ error: 'A cópia está em validação; gravações ainda não estão disponíveis.' }, 405);
    const pathname = new URL(request.url).pathname.replace(/\/$/, '');
    if (!pathname.endsWith('/directfuel-preview/status')) return reply({ error: 'Rota não encontrada.' }, 404);
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization)) return reply({ error: 'Entre para acessar.' }, 401);
    if (!url || !serviceKey) return reply({ error: 'Conexão temporariamente indisponível.' }, 503);
    try {
      // Never accept browser-supplied email/profile or editable user_metadata.
      const auth = await fetchImpl(`${url}/auth/v1/user`, {
        headers: { apikey: serviceKey, authorization }, signal: AbortSignal.timeout(10000),
      });
      if (!auth.ok) return reply({ error: auth.status >= 500 ? 'Autenticação temporariamente indisponível.' : 'Sua sessão expirou. Entre novamente.' }, auth.status >= 500 ? 503 : 401);
      const user = await auth.json();
      if (!user.id || !user.email || !user.email_confirmed_at || user.is_anonymous || user.role !== 'authenticated') {
        return reply({ error: 'É necessária uma conta com e-mail confirmado.' }, 403);
      }
      const database = await fetchImpl(`${url}/rest/v1/rpc/directfuel_preview_access`, {
        method: 'POST',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_user_id: user.id, p_email: user.email.toLowerCase() }),
        signal: AbortSignal.timeout(10000),
      });
      if (!database.ok) {
        const failure = await database.json();
        if (failure.code === 'PT403') return reply({ error: 'Sua conta ainda não foi liberada para a cópia de testes.' }, 403);
        return reply({ error: 'Não foi possível consultar o banco. Tente novamente.' }, 503);
      }
      const status = await database.json();
      if (!status) return reply({ error: 'Sua conta ainda não foi liberada para a cópia de testes.' }, 403);
      return reply({ ...status, region: 'sa-east-1', applicationVersion: '231', checkedAt: new Date().toISOString() });
    } catch {
      // Do not log tokens, keys, credentials, database payloads or internal errors.
      return reply({ error: 'Conexão temporariamente indisponível. Tente novamente.' }, 503);
    }
  };
}
