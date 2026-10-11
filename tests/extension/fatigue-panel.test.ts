// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FatigueState } from '@iris/core';
import type { Quality } from '@iris/protocol';
import { fatiguePanel } from '../../extension/src/sidepanel/fatigue-panel';
import type { LinkState } from '../../extension/src/providers/companion/link';
import { DEMO_WARM_UP, SimulatedBodyProvider, TIRING_DEMO } from '../../extension/src/providers/simulated/body';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * Mounts the fatigue card on the fake clock. The simulated body stands in for the companion link: a scripted
 * user who is rested for a minute and then tires. `connect` and `drop` play the link's owner.
 */
function mount({ talking = (): boolean => false, quality = (): Quality => 'ok' } = {}) {
  const body = new SimulatedBodyProvider({ tiredness: TIRING_DEMO, warmUp: DEMO_WARM_UP, quality });
  let state: LinkState = 'connecting', changed: (s: LinkState) => void = () => {};
  const live = { start: vi.fn(async () => {}), stop: vi.fn(), get state() { return state; },
    onState: (l: (s: LinkState) => void) => { changed = l; return () => {}; },
    onBlink: body.onBlink.bind(body), onQuality: body.onQuality.bind(body), onVitals: body.onVitals.bind(body) };
  const results: FatigueState[] = [];
  const section = fatiguePanel({ now: () => Date.now(), live, onFatigue: (s) => results.push(s), talking });
  document.body.replaceChildren(section);
  const status = () => section.querySelector('[role=status]')!.textContent ?? '';
  const list = (name: string) => [...section.querySelectorAll(`ul.${name} li`)].map((li) => li.textContent);
  const progress = () => section.querySelector('.progress')!.textContent ?? '';
  // The companion starts sensing once connected, and stops with the connection.
  const connect = () => { state = 'connected'; changed(state); void body.start(); };
  const drop = () => { state = 'disconnected'; changed(state); body.stop(); };
  return { section, live, results, status, list, progress, connect, drop };
}

/** Advances the fake clock one second at a time and returns the time (s) each new status first appeared. */
function watch(status: () => string, seconds: number, from: number): Map<string, number> {
  const seen = new Map<string, number>();
  for (let s = from + 1; s <= from + seconds; s++) {
    vi.advanceTimersByTime(1_000);
    const level = status().replace(/ \(score \d+\)/, '');
    if (!seen.has(level)) seen.set(level, s);
  }
  return seen;
}

describe('fatigue card', () => {
  it('waits for the companion, with no demo and no controls of its own', () => {
    const { section, results, status } = mount();
    expect(section.querySelector('h2')!.textContent).toBe('Fatigue');
    expect(section.querySelectorAll('button, input')).toHaveLength(0);
    expect(status()).toBe('Fatigue: waiting for body signals.');
    vi.advanceTimersByTime(3_000);
    expect(results).toHaveLength(0); // not connected yet: nothing runs
  });

  it('runs on the companion while it is connected, from fresh to tiring to strained as the user tires, and passes results on', () => {
    const { results, status, list, progress, connect } = mount();
    connect();
    const seen = watch(status, 300, 0);
    // Live after about half a minute: blink rate needs 30 s, heart rate variability its warm-up plus 10 readings.
    expect(seen.get('Fatigue: fresh.')).toBeLessThan(40);
    expect(seen.get('Fatigue: tiring.')).toBeGreaterThan(90); // rested for the first minute
    expect(seen.get('Fatigue: tiring.')).toBeLessThan(180);
    expect(seen.get('Fatigue: strained.')).toBeLessThan(260);
    expect(list('why').join(' ')).toMatch(/Blink rate up|Heart rate variability down|Breathing rate up/);
    expect(list('signals')[0]).toMatch(/^Blink rate: \d+ a minute \(your normal \d+, \+\d+%\)$/);
    expect(progress()).toMatch(/^Measuring for 5 min 0 s, average \d+, highest \d+$/);
    expect(results.at(-1)!.level).toBe('strained');
  });

  it('stops with the companion, keeps the session summary on screen, and never starts or stops the companion itself', () => {
    const { live, results, status, list, connect, drop } = mount();
    connect();
    vi.advanceTimersByTime(260_000);
    drop();
    expect(status()).toBe('Fatigue: stopped.');
    const summary = list('summary');
    expect(summary[0]).toBe('Session: 4 min 20 s');
    expect(summary[1]).toMatch(/^Average score \d+, highest \d+$/);
    expect(summary.at(-1)).toMatch(/^Last: strained \(score \d+\)$/);
    const count = results.length;
    vi.advanceTimersByTime(30_000);
    expect(results).toHaveLength(count);
    expect(list('summary')).toEqual(summary);
    expect(vi.getTimerCount()).toBe(0);
    expect([live.start, live.stop].map((f) => f.mock.calls.length)).toEqual([0, 0]);
  });

  it('pauses and holds the score a few seconds after the face leaves the camera', () => {
    let away = false;
    const { status, list, connect } = mount({ quality: () => (away ? 'no-face' : 'ok') });
    connect();
    watch(status, 150, 0);
    away = true;
    vi.advanceTimersByTime(5_000); // a brief glitch does not pause; 3 s or more does
    const paused = status();
    expect(paused).toMatch(/^Fatigue: paused \(score \d+\)\.$/);
    expect(list('why')).toEqual(['Face out of view, paused']);
    vi.advanceTimersByTime(30_000);
    expect(status()).toBe(paused); // held while out of view
  });

  it('pauses while a conversation is open, and says so', () => {
    const { status, list, connect } = mount({ talking: () => true });
    connect();
    vi.advanceTimersByTime(60_000);
    expect(status()).toMatch(/^Fatigue: paused/);
    expect(list('why')).toContain('Talking with Iris, paused');
  });
});
