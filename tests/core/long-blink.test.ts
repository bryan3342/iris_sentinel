import { describe, expect, it } from 'vitest';
import { LongBlinkDetector, type ConfirmEvent } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const FRAME = 33;
const sample = (t: number, left: number, right = left): GazeSample =>
  ({ t, eye: left > 0.5 && right > 0.5 ? null : { x: 0, y: 0 }, head: HEAD, blink: { left, right } });

/** Plays open eyes aimed per `before(t)` until `closeAt`, both eyes closed for `closedMs`, then open aimed at `after`. */
function blink(closedMs: number, { closeAt = 600, before = (_t: number): number | null => 4, after = 4 as number | null, detector = new LongBlinkDetector() } = {}) {
  const events: ConfirmEvent[] = [];
  const push = (e: ConfirmEvent | null) => { if (e) events.push(e); };
  let t = 0;
  for (; t < closeAt; t += FRAME) push(detector.update(sample(t, 0.05), before(t)));
  const lastOpen = t - FRAME;
  for (; t < lastOpen + closedMs; t += FRAME) push(detector.update(sample(t, 0.9), before(lastOpen)));
  for (let i = 0; i < 5; i++, t += FRAME) push(detector.update(sample(t, 0.05), after));
  return events;
}

describe('LongBlinkDetector', () => {
  it('clicks once when both eyes close for about half a second, on the target locked before closing', () => {
    const events = blink(600);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'long-blink', target: 4 });
  });

  it('ignores a natural blink and resting the eyes', () => {
    expect(blink(300)).toHaveLength(0); // natural blinks last about 0.1 to 0.4 s
    expect(blink(2000)).toHaveLength(0); // longer than 1.5 s is resting, never a click
  });

  it('ignores a wink: one eye closed is not a click', () => {
    const detector = new LongBlinkDetector();
    const events = [];
    for (let t = 0; t < 1500; t += FRAME) events.push(detector.update(sample(t, 0.9, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(0);
  });

  it('keeps the steady target when the aim jumps as the lids close and again as they open', () => {
    // Steady on 4, then the closing lids throw the reading onto 5 for the last frames before closing.
    const events = blink(700, { before: (t) => (t >= 540 ? 5 : 4), after: 5 });
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe(4);
  });

  it('does not click when nothing was aimed steadily before closing', () => {
    expect(blink(700, { before: (t) => Math.floor(t / FRAME) % 3 })).toHaveLength(0); // the aim never settles
    expect(blink(700, { before: () => null })).toHaveLength(0);
  });

  it('times the closure from the last open sample, since the camera holds back the start of every blink', () => {
    const detector = new LongBlinkDetector();
    const events = [];
    let t = 0;
    for (; t <= 300; t += FRAME) events.push(detector.update(sample(t, 0.05), 4));
    // Nothing arrives for the first 400 ms of the closure, then closed samples until about 0.6 s in.
    for (t = 700; t <= 900; t += FRAME) events.push(detector.update(sample(t, 0.9), 4));
    events.push(detector.update(sample(t, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(1);
  });

  it('does not count a half-open flicker as reopening', () => {
    const detector = new LongBlinkDetector();
    const events = [];
    let t = 0;
    for (; t < 300; t += FRAME) events.push(detector.update(sample(t, 0.05), 4));
    for (; t < 600; t += FRAME) events.push(detector.update(sample(t, 0.9), 4));
    events.push(detector.update(sample(t, 0.45), 4)); // between closed and open
    for (t += FRAME; t < 900; t += FRAME) events.push(detector.update(sample(t, 0.9), 4));
    events.push(detector.update(sample(t, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(1); // one closure, one click
  });

  it('forgets a closure in progress on reset', () => {
    const detector = new LongBlinkDetector();
    for (let t = 0; t < 300; t += FRAME) detector.update(sample(t, 0.05), 4);
    detector.update(sample(330, 0.9), 4);
    expect(detector.locked).toBe(4);
    detector.reset();
    expect(detector.locked).toBeNull();
    expect(detector.update(sample(900, 0.05), 4)).toBeNull();
  });
});
