import { describe, expect, it } from 'vitest';
import { Baseline, strain } from '@iris/core';

/** Adds 60 values, 3 in every 10 tired and the rest rested, interleaved like a session that starts out tiring. */
function addMixed(baseline: Baseline, rested: number, tired: number): void {
  for (let i = 0; i < 60; i++) baseline.add(i % 10 < 3 ? tired : rested);
}

describe('Baseline', () => {
  it('uses the fallback until 60 usable values have arrived', () => {
    const blink = new Baseline({ fallback: 15, tiredDirection: 'up' });
    for (let i = 0; i < 59; i++) blink.add(20);
    expect(blink.value).toBe(15);
    expect(blink.personal).toBe(false);
    blink.add(20);
    expect(blink.value).toBe(20);
    expect(blink.personal).toBe(true);
  });

  it('takes the rested end, so a user who starts out tiring still gets their normal', () => {
    const blink = new Baseline({ fallback: 15, tiredDirection: 'up' });
    addMixed(blink, 16, 26); // blink rate rises when tired
    expect(blink.value).toBe(16);

    const hrv = new Baseline({ fallback: 40, tiredDirection: 'down' });
    addMixed(hrv, 50, 30); // heart rate variability falls when tired
    expect(hrv.value).toBe(50);
  });

  it('is frozen once set', () => {
    const blink = new Baseline({ fallback: 15, tiredDirection: 'up' });
    for (let i = 0; i < 60; i++) blink.add(16);
    for (let i = 0; i < 200; i++) blink.add(30);
    expect(blink.value).toBe(16);
  });

  it('has no value without a fallback until the personal baseline is set', () => {
    const timeToClick = new Baseline({ fallback: null, tiredDirection: 'up', samples: 3 });
    expect(timeToClick.value).toBeNull();
    [800, 900, 1000].forEach((ms) => timeToClick.add(ms));
    expect(timeToClick.value).toBe(850);
  });

  it('does not count values that are not finite numbers', () => {
    const blink = new Baseline({ fallback: 15, tiredDirection: 'up', samples: 2 });
    blink.add(Number.NaN);
    blink.add(Number.POSITIVE_INFINITY);
    blink.add(18);
    expect(blink.personal).toBe(false);
    blink.add(18);
    expect(blink.value).toBe(18);
  });

  it('goes back to the fallback on reset', () => {
    const blink = new Baseline({ fallback: 15, tiredDirection: 'up', samples: 1 });
    blink.add(18);
    blink.reset();
    expect(blink.value).toBe(15);
    expect(blink.personal).toBe(false);
  });
});

describe('strain', () => {
  const blinkRule = { tiredDirection: 'up' as const, ignoreBelow: 0.25, fullAt: 0.75 };
  const hrvRule = { tiredDirection: 'down' as const, ignoreBelow: 0.1, fullAt: 0.4 };

  it('is 0 inside the ignore zone and when the clue moved the rested way', () => {
    expect(strain(20, 16, blinkRule)).toBe(0); // +25%: still noise
    expect(strain(12, 16, blinkRule)).toBe(0); // fewer blinks than normal
  });

  it('rises in a straight line to 1 at the full point and stays capped', () => {
    expect(strain(24, 16, blinkRule)).toBe(0.5); // +50%: halfway from 25% to 75%
    expect(strain(28, 16, blinkRule)).toBe(1); // +75%
    expect(strain(40, 16, blinkRule)).toBe(1);
  });

  it('works for a clue that falls as the user tires', () => {
    expect(strain(30, 40, hrvRule)).toBeCloseTo(0.5); // -25%: halfway from 10% to 40%
    expect(strain(44, 40, hrvRule)).toBe(0);
  });

  it('is null when a value is missing or the baseline is not positive', () => {
    expect(strain(null, 16, blinkRule)).toBeNull();
    expect(strain(20, null, blinkRule)).toBeNull();
    expect(strain(20, 0, blinkRule)).toBeNull();
  });

  it('is null, not NaN, when a value is not a finite number', () => {
    expect(strain(Number.NaN, 16, blinkRule)).toBeNull();
    expect(strain(Infinity, 16, blinkRule)).toBeNull();
    expect(strain(20, Number.NaN, blinkRule)).toBeNull();
    expect(strain(20, Infinity, blinkRule)).toBeNull();
  });
});
