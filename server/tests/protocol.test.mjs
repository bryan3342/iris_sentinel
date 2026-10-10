import assert from 'node:assert/strict';
import test from 'node:test';
import { modules as m } from './modules.mjs';
import { input, result } from './fixtures.mjs';
for (const [name, mutate] of [
  ['unknown top-level field', d => { d.url = 'https://private.example'; }],
  ['unknown nested field', d => { d.binding.viewport.secret = 'private'; }],
  ['unknown target field', d => { d.targets[0].selector = '#pay'; }],
  ['duplicate target ID', d => { d.targets.push(d.targets[0]); }],
  ['empty optional label', d => { d.targets[0].label = ' '; }],
  ['out-of-viewport rectangle', d => { d.targets[0].rect.width = 3; }],
  ['invalid base64', d => { d.image.data = 'data:image/png;base64,abc='; }],
  ['wrong MIME', d => { d.image.mimeType = 'image/jpeg'; }],
  ['dimension cap', d => { d.image.width = 2049; }],
  ['pixel cap', d => { d.image.width = d.image.height = 2048; }],
  ['unexpected operation input', d => { d.imageId = 1; }],
]) test(`protocol rejects ${name}`, () => { const d = input(); mutate(d); assert.throws(() => m.validateInput(d)); });

test('null selection is valid; wrong image ID, unknown result fields and oversized text are invalid', () => {
  assert.equal(m.validateUnderstanding({ ...result('find_target'), targetId: null }, input()).targetId, null);
  assert.throws(() => m.validateUnderstanding({ ...result('describe_image'), imageId: 4 }, input('describe_image')));
  assert.throws(() => m.validateUnderstanding({ ...result('summarize_page'), url: 'https://evil' }, input('summarize_page')));
  assert.throws(() => m.validateUnderstanding({ ...result('summarize_page'), summary: 'x'.repeat(2001) }, input('summarize_page')));
});
