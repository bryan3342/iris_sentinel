import { describe, expect, it } from 'vitest';
import { FatigueEngine, type FatigueState } from '@iris/core';
import type { FatigueLevel, Quality, Reading } from '@iris/protocol';

const steady = (value: number): Reading => ({ value, confidence: 0.9, stable: true });

/**
 * Plays a simulated user to the engine, one second at a time, from `from`
 * (inclusive) to `to` (exclusive). `tiredness(t)` runs from 0 (rested: 15
 * blinks a minute, heart rate variability 45 ms, 14 breaths a minute) to 1
 * (tired: 27 blinks, 25 ms, 19.5 breaths). Returns the state after each second.
 */
function play(engine: FatigueEngine, from: number, to: number, tiredness: (t: number) => number, reading = steady): FatigueState[] {
  const states: FatigueState[] = [];
  let nextBlink = from;
  for (let t = from; t < to; t += 1_000) {
    const x = tiredness(t);
    while (nextBlink <= t) {
      engine.addBlink({ t: nextBlink, durationMs: 150 });
      nextBlink += 60_000 / (15 + 12 * x);
    }
    engine.addVitals({ t, pulse: null, hrv: reading(45 - 20 * x), breathing: reading(14 + 5.5 * x) });
    states.push(engine.update(t));
  }
  return states;
}

const rested = () => 0;
const tired = () => 1;
const view = (engine: FatigueEngine, t: number, quality: Quality) => engine.setQuality({ t, quality, hint: '' });
const levelsIn = (states: FatigueState[]): FatigueLevel[] => states.map((s) => s.level).filter((l, i, all) => l !== all[i - 1]);

/** An engine that has watched two rested minutes, so every body clue has its personal baseline. */
function warmedUp(): FatigueEngine {
  const engine = new FatigueEngine();
  view(engine, 0, 'ok');
  play(engine, 0, 120_000, rested);
  return engine;
}

describe('FatigueEngine', () => {
  it('stays fresh for a rested user and learns their own baselines', () => {
    const engine = new FatigueEngine();
    view(engine, 0, 'ok');
    const states = play(engine, 0, 300_000, rested);
    const last = states.at(-1)!;
    expect(levelsIn(states)).toEqual(['fresh']);
    expect(last.paused).toBeNull();
    expect(last.score).toBeLessThan(10);
    expect(last.clues.hrv).toMatchObject({ personal: true, baseline: 45 });
    expect(last.clues.breathing.personal).toBe(true);
    expect(last.clues.blink.personal).toBe(true);
  });

  it('waits until enough clues are trustworthy', () => {
    const engine = new FatigueEngine();
    view(engine, 0, 'ok');
    const states = play(engine, 0, 30_000, rested);
    expect(states[0]!.paused).toBe('warming-up');
    expect(states[0]!.score).toBeNull();
    expect(states.at(-1)!.paused).toBeNull(); // heart rate variability and breathing are in after 10 readings
  });

  it('climbs one level at a time to strained as the user tires', () => {
    const engine = warmedUp();
    const ramp = (t: number) => Math.min((t - 120_000) / 60_000, 1); // tired over one minute
    const states = play(engine, 120_000, 420_000, ramp);
    expect(levelsIn(states)).toEqual(['fresh', 'tiring', 'fatigued', 'strained']);
    expect(states.at(-1)!.score).toBeGreaterThan(90);
    expect(states.at(-1)!.clues.hrv.strain).toBe(1);
  });

  it('pauses and holds the score and level once the face has been lost for 3 seconds', () => {
    const engine = warmedUp();
    play(engine, 120_000, 240_000, () => 0.6);
    view(engine, 240_000, 'no-face');
    const lost = play(engine, 240_000, 360_000, tired);
    expect(lost.slice(0, 3).every((s) => s.paused === null)).toBe(true); // 240 to 242 s: still within the grace
    const held = lost[3]!;
    expect(held.paused).toBe('no-face');
    expect(lost.slice(3).every((s) => s.paused === 'no-face' && s.level === held.level && s.score === held.score)).toBe(true);
    expect(lost.at(-1)!.clues.hrv.value).toBeNull();
  });

  it('does not pause or lose readings over a brief camera glitch', () => {
    const engine = warmedUp();
    view(engine, 120_000, 'motion');
    view(engine, 121_500, 'ok');
    const states = play(engine, 120_000, 130_000, rested);
    expect(states.every((s) => s.paused === null)).toBe(true);
    expect(states.every((s) => s.clues.hrv.value !== null && s.clues.blink.value !== null)).toBe(true);
  });

  it('pauses for a poor view too', () => {
    const engine = warmedUp();
    view(engine, 120_000, 'too-dark');
    expect(play(engine, 120_000, 130_000, rested).at(-1)!.paused).toBe('poor-view');
  });

  it('ignores readings that are not stable yet', () => {
    const engine = new FatigueEngine();
    view(engine, 0, 'ok');
    const states = play(engine, 0, 120_000, rested, (value) => ({ value, confidence: 0.9, stable: false }));
    expect(states.at(-1)!.clues.hrv.value).toBeNull();
    expect(states.at(-1)!.paused).toBe('warming-up'); // blink rate alone is too little of the weight
  });

  it('drops only breathing while the chest is out of view', () => {
    const engine = warmedUp();
    view(engine, 120_000, 'chest-not-visible');
    const last = play(engine, 120_000, 180_000, rested).at(-1)!;
    expect(last.clues.breathing.value).toBeNull();
    expect(last.clues.hrv.value).toBe(45);
    expect(last.paused).toBeNull();
  });

  it('keeps a double-blink confirm out of the blink rate', () => {
    const engine = warmedUp();
    const before = play(engine, 120_000, 180_000, rested).at(-1)!.clues.blink.value!;
    // Each blink in the next minute comes with a double-blink confirm.
    for (let t = 180_000; t < 240_000; t += 4_000) engine.addConfirm({ t, source: 'double-blink' });
    const after = play(engine, 180_000, 240_000, rested).at(-1)!.clues.blink.value!;
    expect(after).toBeLessThan(before / 2);
  });

  it('adds click clues once they have a baseline of their own', () => {
    const engine = warmedUp();
    for (const [i, target] of [1, 2, 3].entries()) {
      engine.addAim(120_000 + i * 5_000, target);
      engine.addClick(121_000 + i * 5_000, 1_000);
    }
    const first = play(engine, 135_000, 136_000, rested)[0]!.clues;
    expect(first.timeToClick).toMatchObject({ value: 1_000, baseline: null, strain: null }); // no typical value to fall back on
    const later = play(engine, 136_000, 196_000, rested).at(-1)!.clues;
    expect(later.timeToClick).toMatchObject({ value: 1_000, personal: true, strain: 0 });
    expect(later.landings).toMatchObject({ value: 1, personal: true, strain: 0 });
  });

  it('forgets everything on reset', () => {
    const engine = warmedUp();
    engine.reset();
    const state = engine.update(130_000);
    expect(state).toMatchObject({ score: null, level: 'fresh', paused: 'warming-up' });
    expect(state.clues.hrv.personal).toBe(false);
  });
});
