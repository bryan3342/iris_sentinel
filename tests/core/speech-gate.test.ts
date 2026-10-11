import { describe, expect, it } from 'vitest';
import { SpeechGate } from '@iris/core';

const STEP = 50;
/** Feeds `ms` of readings at `db` every 50 ms from `from`; returns the times the gate opened and where it ended. */
function play(gate: SpeechGate, from: number, ms: number, db: number): { opened: number[]; t: number } {
  const opened: number[] = [];
  let t = from;
  for (; t < from + ms; t += STEP) if (gate.update(db, t)) opened.push(t);
  return { opened, t };
}

describe('SpeechGate', () => {
  it('opens once, about 0.3 s into speech over a quiet room', () => {
    const gate = new SpeechGate();
    const { t } = play(gate, 0, 2000, -70);
    const { opened } = play(gate, t, 1000, -30);
    expect(opened).toEqual([t + 300]);
  });

  it('ignores a short bang, and keeps a run going through gaps between syllables', () => {
    const gate = new SpeechGate();
    let { t } = play(gate, 0, 2000, -70);
    expect(play(gate, t, 150, -20).opened).toEqual([]);
    t = play(gate, t + 150, 1000, -70).t;
    const first = play(gate, t, 200, -30), gap = play(gate, first.t, 100, -70), rest = play(gate, gap.t, 200, -30);
    expect([...first.opened, ...gap.opened, ...rest.opened]).toHaveLength(1);
  });

  it('absorbs steady background noise instead of opening on it', () => {
    const gate = new SpeechGate();
    expect(play(gate, 0, 10_000, -30).opened).toEqual([]);
  });

  it('never opens on sound quieter than the minimum, even in a silent room', () => {
    const gate = new SpeechGate();
    const { t } = play(gate, 0, 2000, -95);
    expect(play(gate, t, 1000, -60).opened).toEqual([]);
  });

  it('opens at most three times a minute, then again once the minute has passed', () => {
    const gate = new SpeechGate();
    let t = play(gate, 0, 2000, -70).t, opens = 0;
    for (let i = 0; i < 5; i++) {
      const speech = play(gate, t, 500, -30);
      opens += speech.opened.length;
      gate.reset();
      t = play(gate, speech.t, 3000, -70).t;
    }
    expect(opens).toBe(3);
    t = play(gate, t, 60_000, -70).t;
    expect(play(gate, t, 500, -30).opened).toHaveLength(1);
  });

  it('calls the room loud once its background reaches -45 dBFS, and quiet again 5 dB below', () => {
    const gate = new SpeechGate();
    let { t } = play(gate, 0, 2000, -70);
    expect(gate.loud).toBe(false);
    t = play(gate, t, 120_000, -40).t;
    expect(gate.loud).toBe(true);
    t = play(gate, t, 2000, -47).t; // still above the quiet-again level
    expect(gate.loud).toBe(true);
    play(gate, t, 5000, -70);
    expect(gate.loud).toBe(false);
  });
});
