import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { input, result, setup } from './fixtures.mjs';

test('actual database-free Worker: provisioned authentication and the Gemini route, Gemini answered at the network edge', async () => {
  const s = await setup();
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022' });
  const upstream = [];
  const mf = new Miniflare({ modules: true, script: outputFiles[0].text, compatibilityDate: '2026-04-26',
    bindings: s.env,
    // The real Gemini adapter runs; only Google's reply is stood in for. Every other host is refused.
    outboundService: async (outbound) => {
      const url = new URL(outbound.url);
      if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('No other external calls permitted in tests');
      const body = await outbound.json();
      const { operation } = JSON.parse(body.contents[0].parts[0].text);
      upstream.push(operation);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result(operation)) }] } }] });
    },
  });
  try {
    const post = (path, body, token) => mf.dispatchFetch(`http://localhost${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const session = s.session;
    for (const operation of ['find_target', 'summarize_page']) {
      const response = await post(`/v0.1/page-understanding/${operation}`, input(operation), session.sessionToken);
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal((await response.json()).result.operation, operation);
    }
    const limited = await post('/v0.1/page-understanding/describe_image', input('describe_image'), session.sessionToken);
    assert.equal(limited.status, 429);
    assert.deepEqual(upstream, ['find_target', 'summarize_page']); // the limited request never reached Gemini
  } finally { await mf.dispose(); }
});
