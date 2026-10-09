import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHandler } from '../supabase/functions/directfuel-preview/handler.mjs';
import { createAccess } from '../migration/pages/auth.mjs';

const origin = 'https://wntconsult-lgtm.github.io';
const url = 'https://example.supabase.co';
const endpoint = `${url}/functions/v1/directfuel-preview/status`;
const user = { id: 'e157501a-af43-4c7f-93a2-f8f4d2a208db', email: 'owner@example.test', email_confirmed_at: '2026-10-07T00:00:00Z', role: 'authenticated' };
const summary = { user: { email: user.email, profile: 'Master' }, collections: [], revision: 0, documents: 0, backups: 0, mode: 'migration-preview' };
const request = (options = {}) => new Request(endpoint, { headers: { origin, authorization: 'Bearer user-session' }, ...options });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
function setup(authUser = user, result = summary, authStatus = 200, rpcStatus = 200) {
  const calls = [];
  const handler = createHandler({ url, serviceKey: 'server-secret-test', fetchImpl: async (target, options) => {
    calls.push({ target, options });
    return target.endsWith('/user') ? json(authUser, authStatus) : json(result, rpcStatus);
  } });
  return { handler, calls };
}
test('the server verifies the real user and queries only the protected RPC', async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200); assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.authorization, 'Bearer user-session');
  assert.equal(calls[1].options.headers.authorization, 'Bearer server-secret-test');
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_user_id: user.id, p_email: user.email });
  const payload = await response.json();
  assert.equal(payload.revision, 0); assert.equal(payload.region, 'sa-east-1');
  assert.equal(JSON.stringify(payload).includes('server-secret-test'), false);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});
test('anonymous requests, untrusted origins, and writes never reach the database', async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(request({ headers: { origin } }))).status, 401);
  assert.equal((await handler(request({ headers: { origin: 'https://untrusted.example', authorization: 'Bearer token' } }))).status, 403);
  assert.equal((await handler(request({ method: 'PUT', body: '{}' }))).status, 405);
  assert.equal(calls.length, 0);
});
test('CORS preflight supports the browser without granting API access', async () => {
  const { handler, calls } = setup();
  const response = await handler(request({ method: 'OPTIONS', headers: { origin } }));
  assert.equal(response.status, 204); assert.equal(calls.length, 0);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});
test('unconfirmed, anonymous, revoked and inactive users cannot view status', async () => {
  for (const changed of [{ ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, role: 'anon', user_metadata: { profile: 'Master' } }]) {
    const { handler, calls } = setup(changed); assert.equal((await handler(request())).status, 403); assert.equal(calls.length, 1);
  }
  const revoked = setup({}, summary, 401); assert.equal((await revoked.handler(request())).status, 401); assert.equal(revoked.calls.length, 1);
  const inactive = setup(user, null); assert.equal((await inactive.handler(request())).status, 403);
});
test('upstream errors do not expose server responses or keys', async () => {
  const failure = setup(user, { secret: 'do-not-return' }, 200, 500);
  const response = await failure.handler(request());
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /do-not-return|server-secret/);
  const unavailable = setup(user, summary, 503); assert.equal((await unavailable.handler(request())).status, 503);
});
test('the client sends a user token plus public apikey and never authorizes from getSession claims', async () => {
  let sent;
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'user-jwt', user_metadata: { profile: 'Master' } } } }) } };
  const access = createAccess(client, url, 'sb_publishable_test', async (target, options) => { sent = { target, options }; return json(summary); });
  await access.status();
  assert.equal(sent.options.headers.authorization, 'Bearer user-jwt');
  assert.equal(sent.options.headers.apikey, 'sb_publishable_test');
  assert.equal(sent.target, endpoint);
});
test('a logged-in but unauthorized account is signed out; failed passwords never query status', async () => {
  let revoked = 0, calls = 0;
  const client = { auth: {
    signInWithPassword: async () => ({ error: null }),
    getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    signOut: async ({ scope }) => { assert.equal(scope, 'local'); revoked++; },
  } };
  const access = createAccess(client, url, 'public', async () => { calls++; return json({ error: 'Não autorizado.' }, 403); });
  await assert.rejects(access.login('user@example.test', 'not-real-password'), /Não autorizado/);
  assert.equal(revoked, 1); assert.equal(calls, 1);
  client.auth.signInWithPassword = async () => ({ error: { message: 'Invalid credentials' } });
  await assert.rejects(access.login('user@example.test', 'not-real-password'), /Confira/);
  assert.equal(calls, 1);
});
test('missing sessions never trigger a network request', async () => {
  const access = createAccess({ auth: { getSession: async () => ({ data: { session: null } }) } }, url, 'public', () => { throw Error('must not call'); });
  await assert.rejects(access.status(), error => error.status === 401);
});
test('the deploy artifact contains only the access page, never source, credentials or business data', async () => {
  const root = new URL('../dist/pages-preview/', import.meta.url);
  const files = await readdir(root);
  assert.deepEqual(files.sort(), ['activate.html','activate.mjs','activation.mjs','app','auth.mjs','config.mjs','favicon.svg','gateway.mjs','import.mjs','index.html','logo-vixpar.png','preview.css','preview.js','recover.html','recover.mjs','recovery.mjs']);
  const config = await readFile(new URL('config.mjs', root), 'utf8');
  assert.match(config, /sb_publishable_/); assert.doesNotMatch(config, /sb_secret_|eyJ|service_role/);
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /lang="pt-BR"/); assert.match(html, /@2\.117\.2/);
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)) {
    assert.ok(files.includes(match[1].slice(2).replace(/\/$/,'')), `Missing ${match[1]}`);
  }
  const js = await readFile(new URL('preview.js', root), 'utf8');
  assert.doesNotMatch(js, /innerHTML|localStorage|\.signUp\(/);
});

// Recovery must verify the email link, never reuse an existing logged-in session.
const {requestRecovery,readRecovery,createRecovery,RECOVERY_URL}=await import('../migration/pages/recovery.mjs');
test('recovery requests use the fixed destination and do not disclose account existence',async()=>{
 let sent;const client={auth:{resetPasswordForEmail:async(...args)=>{sent=args;return {error:null};}}};
 assert.match(await requestRecovery(client,' owner@example.test '),/Se o e-mail/);
 assert.deepEqual(sent,['owner@example.test',{redirectTo:RECOVERY_URL}]);
 await assert.rejects(requestRecovery(client,'invalid'),/válido/);
 client.auth.resetPasswordForEmail=async()=>({error:{status:429,message:'internal'}});
 await assert.rejects(requestRecovery(client,'owner@example.test'),/Aguarde/);
 client.auth.resetPasswordForEmail=async()=>({error:{status:500,message:'secret'}});
 await assert.rejects(requestRecovery(client,'owner@example.test'),e=>!e.message.includes('secret'));
});
test('recovery rejects missing, expired and non-recovery links',()=>{
 for(const hash of ['', '#type=invite&access_token=a&refresh_token=b','#type=recovery&access_token=a','#error_code=otp_expired'])assert.throws(()=>readRecovery(hash));
 assert.deepEqual(readRecovery('#type=recovery&access_token=a&refresh_token=b'),{access_token:'a',refresh_token:'b'});
});
test('recovery validates passwords and verifies link before password mutation',async()=>{
 const calls=[];const client={auth:{setSession:async()=>{calls.push('verify');return {data:{session:{}},error:null};},updateUser:async()=>{calls.push('update');return {error:null};},signOut:async()=>{calls.push('logout');}}};
 const recover=createRecovery(client,{access_token:'a',refresh_token:'b'});
 await assert.rejects(recover('short','short'),/12/);assert.deepEqual(calls,[]);
 await assert.rejects(recover('valid-password-123','different'),/iguais/);assert.deepEqual(calls,[]);
 await recover('valid-password-123','valid-password-123');assert.deepEqual(calls,['verify','update','logout']);
 await assert.rejects(recover('valid-password-123','valid-password-123'),/já foi alterada/);
 client.auth.setSession=async()=>({error:{message:'expired'},data:{session:null}});
 await assert.rejects(createRecovery(client,{})('valid-password-123','valid-password-123'),/expirou/);assert.equal(calls.filter(x=>x==='update').length,1);
});
