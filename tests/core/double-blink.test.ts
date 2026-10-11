import { describe, expect, it } from 'vitest';
import { DoubleBlinkDetector, type ConfirmEvent } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const FRAME = 33;
// During a quick blink the camera holds the last eye reading, so the eye stays set; only the lids move.
const sample = (t: number, left: number, right = left): GazeSample => ({ t, eye: { x: 0, y: 0 }, head: HEAD, blink: { left, right } });

/** Open eyes aimed per `aimAt(t)` until 600 ms, then each blink in `blinks` as [closed ms, open ms after], then open eyes. */
function play(blinks: [number, number][], { aimAt = (_t: number): number | null => 4, detector = new DoubleBlinkDetector(), rest = 0.05 } = {}) {
  const events: ConfirmEvent[] = [];
  const push = (e: ConfirmEvent | null) => { if (e) events.push(e); };
  let t = 0;
  for (; t < 600; t += FRAME) push(detector.update(sample(t, rest), aimAt(t)));
  for (const [closed, open] of blinks) {
    const end = t + closed;
    for (; t < end; t += FRAME) push(detector.update(sample(t, 0.9), aimAt(t)));
    const reopen = t + open;
    for (; t < reopen; t += FRAME) push(detector.update(sample(t, rest), aimAt(t)));
  }
  return { events, detector };
}

/** Open eyes at `rest` for 600 ms, then one frame per [left, right] closure in `frames`, then open eyes for 600 ms. */
function feed(frames: [number, number][], rest: [number, number] = [0.2, 0.12]) {
  const detector = new DoubleBlinkDetector();
  const events: ConfirmEvent[] = [];
  let t = 0;
  const push = ([left, right]: [number, number]) => {
    const event = detector.update(sample(t, left, right), 4);
    if (event) events.push(event);
    t += FRAME;
  };
  while (t < 600) push(rest);
  frames.forEach(push);
  for (const end = t + 600; t < end;) push(rest);
  return events;
}

describe('DoubleBlinkDetector', () => {
  it('clicks the moment the eyes open after two quick blinks, on the target aimed before them', () => {
    const { events } = play([[150, 150], [150, 100]]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'double-blink', target: 4 });
  });

  it('ignores a single blink, and two blinks too far apart', () => {
    expect(play([[150, 500]]).events).toHaveLength(0);
    expect(play([[150, 1300], [150, 100]]).events).toHaveLength(0);
  });

  it('clicks on a deliberate double blink, slower than natural blinks', () => {
    expect(play([[350, 300], [350, 100]]).events.map((e) => e.target)).toEqual([4]);
  });

  it('clicks when the lids lift only part way between the two blinks', () => {
    // The shape of a quick deliberate double blink: between the blinks the closure falls from about 0.8 to 0.5, not to rest.
    const pair = feed([[0.78, 0.69], [0.82, 0.72], [0.8, 0.68], [0.6, 0.43], [0.53, 0.38], [0.76, 0.64], [0.81, 0.69], [0.65, 0.49], [0.5, 0.31], [0.31, 0.17]]);
    expect(pair.map((e) => e.target)).toEqual([4]);
  });

  it('keeps one blink whole when its lids waver on the way open', () => {
    expect(feed([[0.8, 0.7], [0.82, 0.72], [0.62, 0.45], [0.66, 0.52], [0.45, 0.3], [0.3, 0.18]])).toHaveLength(0);
  });

  it('never clicks from lids fluttering while the eyes rest closed', () => {
    const resting = Array.from({ length: 30 }, (): [number, number] => [0.85, 0.75]); // a second with the eyes closed
    const flutter: [number, number][] = [[0.55, 0.42], [0.85, 0.75], [0.85, 0.75], [0.85, 0.75]];
    expect(feed([...resting, ...flutter, ...flutter, ...flutter])).toHaveLength(0);
  });

  it('judges open and closed against heavy resting lids, as when looking down at a laptop screen', () => {
    expect(play([[150, 150], [150, 100]], { rest: 0.45 }).events.map((e) => e.target)).toEqual([4]);
    // A lid dipping from that rest to 0.6 is not closed.
    const detector = new DoubleBlinkDetector();
    let events = 0;
    for (let t = 0; t < 3000; t += FRAME) if (detector.update(sample(t, t % 400 < 100 ? 0.6 : 0.45), 4)) events++;
    expect(events).toBe(0);
  });

  it('ignores a closure longer than a quick blink, even as part of a pair', () => {
    expect(play([[900, 100], [150, 100]]).events).toHaveLength(0);
    expect(play([[150, 100], [900, 100]]).events).toHaveLength(0);
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
