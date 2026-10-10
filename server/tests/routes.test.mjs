import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { input, result, setup, request } from './fixtures.mjs';
const provider = understand => ({ findTarget: understand, summarizePage: understand, describeImage: understand, describeTarget: understand });

for (const operation of m.OPERATIONS) {
  test(`${operation}: authenticated route validates a synthetic screenshot`, async () => {
    const s = await setup(); let calls = 0;
    const worker = m.createWorker(provider(async data => { calls++; return result(data.operation); }));
    const response = await worker.fetch(request(input(operation), s.session.sessionToken), s.env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.json();
    const expected = operation === 'summarize_page' ? { ...result(operation), summary: `Visible viewport only: ${result(operation).summary}` } : result(operation);
    assert.deepEqual(m.validateResult(body, m.validateInput(input(operation))).result, expected);
    assert.equal(calls, 1);
    const persisted = JSON.stringify(s.env);
    assert.doesNotMatch(persisted, /synthetic|image\/png|iVBOR|Find the icon/);
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
test('synthetic provider never becomes an implicit deployed fallback', async () => {
  const s = await setup();
  const worker = m.createWorker();
  assert.equal((await worker.fetch(request(input(), s.session.sessionToken), { ...s.env, PAGE_UNDERSTANDING_PROVIDER: 'synthetic' })).status, 503);
});
