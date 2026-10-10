import { afterEach, expect, it, vi } from 'vitest';
import { DemoSession } from '../../extension/src/page-understanding/session';

/** Stands in for chrome.storage.session, which outlives the background worker but never reaches disk. */
function memoryArea() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (key: string) => (key in values ? { [key]: structuredClone(values[key]) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, structuredClone(items)); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  };
}
const TOKEN = 'a'.repeat(43);
afterEach(() => vi.restoreAllMocks());

it('keeps the token when the background worker restarts', async () => {
  const area = memoryArea();
  await new DemoSession(area as never).set('http://127.0.0.1:8787', TOKEN);
  // A fresh instance, as after Chrome stops the idle worker and starts it again.
  expect(await new DemoSession(area as never).require('http://127.0.0.1:8787')).toBe(TOKEN);
});

it('refuses another gateway, an expired token or a cleared one, and forgets it', async () => {
  const area = memoryArea(), session = new DemoSession(area as never);
  await session.set('http://127.0.0.1:8787', TOKEN);
  await expect(session.require('https://other.example')).rejects.toThrow('DEMO_SESSION_REQUIRED');
  expect(area.values).toEqual({});
  await session.set('http://127.0.0.1:8787', TOKEN);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900_001);
  await expect(session.require('http://127.0.0.1:8787')).rejects.toThrow('DEMO_SESSION_REQUIRED');
  vi.restoreAllMocks();
  await session.set('http://127.0.0.1:8787', TOKEN);
  await session.clear();
  await expect(session.require('http://127.0.0.1:8787')).rejects.toThrow('DEMO_SESSION_REQUIRED');
});

it('rejects a malformed token before storing anything', async () => {
  const area = memoryArea();
  await expect(new DemoSession(area as never).set('http://127.0.0.1:8787', 'short')).rejects.toThrow('INVALID_SESSION');
  expect(area.set).not.toHaveBeenCalled();
});
