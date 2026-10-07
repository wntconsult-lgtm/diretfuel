export function createAccess(client, apiUrl, publicKey, fetchImpl = fetch) {
  async function status() {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw Object.assign(new Error('Entre para acessar.'), { status: 401 });
    const response = await fetchImpl(`${apiUrl}/functions/v1/directfuel-preview/status`, {
      headers: { apikey: publicKey, authorization: `Bearer ${data.session.access_token}` },
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Falha de conexão.'), { status: response.status });
    return payload;
  }
  async function login(email, password) {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error('Não foi possível entrar. Confira o e-mail, a senha e a confirmação da conta.');
    try { return await status(); }
    catch (error) { await client.auth.signOut({ scope: 'local' }); throw error; }
  }
  async function logout() {
    // Remove the tab's session even if a temporary outage prevents revocation.
    try { await client.auth.signOut({ scope: 'local' }); } finally { await client.auth.stopAutoRefresh(); }
  }
  return { login, status, logout };
}
