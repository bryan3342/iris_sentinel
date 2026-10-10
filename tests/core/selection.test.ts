import { describe, expect, it } from 'vitest';
import { DwellDetector, SelectionGate, type ConfirmEvent, type ConfirmSource, type GateTarget, type Selection } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

const SAFE: GateTarget = { id: 1, risky: false };
const DELETE: GateTarget = { id: 2, risky: true };
const SEND: GateTarget = { id: 3, risky: true };
const at = (t: number, source: ConfirmSource = 'stand-in'): ConfirmEvent => ({ t, source });

describe('SelectionGate', () => {
  it('selects a safe target on the first confirm', () => {
    expect(new SelectionGate().confirm(at(0), SAFE)).toEqual({ kind: 'select', target: 1 });
  });

  it('asks again for a risky target, and selects it on a second confirm within the window', () => {
    const gate = new SelectionGate({ windowMs: 6000 });
    expect(gate.confirm(at(0), DELETE)).toEqual({ kind: 'confirm-again', target: 2 });
    expect(gate.pending(3000)).toBe(2);
    expect(gate.confirm(at(5000), DELETE)).toEqual({ kind: 'select', target: 2 });
    expect(gate.pending(5000)).toBeNull();
  });

  it('asks again from the start once the window has run out', () => {
    const gate = new SelectionGate({ windowMs: 6000 });
    gate.confirm(at(0), DELETE);
    expect(gate.pending(6500)).toBeNull();
    expect(gate.confirm(at(7000), DELETE)).toEqual({ kind: 'confirm-again', target: 2 });
  });

  it('never carries a waiting risky target over to another target', () => {
    const gate = new SelectionGate();
    gate.confirm(at(0), DELETE);
    expect(gate.confirm(at(1000), SEND)).toEqual({ kind: 'confirm-again', target: 3 });
    expect(gate.confirm(at(2000), DELETE)).toEqual({ kind: 'confirm-again', target: 2 });
    expect(gate.confirm(at(3000), SAFE)).toEqual({ kind: 'select', target: 1 });
    expect(gate.confirm(at(4000), DELETE)).toEqual({ kind: 'confirm-again', target: 2 }); // the safe select disarmed it
  });

  it('does nothing for a confirm on no target, and keeps the waiting one', () => {
    const gate = new SelectionGate();
    gate.confirm(at(0), DELETE);
    expect(gate.confirm(at(1000), null)).toEqual({ kind: 'none' });
    expect(gate.confirm(at(2000), DELETE)).toEqual({ kind: 'select', target: 2 });
  });

  it('forgets a waiting target on reset', () => {
    const gate = new SelectionGate();
    gate.confirm(at(0), DELETE);
    gate.reset();
    expect(gate.confirm(at(1000), DELETE).kind).toBe('confirm-again');
  });

  it('gives the same selections whether dwell or the stand-in confirmed', () => {
    const run = (source: ConfirmSource) => {
      const gate = new SelectionGate();
      return [at(0, source), at(1000, source), at(9000, source)].map((event, i): Selection => gate.confirm(event, [DELETE, DELETE, SAFE][i]!));
    };
    expect(run('dwell')).toEqual(run('stand-in'));
  });
});

describe('dwell through the gate', () => {
  const HEAD = { yaw: 0, pitch: 0, eyes: { x: 0.5, y: 0.5 }, eyeSpan: 0.2 };
  const sample = (t: number): GazeSample => ({ t, eye: { x: 0, y: 0 }, head: HEAD, blink: { left: 0, right: 0 } });

  /** Plays aims at 30 samples a second; returns every selection made. */
  function play(steps: { aim: GateTarget | null; ms: number }[]): Selection[] {
    const dwell = new DwellDetector({ dwellMs: 1000 });
    const gate = new SelectionGate();
    const selections: Selection[] = [];
    let t = 0;
    for (const step of steps) {
      for (const end = t + step.ms; t < end; t += 33) {
        const event = dwell.update(sample(t), step.aim?.id ?? null);
        if (event) selections.push(gate.confirm(event, step.aim));
      }
    }
    return selections;
  }

  it('never selects a risky target by staring at it', () => {
    expect(play([{ aim: DELETE, ms: 10_000 }])).toEqual([{ kind: 'confirm-again', target: 2 }]);
  });

  it('selects a risky target after looking away and dwelling on it again', () => {
    expect(play([{ aim: DELETE, ms: 1200 }, { aim: null, ms: 500 }, { aim: DELETE, ms: 1200 }])).toEqual([
      { kind: 'confirm-again', target: 2 },
      { kind: 'select', target: 2 },
    ]);
  });
});
