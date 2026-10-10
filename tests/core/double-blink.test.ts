import { describe, expect, it } from 'vitest';
import { DoubleBlinkDetector, type ConfirmEvent } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const FRAME = 33;
// During a quick blink the camera holds the last eye reading, so the eye stays set; only the lids move.
const sample = (t: number, left: number, right = left): GazeSample => ({ t, eye: { x: 0, y: 0 }, head: HEAD, blink: { left, right } });

/** Open eyes aimed per `aimAt(t)` until 600 ms, then each blink in `blinks` as [closed ms, open ms after], then open eyes. */
function play(blinks: [number, number][], { aimAt = (_t: number): number | null => 4, detector = new DoubleBlinkDetector() } = {}) {
  const events: ConfirmEvent[] = [];
  const push = (e: ConfirmEvent | null) => { if (e) events.push(e); };
  let t = 0;
  for (; t < 600; t += FRAME) push(detector.update(sample(t, 0.05), aimAt(t)));
  for (const [closed, open] of blinks) {
    const end = t + closed;
    for (; t < end; t += FRAME) push(detector.update(sample(t, 0.9), aimAt(t)));
    const reopen = t + open;
    for (; t < reopen; t += FRAME) push(detector.update(sample(t, 0.05), aimAt(t)));
  }
  return { events, detector };
}

describe('DoubleBlinkDetector', () => {
  it('clicks the moment the eyes open after two quick blinks, on the target aimed before them', () => {
    const { events } = play([[150, 150], [150, 100]]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'double-blink', target: 4 });
  });

  it('ignores a single blink, and two blinks too far apart', () => {
    expect(play([[150, 500]]).events).toHaveLength(0);
    expect(play([[150, 900], [150, 100]]).events).toHaveLength(0);
  });

  it('ignores a closure longer than a quick blink, even as part of a pair', () => {
    expect(play([[600, 100], [150, 100]]).events).toHaveLength(0);
    expect(play([[150, 100], [600, 100]]).events).toHaveLength(0);
  });

  it('ignores winks: one eye closed is not a blink', () => {
    const detector = new DoubleBlinkDetector();
    const events = [];
    let t = 0;
    for (; t < 600; t += FRAME) events.push(detector.update(sample(t, 0.05), 4));
    for (const closed of [true, false, true, false]) {
      for (const end = t + 150; t < end; t += FRAME) events.push(detector.update(sample(t, closed ? 0.9 : 0.05, 0.05), 4));
    }
    expect(events.filter((e) => e !== null)).toHaveLength(0);
  });

  it('keeps the steady target when the aim jumps as the lids start to close', () => {
    const { events } = play([[150, 150], [150, 100]], { aimAt: (t) => (t >= 560 ? 5 : 4) });
    expect(events[0]!.target).toBe(4);
  });

  it('does not fall back to an old target when the user had just moved to a new one', () => {
    // Moved from 4 to 5 about 0.15 s before blinking: too late to be steady, too early to be the lids.
    expect(play([[150, 150], [150, 100]], { aimAt: (t) => (t >= 450 ? 5 : 4) }).events.map((e) => e.target)).toEqual([null]);
  });

  it('reports a double blink with no target when nothing was aimed steadily before it', () => {
    // Nothing is clicked unless a target was picked another way, such as by voice.
    expect(play([[150, 150], [150, 100]], { aimAt: (t) => Math.floor(t / FRAME) % 3 }).events.map((e) => e.target)).toEqual([null]);
    expect(play([[150, 150], [150, 100]], { aimAt: () => null }).events.map((e) => e.target)).toEqual([null]);
  });

  it('needs two fresh blinks for each click', () => {
    const { events } = play([[150, 150], [150, 150], [150, 600]]); // a third blink right after a click
    expect(events).toHaveLength(1);
  });

  it('times each blink from the last open sample, since the camera holds back the start of a blink', () => {
    const detector = new DoubleBlinkDetector();
    const events = [];
    let t = 0;
    for (; t <= 600; t += FRAME) events.push(detector.update(sample(t, 0.05), 4));
    // The first blink's opening frames never arrive closed; it shows as one closed sample 300 ms later.
    events.push(detector.update(sample(t + 300, 0.9), 4));
    events.push(detector.update(sample(t + 333, 0.05), 4)); // that blink lasted about 0.33 s: quick
    events.push(detector.update(sample(t + 400, 0.9), 4));
    events.push(detector.update(sample(t + 500, 0.05), 4));
    expect(events.filter((e) => e !== null)).toHaveLength(1);
  });

  it('reports the locked target while a pair is in progress, and forgets it on reset', () => {
    const detector = new DoubleBlinkDetector();
    for (let t = 0; t < 600; t += FRAME) detector.update(sample(t, 0.05), 4);
    detector.update(sample(633, 0.9), 4);
    expect(detector.locked).toBe(4);
    detector.reset();
    expect(detector.locked).toBeNull();
  });
});
