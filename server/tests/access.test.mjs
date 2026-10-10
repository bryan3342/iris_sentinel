import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './fixtures.mjs';
import { modules } from './modules.mjs';
import { provisionDemoSession } from '../scripts/provision-demo-session.mjs';

test('operator provisions independent 15-minute sessions with server-side hashes', async () => {
  const first = provisionDemoSession(1000), second = provisionDemoSession(1000);
  assert.equal(first.expiresAt, 901000); assert.notEqual(first.sessionToken, second.sessionToken);
  assert.equal(first.sessionToken.length, 43);
  assert.equal(Object.values(first.serverBinding)[0].tokenHash, await modules.tokenHash(first.sessionToken));
  assert.doesNotMatch(JSON.stringify(first.serverBinding), new RegExp(first.sessionToken));
});
test('unknown, malformed, expired and revoked tokens are denied', async () => {
  const s = await setup();
  assert.equal((await s.call('/admit', { sessionToken: 'unknown'.padEnd(43, 'x') })).status, 401);
  assert.equal((await s.call('/admit', { sessionToken: 'short' })).status, 401);
  s.advance(900001); assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 401);
  const revoked = await setup(); revoked.env.DEMO_SESSIONS = '{}';
  assert.equal((await revoked.call('/admit', { sessionToken: revoked.session.sessionToken })).status, 401);
});
test('local concurrent admission allows exactly one request and validates releases', async () => {
  const s = await setup();
  const responses = await Promise.all(Array.from({ length: 5 }, () => s.call('/admit', { sessionToken: s.session.sessionToken })));
  assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 4);
  const lease = await responses.find(r => r.status === 200).json();
  await s.call('/release', { ...lease, leaseId: 'wrong' });
  assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 409);
  await s.call('/release', lease); assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 200);
});
test('minute and session limits survive token re-entry within the same instance', async () => {
  const s = await setup();
  for (let n = 0; n < 10; n++) {
    if (n % 2 === 0 && n) s.advance(60001);
    const admitted = await s.call('/admit', { sessionToken: s.session.sessionToken }); assert.equal(admitted.status, 200);
    await s.call('/release', await admitted.json());
    if (n === 1) assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 429);
  }
  s.advance(60001); assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 429);
});
test('cold starts have independent counters: documented private-demo limitation', async () => {
  const s = await setup();
  assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 200);
  const anotherInstance = new modules.DemoAccess();
  assert.ok(await anotherInstance.admit(s.env, s.session.sessionToken));
});
test('expired lease recovers locally without resetting request count', async () => {
  const s = await setup(); assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 200);
  s.advance(45001); const next = await s.call('/admit', { sessionToken: s.session.sessionToken }); assert.equal(next.status, 200);
  await s.call('/release', await next.json());
  assert.equal((await s.call('/admit', { sessionToken: s.session.sessionToken })).status, 429);
});
