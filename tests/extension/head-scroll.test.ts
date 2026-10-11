// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GazeSample } from '@iris/protocol';
import { pageScrollStream } from '../../extension/src/content/scroll';
import { HeadScroller } from '../../extension/src/sidepanel/head-scroll';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (globalThis as { __irisScrollV01?: boolean }).__irisScrollV01; });

describe('pageScrollStream', () => {
  function connect() {
    const connects: ((port: unknown) => void)[] = [];
    const scrollBy = vi.fn();
    vi.stubGlobal('chrome', { runtime: { onConnect: { addListener: (l: (port: unknown) => void) => connects.push(l) } } });
    vi.stubGlobal('scrollBy', scrollBy);
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
    pageScrollStream();
    pageScrollStream(); // a second install adds nothing
    expect(connects).toHaveLength(1);
    let send: (m: unknown) => void = () => {}, drop: () => void = () => {};
    connects[0]!({ name: 'iris.head-scroll', onMessage: { addListener: (l: typeof send) => (send = l) }, onDisconnect: { addListener: (l: typeof drop) => (drop = l) } });
    const scrolled = () => scrollBy.mock.calls.reduce((sum, [, y]) => sum + y, 0);
    return { send: (m: unknown) => send(m), drop: () => drop(), scrolled };
  }

  it('scrolls at the speed it is sent until told zero', async () => {
    const page = connect();
    page.send({ speed: 600 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.scrolled()).toBeGreaterThan(500);
    expect(page.scrolled()).toBeLessThan(700);
    page.send({ speed: 0 });
    const stopped = page.scrolled();
    await vi.advanceTimersByTimeAsync(500);
    expect(page.scrolled()).toBe(stopped);
  });

  it('scrolls up for a negative speed, caps the speed, and stops on bad input or a disconnect', async () => {
    const page = connect();
    page.send({ speed: -100_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.scrolled()).toBeLessThan(-2500);
    expect(page.scrolled()).toBeGreaterThan(-3500);
    page.send({ speed: 'fast' });
    let held = page.scrolled();
    await vi.advanceTimersByTimeAsync(300);
    expect(page.scrolled()).toBe(held);
    page.send({ speed: 400 });
    page.drop();
    await vi.advanceTimersByTimeAsync(300);
    held = page.scrolled();
    await vi.advanceTimersByTimeAsync(300);
    expect(page.scrolled()).toBe(held);
  });
});

describe('HeadScroller', () => {
  const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
  const sample = (t: number, pitchDeg: number, face = true): GazeSample =>
    ({ t, eye: face ? { x: 0, y: 0 } : null, head: { ...HEAD, pitch: (pitchDeg * Math.PI) / 180 }, blink: { left: 0, right: 0 } });
  let posted: unknown[];
  beforeEach(() => {
    posted = [];
    vi.stubGlobal('chrome', {
      scripting: { executeScript: vi.fn(async () => [{ frameId: 0 }]) },
      tabs: { connect: vi.fn(() => ({ postMessage: (m: unknown) => posted.push(m), disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } })) },
    });
  });

  it('sends a scroll speed only while the head is tilted, and zero when it comes back', async () => {
    const scroller = new HeadScroller();
    let t = 0;
    const play = async (ms: number, pitch: number, face = true) => {
      for (const end = t + ms; t < end; t += 33) { scroller.update(sample(t, pitch, face), 7); await vi.advanceTimersByTimeAsync(0); }
    };
    await play(2000, 0);
    expect(posted).toEqual([]); // resting: nothing to send
    await play(1500, 18);
    const speeds = posted.map((m) => (m as { speed: number }).speed);
    expect(speeds.length).toBeGreaterThan(0);
    expect(speeds.every((s) => s > 0)).toBe(true);
    expect(speeds.length).toBeLessThan(45); // only changes are sent, not every frame
    await play(1000, 0);
    expect(posted.at(-1)).toEqual({ speed: 0 });
    await play(1000, 18);
    await play(100, 18, false); // the face is lost
    expect(posted.at(-1)).toEqual({ speed: 0 });
    scroller.stop();
  });
});
