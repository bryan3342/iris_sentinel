import { describe, expect, it } from 'vitest';
import { TiltScroller } from '@iris/core';

const deg = (d: number) => (d * Math.PI) / 180;
/** Feeds `ms` of samples at 30 a second with the head pitched `pitchDeg`; returns the last speed. */
function hold(scroller: TiltScroller, from: number, ms: number, pitchDeg: number, face = true): { speed: number; t: number } {
  let speed = 0, t = from;
  for (; t < from + ms; t += 33) speed = scroller.update(deg(pitchDeg), t, face);
  return { speed, t };
}

describe('TiltScroller', () => {
  it('does nothing while the head stays near its resting position', () => {
    const s = new TiltScroller();
    expect(hold(s, 0, 2000, 3).speed).toBe(0);
    expect(hold(s, 2000, 2000, -4).speed).toBe(0);
  });

  it('scrolls down when the head tilts down past the threshold, up when it tilts up', () => {
    const s = new TiltScroller();
    let { t } = hold(s, 0, 2000, 0);
    const down = hold(s, t, 1000, 15);
    expect(down.speed).toBeGreaterThan(0);
    t = hold(s, down.t, 1000, 0).t; // back to rest: stops
    expect(s.update(deg(0), t, true)).toBe(0);
    expect(hold(s, t, 1000, -15).speed).toBeLessThan(0);
  });

  it('scrolls faster the further the head tilts, up to a maximum', () => {
    const speedAt = (tilt: number) => {
      const s = new TiltScroller();
      const { t } = hold(s, 0, 2000, 0);
      return hold(s, t, 1500, tilt).speed;
    };
    expect(speedAt(14)).toBeLessThan(speedAt(20));
    expect(speedAt(20)).toBeLessThan(speedAt(25));
    expect(speedAt(40)).toBe(speedAt(30)); // capped
  });

  it('keeps scrolling through small dips back toward the threshold, and stops once clearly back', () => {
    const s = new TiltScroller();
    let { t } = hold(s, 0, 2000, 0);
    t = hold(s, t, 1000, 14).t;
    const dip = hold(s, t, 600, 8.5); // between the stop and start thresholds
    expect(dip.speed).toBeGreaterThan(0);
    expect(hold(s, dip.t, 1000, 2).speed).toBe(0);
  });

  it('re-centers slowly on a new resting position instead of scrolling by itself', () => {
    const s = new TiltScroller();
    let { t } = hold(s, 0, 2000, 0);
    // The user settles 6 degrees lower (a new seat or lid angle) and stays there.
    t = hold(s, t, 20_000, 6).t;
    // A further deliberate tilt of 12 degrees from that new rest scrolls; the old rest would read it as 18.
    const s2 = hold(s, t, 1500, 18);
    expect(s2.speed).toBeGreaterThan(0);
    expect(hold(s, s2.t, 1500, 7).speed).toBe(0); // near the new rest: still
  });

  it('stops at once when the face is lost or the eyes close', () => {
    const s = new TiltScroller();
    let { t } = hold(s, 0, 2000, 0);
    t = hold(s, t, 1000, 20).t;
    expect(s.update(deg(20), t, false)).toBe(0);
  });

  it('ignores a quick nod', () => {
    const s = new TiltScroller();
    let { t } = hold(s, 0, 2000, 0);
    t = hold(s, t, 100, 20).t; // a 0.1 s nod
    expect(hold(s, t, 500, 0).speed).toBe(0);
  });
});
