import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { input, result } from './fixtures.mjs';
for (const operation of ['find_target', 'summarize_page', 'describe_image']) {
  test(`${operation}: direct adapter sends inline PNG and validates output`, async () => {
    let calls = 0;
    const adapter = new m.GeminiMultimodal({ GEMINI_API_KEY: 'mock', GEMINI_MODEL: 'test-model' }, async function (url, options) {
      assert.equal(this, undefined); calls++;
      assert.match(url, /^https:\/\/generativelanguage.googleapis.com/);
      const body = JSON.parse(options.body); assert.equal(body.contents[0].parts[1].inlineData.data, input(operation).image.data);
      assert.equal(body.tools, undefined); assert.equal(body.cachedContent, undefined);
      assert.ok(body.generationConfig.maxOutputTokens <= 2048);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result(operation)) }] } }] });
    });
    assert.deepEqual(await adapter.understand(m.validateInput(input(operation)), new AbortController().signal), result(operation));
    assert.equal(calls, 1);
  });
}

for (const [name, response] of [
  ['unknown ID', () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...result('find_target'), targetId: 9 }) }] } }] })],
  ['truncation', () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })],
  ['action output', () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'click' } }] } }] })],
  ['oversized response', () => new Response('secret'.repeat(50_000))],
  ['invalid JSON', () => new Response('secret invalid JSON')],
]) test(`adapter safely rejects ${name} without retry`, async () => {
  let calls = 0;
  const adapter = new m.GeminiMultimodal({ GEMINI_API_KEY: 'secret-key', GEMINI_MODEL: 'test' }, async () => { calls++; return response(); });
  await assert.rejects(adapter.understand(input(), AbortSignal.timeout(1000)), e => e.status === 502 && !/secret/.test(e.message));
  assert.equal(calls, 1);
});
test('adapter bounds stalled upstream and cancellation even if fetch ignores abort', async () => {
  const adapter = new m.GeminiMultimodal({ GEMINI_API_KEY: 'mock', GEMINI_MODEL: 'test' }, () => new Promise(() => {}));
  const controller = new AbortController();
  const promise = adapter.understand(input(), controller.signal); controller.abort();
  await assert.rejects(promise, e => e.status === 504);
});
for (const code of [400, 401, 403, 429, 500, 503]) test(`multimodal upstream HTTP ${code} is safe and never retried`, async () => {
  let calls = 0;
  const adapter = new m.GeminiMultimodal({ GEMINI_API_KEY: 'secret-key', GEMINI_MODEL: 'mock' }, async () => {
    calls++; return new Response('secret upstream details', { status: code });
  });
  await assert.rejects(adapter.findTarget(input(), AbortSignal.timeout(1000)), error =>
    error.status === (code === 429 || code >= 500 ? 503 : 502) && error.code === 'UPSTREAM_UNAVAILABLE' && !/secret/.test(error.message));
  assert.equal(calls, 1);
});
