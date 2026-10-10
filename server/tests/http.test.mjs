import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
test('bounded reader cancels a stalled ingestion stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const controller = new AbortController(); const pending = m.readBytes(stream, 100, controller.signal); controller.abort();
  await assert.rejects(pending); assert.equal(cancelled, true);
});
test('legacy endpoint is disabled remotely and rejects unknown fields locally', async () => {
  const worker = m.createWorker({ findTarget: async () => assert.fail('must not call provider') });
  const body = { request: 'Find', targets: [{ id: 1, role: 'link', label: 'A' }], screenshot: 'private' };
  const make = host => new Request(`http://${host}/gemini/find-target`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await worker.fetch(make('demo.example'))).status, 404);
  assert.equal((await worker.fetch(make('localhost'))).status, 400);
});

