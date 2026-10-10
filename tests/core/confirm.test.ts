import { describe, expect, it } from 'vitest';
import { ConfirmChannel, DwellDetector, type ConfirmEvent } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
const open = (t: number): GazeSample => ({ t, eye: { x: 0, y: 0 }, head: HEAD, blink: { left: 0, right: 0 } });
const closed = (t: number): GazeSample => ({ t, eye: null, head: HEAD, blink: { left: 1, right: 1 } });

/** Feeds a sample every 33 ms from `from` to `to` with one aim; returns the confirms. */
function hold(dwell: DwellDetector, aim: number | null, from: number, to: number, sample = open): ConfirmEvent[] {
  const fired: ConfirmEvent[] = [];
  for (let t = from; t < to; t += 33) {
    const event = dwell.update(sample(t), aim);
    if (event) fired.push(event);
  }
  return fired;
}

describe('DwellDetector', () => {
  it('confirms once when one target stays aimed for the dwell time', () => {
    const dwell = new DwellDetector({ dwellMs: 800 });
    const fired = hold(dwell, 3, 0, 3000);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.source).toBe('dwell');
    expect(fired[0]!.t).toBeGreaterThanOrEqual(800);
    expect(fired[0]!.t).toBeLessThan(900);
  });

  it('starts over when the aim moves to another target or to nothing', () => {
    const dwell = new DwellDetector({ dwellMs: 800 });
    expect(hold(dwell, 3, 0, 600)).toHaveLength(0);
    expect(hold(dwell, 4, 600, 1200)).toHaveLength(0); // 600 ms on the neighbor
    expect(hold(dwell, null, 1200, 1300)).toHaveLength(0);
    expect(hold(dwell, 4, 1300, 2000)).toHaveLength(0);
    expect(hold(dwell, 4, 2000, 2200)).toHaveLength(1);
  });

  it('never dwells with the eyes closed, even though the aim holds', () => {
    const dwell = new DwellDetector({ dwellMs: 800 });
    expect(hold(dwell, 3, 0, 600)).toHaveLength(0);
    expect(hold(dwell, 3, 600, 3000, closed)).toHaveLength(0);
    expect(hold(dwell, 3, 3000, 3700)).toHaveLength(0); // the dwell restarted when the eyes opened
    expect(hold(dwell, 3, 3700, 3900)).toHaveLength(1);
  });

  it('confirms the same target again only after the aim has left it', () => {
    const dwell = new DwellDetector({ dwellMs: 800 });
    expect(hold(dwell, 3, 0, 5000)).toHaveLength(1);
    hold(dwell, null, 5000, 5100);
    expect(hold(dwell, 3, 5100, 6000)).toHaveLength(1);
  });

  it('defaults to one second', () => {
    expect(hold(new DwellDetector(), 1, 0, 990)).toHaveLength(0);
    expect(hold(new DwellDetector(), 1, 0, 1100)).toHaveLength(1);
  });
});

describe('ConfirmChannel', () => {
  it('delivers dwell and the stand-in to the same listener as the same kind of event', () => {
    const channel = new ConfirmChannel();
    const received: ConfirmEvent[] = [];
    const stop = channel.onConfirm((event) => received.push(event));
    const dwell = new DwellDetector({ dwellMs: 100 });
    for (const event of hold(dwell, 2, 0, 200)) channel.emit(event);
    channel.emit({ t: 500, source: 'stand-in' });
    expect(received.map((e) => Object.keys(e).sort())).toEqual([['source', 't'], ['source', 't']]);
    expect(received.map((e) => e.source)).toEqual(['dwell', 'stand-in']);
    stop();
    channel.emit({ t: 600, source: 'stand-in' });
    expect(received).toHaveLength(2);
  });
});
