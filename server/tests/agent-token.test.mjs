import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { setup } from './fixtures.mjs';

const signedUrl = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_test&conversation_signature=mock-signature';
// Shaped like a real key (sk_ plus alphanumerics) so the configuration guard admits it. Not a credential.
const mockKey = 'sk_mocknotarealkey00000000000000000000';
const config = { ENABLE_VOICE_AGENT: 'true', ELEVENLABS_AGENT_ID: 'agent_test', ELEVENLABS_API_KEY: mockKey };
const request = (token, options = {}) => new Request('https://demo.example/v0.1/agent-token', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}', ...options,
});

test('authenticated voice route uses server configuration and works with page understanding disabled', async () => {
  const s = await setup(); let calls = 0;
  const agent = new m.ElevenLabsAgentSession(async (url, options) => {
    calls++; const upstream = new URL(url);
    assert.equal(upstream.origin, 'https://api.elevenlabs.io');
    assert.equal(upstream.pathname, '/v1/convai/conversation/get-signed-url');
    assert.equal(upstream.searchParams.get('agent_id'), 'agent_test');
    assert.equal(upstream.searchParams.get('include_conversation_id'), 'true');
    assert.equal(options.headers['xi-api-key'], mockKey);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ signed_url: signedUrl, conversation_id: 'mock-conversation' });
  });
  const worker = m.createWorker(undefined, s.gate, agent);
  const response = await worker.fetch(request(s.session.sessionToken), { ...s.env, ...config, ENABLE_PAGE_UNDERSTANDING: 'false' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { signedUrl }); assert.equal(calls, 1);
});

test('route rejects disabled, missing/expired auth, wrong origin, invalid body and method before minting', async () => {
  for (const [envOverrides, options, status] of [
    [{ ENABLE_VOICE_AGENT: 'false' }, {}, 503],
    [{}, { headers: { 'Content-Type': 'application/json' } }, 401],
    [{ DEMO_SESSIONS: '{}' }, {}, 401],
    [{}, { headers: { Origin: 'https://untrusted.example' } }, 403],
    [{}, { body: '{"agentId":"agent_other"}' }, 400],
    [{}, { body: 'x'.repeat(1025) }, 413],
    [{}, { headers: { 'Content-Type': 'text/plain', Authorization: 'VALID_TOKEN' } }, 415],
    [{}, { method: 'GET', body: undefined }, 405],
  ]) {
    const s = await setup();
    if (options.headers?.Authorization === 'VALID_TOKEN') options.headers.Authorization = `Bearer ${s.session.sessionToken}`;
    const worker = m.createWorker(undefined, s.gate, { createSession: async () => assert.fail('No mint allowed') });
    const response = await worker.fetch(request(s.session.sessionToken, options), { ...s.env, ...config, ...envOverrides });
    assert.equal(response.status, status);
  }
  const s = await setup(); s.advance(900_001);
  const worker = m.createWorker(undefined, s.gate, { createSession: async () => assert.fail('Expired session') });
  assert.equal((await worker.fetch(request(s.session.sessionToken), { ...s.env, ...config })).status, 401);
});

test('preflight allows only configured origin; voice minting shares the existing rate budget', async () => {
  const s = await setup(); let calls = 0;
  const worker = m.createWorker(undefined, s.gate, { createSession: async () => { calls++; return { signedUrl }; } });
  const env = { ...s.env, ...config };
  const preflight = await worker.fetch(request('', { method: 'OPTIONS', body: undefined, headers: { Origin: env.EXTENSION_ORIGIN } }), env);
  assert.equal(preflight.status, 200); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), env.EXTENSION_ORIGIN);
  for (const status of [200, 200, 429]) assert.equal((await worker.fetch(request(s.session.sessionToken), env)).status, status);
  assert.equal(calls, 2);
});

test('cancellation retains the concurrency lease and releases the route promptly', async () => {
  const s = await setup(), controller = new AbortController(); let entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const agent = new m.ElevenLabsAgentSession(async () => { entered(); return new Promise(() => {}); });
  const worker = m.createWorker(undefined, s.gate, agent), env = { ...s.env, ...config };
  const pending = worker.fetch(request(s.session.sessionToken, { signal: controller.signal }), env);
  await arrived; controller.abort();
  assert.equal((await pending).status, 504);
  assert.equal((await worker.fetch(request(s.session.sessionToken), env)).status, 409);
});

test('unconfigured provider never calls upstream', async () => {
  const provider = new m.ElevenLabsAgentSession(async () => assert.fail('No upstream call'));
  for (const env of [{}, { ...config, ELEVENLABS_AGENT_ID: 'https://untrusted.example' },
    // A dashboard URL suffix on the agent ID.
    { ...config, ELEVENLABS_AGENT_ID: 'agent_test?branchId=agtbrch_test' },
    { ...config, ELEVENLABS_API_KEY: 'replace_with_your_key' },
    { ...config, ELEVENLABS_API_KEY: 'sk_replace_with_your_key' },
    // An API key ID pasted in place of an sk_ API key, which upstream rejects with HTTP 400.
    { ...config, ELEVENLABS_API_KEY: 'a'.repeat(64) },
  ]) {
    await assert.rejects(provider.createSession(env, new AbortController().signal), error => error.status === 503);
  }
});

test('upstream errors and invalid credentials are sanitized, bounded and never retried', async () => {
  for (const [send, status] of [
    [async () => new Response('mock-secret', { status: 401 }), 502],
    [async () => new Response('mock-secret', { status: 429 }), 503],
    [async () => new Response('mock-secret', { status: 500 }), 503],
    [async () => { throw new Error('mock-secret'); }, 502],
    [async () => new Response('not json'), 502],
    [async () => new Response('x'.repeat(8193)), 502],
    ...[null, {}, { signed_url: 'https://untrusted.example' },
      { signed_url: signedUrl.replace('api.elevenlabs.io', 'untrusted.example') },
      { signed_url: signedUrl.replace('agent_test', 'agent_other') },
      { signed_url: signedUrl.replace('conversation_signature', 'other') },
    ].map(data => [async () => Response.json(data), 502]),
  ]) {
    let calls = 0;
    const provider = new m.ElevenLabsAgentSession(async (...args) => { calls++; return send(...args); });
    await assert.rejects(provider.createSession(config, new AbortController().signal), error => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /mock-secret|mock-signature|mocknotarealkey/); return true;
    });
    assert.equal(calls, 1);
  }
});
