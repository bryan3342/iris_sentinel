import { describe, expect, it } from 'vitest';
import { VitalsWindow } from '@iris/core';
import type { Reading } from '@iris/protocol';

const steady = (value: number): Reading => ({ value, confidence: 0.9, stable: true });

/** Adds one reading a second from `from` (inclusive) to `to` (exclusive). */
function feed(window: VitalsWindow, reading: (t: number) => Reading | null, from: number, to: number): void {
  for (let t = from; t < to; t += 1_000) window.add(t, reading(t));
}

describe('VitalsWindow', () => {
  it('gives the median of the last 30 s once there are 10 usable readings', () => {
    const hrv = new VitalsWindow();
    feed(hrv, () => steady(45), 0, 9_000);
    expect(hrv.value(8_000)).toBeNull(); // 9 readings
    hrv.add(9_000, steady(45));
    expect(hrv.value(9_000)).toBe(45);
  });

  it('shrugs off an odd spike', () => {
    const hrv = new VitalsWindow();
    feed(hrv, (t) => steady(t === 5_000 ? 200 : 45), 0, 20_000);
    expect(hrv.value(19_000)).toBe(45);
  });

  it('follows the signal as old readings leave the window', () => {
    const hrv = new VitalsWindow();
    feed(hrv, () => steady(45), 0, 30_000);
    expect(hrv.value(29_000)).toBe(45);
    feed(hrv, () => steady(25), 30_000, 60_000);
    expect(hrv.value(59_000)).toBe(25);
  });

  it('ignores readings that are missing, not yet stable, not confident enough or not numbers', () => {
    const hrv = new VitalsWindow();
    feed(hrv, () => ({ value: 45, confidence: 0.9, stable: false }), 0, 30_000);
    feed(hrv, () => ({ value: 45, confidence: 0.4, stable: true }), 0, 30_000);
    feed(hrv, () => steady(Number.NaN), 0, 30_000);
    feed(hrv, () => null, 0, 30_000);
    expect(hrv.value(29_000)).toBeNull();
  });

  it('forgets everything on clear', () => {
    const hrv = new VitalsWindow();
    feed(hrv, () => steady(45), 0, 20_000);
    hrv.clear();
    expect(hrv.value(19_000)).toBeNull();
  });
});
