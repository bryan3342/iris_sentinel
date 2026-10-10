import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { input, png } from './fixtures.mjs';
for (const [name, data] of [
  ['bad signature', 'AAAA'], ['truncated PNG', png().slice(0, -8)], ['CRC corruption', Buffer.from(png(), 'base64').fill(0, 29, 33).toString('base64')],
  ['private text chunk', png(2, 2, { extra: 'tEXt' })], ['animation chunk', png(2, 2, { extra: 'acTL' })],
  ['bad filter', png(2, 2, { rows: Buffer.from([5, ...Array(17).fill(0)]) })],
  ['inflation overflow', png(2, 2, { rows: Buffer.alloc(1_000_000) })],
]) test(`PNG rejects ${name}`, async () => { await assert.rejects(m.validatePng({ ...input().image, data }, AbortSignal.timeout(1000))); });
test('PNG validates real dimensions, canonical encoding, and trailing bytes', async () => {
  await m.validatePng(input().image, AbortSignal.timeout(1000));
  await assert.rejects(m.validatePng({ ...input().image, width: 1 }, AbortSignal.timeout(1000)));
  await assert.rejects(m.validatePng({ ...input().image, data: Buffer.concat([Buffer.from(png(), 'base64'), Buffer.from('trailing')]).toString('base64') }, AbortSignal.timeout(1000)));
});

