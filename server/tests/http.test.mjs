import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
test('bounded reader cancels a stalled ingestion stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const controller = new AbortController(); const pending = m.readBytes(stream, 100, controller.signal); controller.abort();
  await assert.rejects(pending); assert.equal(cancelled, true);
});
test('the retired labels-only endpoint is gone, even on localhost', async () => {
  const worker = m.createWorker();
  const request = new Request('http://localhost/gemini/find-target', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(request, { GEMINI_API_KEY: 'unused' })).status, 404);
});

