import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PAGE_ACCESS, watchPageAccess } from '../../extension/src/sidepanel/setup/page-access';

const manifest = JSON.parse(readFileSync(new URL('../../extension/public/manifest.json', import.meta.url), 'utf8'));
let granted: boolean;
const event = () => {
  const listeners = new Set<() => void>();
  return { listeners, addListener: (l: () => void) => listeners.add(l), removeListener: (l: () => void) => listeners.delete(l) };
};
let onAdded: ReturnType<typeof event>, onRemoved: ReturnType<typeof event>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  granted = false;
  onAdded = event();
  onRemoved = event();
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => granted), onAdded, onRemoved } });
});
afterEach(() => vi.unstubAllGlobals());

it('asks only for origins the manifest declares as optional, or Chrome rejects the request', () => {
  expect(manifest.optional_host_permissions).toEqual(expect.arrayContaining(PAGE_ACCESS.origins!));
  expect(manifest.host_permissions).toBeUndefined(); // access stays opt-in
});

it('reports the current state, then follows grants and removals until unwatched', async () => {
  const states: boolean[] = [];
  const unwatch = watchPageAccess((state) => states.push(state));
  await settle();
  granted = true;
  onAdded.listeners.forEach((l) => l());
  await settle();
  granted = false;
  onRemoved.listeners.forEach((l) => l());
  await settle();
  expect(states).toEqual([false, true, false]);
  unwatch();
  expect(onAdded.listeners.size + onRemoved.listeners.size).toBe(0);
});
