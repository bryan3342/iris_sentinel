import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { tabInput, tabMatch } from './fixtures.mjs';

test('tab match input carries only the request and each tab\'s title and site', () => {
  assert.deepEqual(m.validateTabInput(tabInput()), tabInput());
});
for (const [name, mutate] of [
  ['a full address', d => { d.tabs[0].url = 'https://mail.example.com/inbox?token=1'; }],
  ['a site with a path', d => { d.tabs[0].host = 'mail.example.com/inbox'; }],
  ['an unknown field', d => { d.secret = 'private'; }],
  ['a duplicate tab ID', d => { d.tabs.push({ ...d.tabs[0] }); }],
  ['no tabs', d => { d.tabs = []; }],
  ['too many tabs', d => { d.tabs = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, title: 'A tab', host: 'example.com' })); }],
  ['an empty request', d => { d.request = ' '; }],
  ['an oversized title', d => { d.tabs[0].title = 'x'.repeat(201); }],
  ['another protocol version', d => { d.protocolVersion = '0.2'; }],
]) test(`tab match input rejects ${name}`, () => { const d = tabInput(); mutate(d); assert.throws(() => m.validateTabInput(d)); });

test('a tab match names one supplied tab, or none, and nothing else', () => {
  const input = m.validateTabInput(tabInput());
  assert.deepEqual(m.validateTabMatch(tabMatch(), input), tabMatch());
  const none = { tabId: null, explanation: 'No tab is about cooking.' };
  assert.deepEqual(m.validateTabMatch(none, input), none);
  for (const bad of [{ ...tabMatch(), tabId: 9 }, { ...tabMatch(), url: 'https://evil.example' }, { tabId: 2 }, { ...tabMatch(), explanation: 'x'.repeat(501) }]) {
    assert.throws(() => m.validateTabMatch(bad, input));
  }
});

test('a tab match result must answer the same request', () => {
  const input = m.validateTabInput(tabInput());
  const result = { protocolVersion: '0.1', requestId: input.requestId, match: tabMatch() };
  assert.deepEqual(m.validateTabResult(result, input), result);
  assert.throws(() => m.validateTabResult({ ...result, requestId: 'request_zzzzzzzzzzzzzzzz' }, input));
});
