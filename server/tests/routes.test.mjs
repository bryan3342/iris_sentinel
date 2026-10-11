import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { input, localRequest, localTabRequest, result, setup, request, tabInput, tabMatch } from './fixtures.mjs';
const provider = understand => ({ findTarget: understand, summarizePage: understand, describeImage: understand, describeTarget: understand });

for (const operation of m.OPERATIONS) {
  test(`${operation}: authenticated route validates a screenshot`, async () => {
    const s = await setup(); let calls = 0;
    const worker = m.createWorker(provider(async data => { calls++; return result(data.operation); }));
    const response = await worker.fetch(request(input(operation), s.session.sessionToken), s.env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    const expected = operation === 'summarize_page' ? { ...result(operation), summary: `Visible viewport only: ${result(operation).summary}` } : result(operation);
    assert.deepEqual(m.validateResult(body, m.validateInput(input(operation))).result, expected);
    assert.equal(calls, 1);
    const persisted = JSON.stringify(s.env);
    assert.doesNotMatch(persisted, /sample|image\/png|iVBOR|Find the icon/);
  });
}test('authentication, configuration and origin denial happen before provider calls', async () => {
  const s = await setup(), worker = m.createWorker(provider(async () => assert.fail('must not call provider')));
  for (const [req, env, status] of [
    [request(input(), 'x'.repeat(72)), s.env, 401],
    [request(input(), s.session.sessionToken), { ...s.env, PAGE_CONTENT_APPROVED: 'false' }, 503],
    [request(input(), s.session.sessionToken), { ...s.env, ENABLE_PAGE_UNDERSTANDING: 'false' }, 503],
    [request(input(), s.session.sessionToken, { headers: { Origin: 'https://evil.example' } }), s.env, 403],
  ]) { const response = await worker.fetch(req, env); assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store'); }
});
test('route validates fake-provider output independently and releases failed admission', async () => {
  const s = await setup(); const worker = m.createWorker(provider(async () => ({ ...result('find_target'), targetId: 999 })), s.gate);
  const response = await worker.fetch(request(input(), s.session.sessionToken), s.env);
  assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'INVALID_MODEL_RESULT');
  assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 200);
});
test('malformed image and oversized ingestion cannot reach the provider', async () => {
  const worker = m.createWorker(provider(async () => assert.fail('must not call provider')));
  for (const oversized of [false, true]) {
    const s = await setup(), data = input(); data.image.data = 'AAAA';
    const req = oversized ? new Request('https://demo.example/v0.1/page-understanding/find_target', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session.sessionToken}` }, body: 'x'.repeat(m.LIMITS.bodyBytes + 1),
    }) : request(data, s.session.sessionToken);
    assert.equal((await worker.fetch(req, s.env)).status, oversized ? 413 : 400);
  }
});

test('summary viewport disclosure is added independently of model compliance', async () => {
  const s = await setup();
  const worker = m.createWorker(provider(async () => ({ operation: 'summarize_page', scope: 'visible_viewport', summary: 'x'.repeat(2000) })));
  const response = await worker.fetch(request(input('summarize_page'), s.session.sessionToken), s.env);
  assert.equal(response.status, 200); const summary = (await response.json()).result.summary;
  assert.match(summary, /^Visible viewport only:/); assert.equal(summary.length, 2000);
});
test('timeout keeps a conservative concurrency lease and stops the route', async () => {
  const s = await setup(), controller = new AbortController(); let entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const worker = m.createWorker(provider(async (_data, signal) => {
    entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw new m.HttpError(504, 'TIMEOUT');
  }), s.gate);
  const response = worker.fetch(request(input(), s.session.sessionToken, { signal: controller.signal }), s.env);
  await arrived; controller.abort();
  assert.equal((await response).status, 504);
  assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 409);
});

test('the Iris extension on this computer needs no token; everything else still does', async () => {
  const s = await setup(); let calls = 0;
  const worker = m.createWorker(provider(async data => { calls++; return result(data.operation); }));
  const env = { ...s.env, DEMO_SESSIONS: '{}' }; // no tokens issued at all
  assert.equal((await worker.fetch(localRequest(input(), env.EXTENSION_ORIGIN), env)).status, 200);
  assert.equal((await worker.fetch(localRequest(input()), env)).status, 401); // a local program without the extension origin
  assert.equal((await worker.fetch(localRequest(input(), 'https://evil.example'), env)).status, 403); // a web page
  const remote = new Request(`https://demo.example/v0.1/page-understanding/find_target`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.EXTENSION_ORIGIN }, body: JSON.stringify(input()) });
  assert.equal((await worker.fetch(remote, env)).status, 401); // not this computer
  assert.equal(calls, 1);
});
test('local use allows one request at a time and ten a minute, with no total cap', async () => {
  let now = 0;
  const gate = new m.DemoAccess(() => now);
  for (let minute = 0; minute < 3; minute++) {
    for (let n = 0; n < 10; n++) gate.release(gate.admitLocal());
    assert.throws(() => gate.admitLocal(), e => e.status === 429);
    now += 60_001;
  }
  const held = gate.admitLocal();
  assert.throws(() => gate.admitLocal(), e => e.status === 409);
  gate.release(held); assert.ok(gate.admitLocal());
});

const tabs = matchTab => ({ matchTab });
test('tab match: the extension on this computer gets the tab the model named, and nothing is kept', async () => {
  const s = await setup(); let asked;
  const worker = m.createWorker(undefined, s.gate, undefined, tabs(async (data) => { asked = data; return tabMatch(); }));
  const response = await worker.fetch(localTabRequest(tabInput(), s.env.EXTENSION_ORIGIN), s.env);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), s.env.EXTENSION_ORIGIN);
  assert.deepEqual(await response.json(), { protocolVersion: '0.1', requestId: tabInput().requestId, match: tabMatch() });
  assert.deepEqual(asked, tabInput());
  assert.doesNotMatch(JSON.stringify(s.env), /recipe|Inbox/);
});
test('tab match: settings, content approval, origin and input are checked before the model is asked', async () => {
  const s = await setup(), worker = m.createWorker(undefined, s.gate, undefined, tabs(async () => assert.fail('must not ask the model')));
  for (const [req, env, status] of [
    [localTabRequest(tabInput(), s.env.EXTENSION_ORIGIN), { ...s.env, ENABLE_PAGE_UNDERSTANDING: 'false' }, 503],
    [localTabRequest(tabInput(), s.env.EXTENSION_ORIGIN), { ...s.env, PAGE_CONTENT_APPROVED: 'false' }, 503],
    [localTabRequest(tabInput(), 'https://evil.example'), s.env, 403],
    [localTabRequest(tabInput()), s.env, 401],
    [localTabRequest({ ...tabInput(), tabs: [] }, s.env.EXTENSION_ORIGIN), s.env, 400],
  ]) { const response = await worker.fetch(req, env); assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'no-store'); }
});
test('tab match: an answer naming a tab that was not offered never reaches the extension', async () => {
  const s = await setup(), worker = m.createWorker(undefined, s.gate, undefined, tabs(async () => ({ ...tabMatch(), tabId: 9 })));
  const response = await worker.fetch(localTabRequest(tabInput(), s.env.EXTENSION_ORIGIN), s.env);
  assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'INVALID_MODEL_RESULT');
});
