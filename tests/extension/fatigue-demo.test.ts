// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fatiguePanel } from '../../extension/src/sidepanel/fatigue-panel';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Mounts the fatigue card on the fake clock and returns its controls and a way to read it. */
function mount() {
  const section = fatiguePanel({ now: () => Date.now() });
  document.body.replaceChildren(section);
  const button = section.querySelector('button')!;
  const cover = section.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const status = () => section.querySelector('[role=status]')!.textContent ?? '';
  const why = () => [...section.querySelectorAll('li')].map((li) => li.textContent);
  return { section, button, cover, status, why };
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

describe('fatigue demo in the side panel', () => {
  it('waits for Play, then goes from fresh to tiring to strained as the scripted user tires', () => {
    const { button, status, why } = mount();
    expect(status()).toBe('Fatigue: not running.');
    button.click();
    expect(button.textContent).toBe('Stop demo');

    const seen = watch(status, 300, 0);
    // Live after about half a minute: blink rate needs 30 s, heart rate variability its warm-up plus 10 readings.
    expect(seen.get('Fatigue: fresh.')).toBeLessThan(40);
    expect(seen.get('Fatigue: tiring.')).toBeGreaterThan(90); // rested for the first minute
    expect(seen.get('Fatigue: tiring.')).toBeLessThan(180);
    expect(seen.get('Fatigue: strained.')).toBeLessThan(260);
    expect(why().length).toBeGreaterThan(0);
    expect(why().join(' ')).toMatch(/Blink rate up|Heart rate variability down|Breathing rate up/);
  });

  it('pauses and holds the score while the camera is covered', () => {
    const { button, cover, status, why } = mount();
    button.click();
    watch(status, 150, 0);
    const before = status().match(/score (\d+)/)![1];
    cover.checked = true;
    vi.advanceTimersByTime(2_000);
    expect(status()).toBe(`Fatigue: paused (score ${before}).`);
    expect(why()).toEqual(['Face out of view, paused']);
  });

  it('stops cleanly', () => {
    const { button, status } = mount();
    button.click();
    vi.advanceTimersByTime(30_000);
    button.click();
    expect(button.textContent).toBe('Play demo');
    expect(status()).toBe('Fatigue: not running.');
    vi.advanceTimersByTime(30_000);
    expect(status()).toBe('Fatigue: not running.');
    expect(vi.getTimerCount()).toBe(0);
  });
});
