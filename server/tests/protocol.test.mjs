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

for (const [name, mutate] of [
  ['a second target', d => { d.targets.push({ ...d.targets[0], id: 6 }); }],
  ['a target ID that is not the supplied target', d => { d.targetId = 6; }],
  ['a missing crop', d => { delete d.sourceRect; }],
  ['a crop with the wrong shape', d => { d.sourceRect.width = 1; }],
  ['find-target fields', d => { d.request = 'Find'; }],
]) test(`describe_target rejects ${name}`, () => {
  const d = input('describe_target'); assert.doesNotThrow(() => m.validateInput(input('describe_target'))); mutate(d);
  assert.throws(() => m.validateInput(d));
});

test('null selection is valid; wrong image ID, unknown result fields and oversized text are invalid', () => {
  assert.equal(m.validateUnderstanding({ ...result('find_target'), targetId: null }, input()).targetId, null);
  assert.throws(() => m.validateUnderstanding({ ...result('describe_image'), imageId: 4 }, input('describe_image')));
  assert.throws(() => m.validateUnderstanding({ ...result('describe_target'), targetId: 6 }, m.validateInput(input('describe_target'))));
  assert.throws(() => m.validateUnderstanding({ ...result('summarize_page'), url: 'https://evil' }, input('summarize_page')));
  assert.throws(() => m.validateUnderstanding({ ...result('summarize_page'), summary: 'x'.repeat(2001) }, input('summarize_page')));
});

test('a summary may cover one region, and then must say so; other operations without a crop refuse one', () => {
  const region = m.validateInput({ ...input('summarize_page'), sourceRect: { x: 0, y: 0, width: 2, height: 2 } });
  assert.equal(m.validateUnderstanding({ ...result('summarize_page'), scope: 'visible_region' }, region).scope, 'visible_region');
  assert.throws(() => m.validateUnderstanding(result('summarize_page'), region));
  assert.throws(() => m.validateUnderstanding({ ...result('summarize_page'), scope: 'visible_region' }, m.validateInput(input('summarize_page'))));
  assert.throws(() => m.validateInput({ ...input('summarize_page'), sourceRect: { x: 0, y: 0, width: 2, height: 1 } })); // image does not match the crop
  assert.throws(() => m.validateInput({ ...input('find_target'), sourceRect: { x: 0, y: 0, width: 2, height: 2 } }));
});
