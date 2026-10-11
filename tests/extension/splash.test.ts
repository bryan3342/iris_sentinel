// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { firstOpenSplash } from '../../extension/src/sidepanel/splash';

let stored: Record<string, unknown>, reduced: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  stored = {}; reduced = false;
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
  } } });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
  document.body.replaceChildren();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const splash = () => document.querySelector<HTMLElement>('.splash');

it('plays the eye animation on the first opening ever, then remembers it', async () => {
  let over = false;
  const playing = firstOpenSplash(document.body).then(() => { over = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(splash()?.getAttribute('aria-label')).toBe('Iris');
  expect(splash()!.querySelector('.blink')).not.toBeNull();
  expect(splash()!.querySelector('linearGradient')!.id).not.toBe('iris-grad'); // the header's gradient keeps its own id
  expect(over).toBe(false);
  splash()!.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'splash-out' }));
  await playing;
  expect(splash()).toBeNull();
  expect(stored['iris.splashShown']).toBe(true);
  await firstOpenSplash(document.body);
  expect(splash()).toBeNull(); // never again
});

it('ends on its own when animations do not run, and shows a still wordmark briefly with reduced motion', async () => {
  let over = false;
  void firstOpenSplash(document.body).then(() => { over = true; });
  await vi.advanceTimersByTimeAsync(3_400);
  expect(over).toBe(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(over).toBe(true);

  stored = {}; reduced = true; over = false;
  void firstOpenSplash(document.body).then(() => { over = true; });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(over).toBe(true);
});
