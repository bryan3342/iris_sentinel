import { describe, expect, it } from 'vitest';
import { decideSelection, DwellDetector, type ConfirmEvent, type ConfirmSource, type GateTarget, type Selection } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const SAFE: GateTarget = { id: 1, risky: false };
const DELETE: GateTarget = { id: 2, risky: true };
const at = (t: number, source: ConfirmSource): ConfirmEvent => ({ t, source });

describe('decideSelection', () => {
  it('selects a safe target on any confirm', () => {
    for (const source of ['dwell', 'double-blink', 'stand-in'] as const) {
      expect(decideSelection(at(0, source), SAFE)).toEqual({ kind: 'select', target: 1 });
    }
  });

  it('selects a risky target only on a double blink, with no second confirm', () => {
    expect(decideSelection(at(0, 'double-blink'), DELETE)).toEqual({ kind: 'select', target: 2 });
    expect(decideSelection(at(0, 'dwell'), DELETE)).toEqual({ kind: 'needs-double-blink', target: 2 });
    expect(decideSelection(at(0, 'stand-in'), DELETE)).toEqual({ kind: 'needs-double-blink', target: 2 });
  });

  it('selects nothing when the confirm landed on no target', () => {
    expect(decideSelection(at(0, 'double-blink'), null)).toEqual({ kind: 'none' });
  });
});

describe('dwell and selection together', () => {
  const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
  const sample = (t: number): GazeSample => ({ t, eye: { x: 0, y: 0 }, head: HEAD, blink: { left: 0, right: 0 } });

  /** Plays aims at 30 samples a second; returns what every dwell led to. */
  function play(steps: { aim: GateTarget | null; ms: number }[]): Selection[] {
    const dwell = new DwellDetector({ dwellMs: 1000 });
    const selections: Selection[] = [];
    let t = 0;
    for (const step of steps) {
      for (const end = t + step.ms; t < end; t += 33) {
        const event = dwell.update(sample(t), step.aim?.id ?? null);
        if (event) selections.push(decideSelection(event, step.aim));
      }
    }
    return selections;
  }

  it('never selects a risky target by staring at it, however often the user looks back', () => {
    const steps = [{ aim: DELETE, ms: 1200 }, { aim: null, ms: 500 }, { aim: DELETE, ms: 10_000 }];
    expect(play(steps).every((s) => s.kind === 'needs-double-blink')).toBe(true);
  });

  it('selects a safe target with one dwell', () => {
    expect(play([{ aim: SAFE, ms: 1200 }])).toEqual([{ kind: 'select', target: 1 }]);
  });
});
