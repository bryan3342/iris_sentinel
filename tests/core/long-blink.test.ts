import { describe, expect, it } from 'vitest';
import { LongBlinkDetector } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const sample = (t: number, left: number, right = left): GazeSample =>
  ({ t, eye: left > 0.5 && right > 0.5 ? null : { x: 0, y: 0 }, head: HEAD, blink: { left, right } });
/** Feeds open eyes, then both eyes closed for `closedMs`, then open again, all aimed at `aim` (or as given). */
function run(detector: LongBlinkDetector, closedMs: number, aimWhileClosed: number | null = 4, aimAfter: number | null = 4) {
  const events = [];
  let t = 0;
  for (; t < 300; t += 33) events.push(detector.update(sample(t, 0.05), 4));
  const end = t + closedMs;
  for (; t <= end; t += 33) events.push(detector.update(sample(t, 0.9), aimWhileClosed));
  for (let i = 0; i < 5; i++, t += 33) events.push(detector.update(sample(t, 0.05), aimAfter));
  return events.filter((e) => e !== null);
}

describe('LongBlinkDetector', () => {
  it('confirms once when both eyes close deliberately and open again on the same target', () => {
    const events = run(new LongBlinkDetector(), 600);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('long-blink');
  });

  it('ignores a closure too short to be deliberate, and one long enough to be resting the eyes', () => {
    expect(run(new LongBlinkDetector(), 150)).toHaveLength(0);
    expect(run(new LongBlinkDetector(), 2500)).toHaveLength(0);
  });

  it('ignores a wink: one eye closed is not a confirm', () => {
    const detector = new LongBlinkDetector();
    const events = [];
    for (let t = 0; t < 1200; t += 33) events.push(detector.update(sample(t, 0.9, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(0);
  });

  it('ignores a closure during which the aim moved, or with nothing aimed', () => {
    expect(run(new LongBlinkDetector(), 600, 4, 5)).toHaveLength(0);
    expect(run(new LongBlinkDetector(), 600, null, null)).toHaveLength(0);
  });

  it('does not count a half-open flicker as reopening', () => {
    const detector = new LongBlinkDetector();
    const events = [];
    let t = 0;
    for (; t < 400; t += 33) events.push(detector.update(sample(t, 0.9), 4));
    events.push(detector.update(sample(t, 0.45), 4)); // between closed and open
    t += 33;
    for (; t < 700; t += 33) events.push(detector.update(sample(t, 0.9), 4));
    events.push(detector.update(sample(t, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(1); // one closure, one confirm
  });
});
