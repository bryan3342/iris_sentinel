import { describe, expect, it } from 'vitest';
import { BlinkRateMeter } from '@iris/core';
import type { QualityStatus } from '@iris/protocol';

const ok = (t: number): QualityStatus => ({ t, quality: 'ok', hint: '' });
const lost = (t: number): QualityStatus => ({ t, quality: 'no-face', hint: '' });

/** Adds one natural blink every `everyMs`, after `from` and up to `to`. */
function blinkEvery(meter: BlinkRateMeter, everyMs: number, from: number, to: number): void {
  for (let t = from + everyMs; t <= to; t += everyMs) meter.addBlink({ t, durationMs: 150 });
}

/** A meter with the view `ok` from time 0 and a blink every 4 s (15 a minute) for two minutes. */
function steady(): BlinkRateMeter {
  const meter = new BlinkRateMeter();
  meter.setQuality(ok(0));
  blinkEvery(meter, 4_000, 0, 120_000);
  return meter;
}

describe('BlinkRateMeter', () => {
  it('reads 15 blinks a minute from a blink every 4 seconds', () => {
    expect(steady().rate(120_000)).toBe(15);
  });

  it('reports nothing until the view has been ok for 30 seconds', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality(ok(0));
    blinkEvery(meter, 4_000, 0, 30_000);
    expect(meter.rate(29_999)).toBeNull();
    expect(meter.rate(30_000)).toBe(14); // 7 blinks in half a minute
  });

  it('reports nothing before any ok view arrives', () => {
    const meter = new BlinkRateMeter();
    blinkEvery(meter, 4_000, 0, 120_000);
    expect(meter.rate(120_000)).toBeNull();
  });

  it('drops a blink 1 second after a double-blink confirm, so confirming is not read as tiredness', () => {
    const meter = steady();
    meter.addConfirm({ t: 99_000, source: 'double-blink' }); // the blink at 100 s is that confirm
    expect(meter.rate(120_000)).toBe(14);
  });

  it('keeps blinks near a dwell confirm, and blinks well clear of a double-blink confirm', () => {
    const dwell = steady();
    dwell.addConfirm({ t: 99_000, source: 'dwell' });
    expect(dwell.rate(120_000)).toBe(15);

    const clear = steady();
    clear.addConfirm({ t: 97_000, source: 'double-blink' }); // blinks at 96 s and 100 s are 1 s before and 3 s after
    expect(clear.rate(120_000)).toBe(15);
  });

  it('counts only the time the face was in view, so losing it leaves a gap rather than a restart', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality(ok(0));
    blinkEvery(meter, 4_000, 0, 50_000); // 12 blinks
    meter.setQuality(lost(50_000));
    expect(meter.rate(50_000)).toBeCloseTo(14.4); // 12 blinks in 50 s of view

    blinkEvery(meter, 4_000, 50_000, 60_000); // seen through a poor view: ignored
    meter.setQuality(ok(60_000));
    blinkEvery(meter, 4_000, 60_000, 90_000);
    expect(meter.rate(90_000)).toBeCloseTo(14.4); // 12 blinks in the 50 s of view between 30 s and 90 s
    blinkEvery(meter, 4_000, 88_000, 120_000); // carries on every 4 s
    expect(meter.rate(120_000)).toBe(15);
  });

  it('shrugs off a brief camera glitch', () => {
    const meter = steady();
    meter.setQuality({ t: 61_000, quality: 'motion', hint: '' });
    meter.setQuality(ok(62_000));
    expect(meter.rate(120_000)).toBeCloseTo(15.25, 2); // 15 blinks in 59 s of view
  });

  it('leaves out the time the user talks, as it does a lost face', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality(ok(0));
    blinkEvery(meter, 4_000, 0, 50_000); // 12 blinks
    meter.setTalking(50_000, true);
    blinkEvery(meter, 2_000, 50_000, 60_000); // blinking more while talking: ignored
    meter.setTalking(60_000, false);
    blinkEvery(meter, 4_000, 60_000, 90_000);
    expect(meter.rate(90_000)).toBeCloseTo(14.4); // 12 blinks in the 50 s counted between 30 s and 90 s
  });

  it('counts again only once the user has stopped talking and the face is back in view', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality(ok(0));
    meter.setTalking(10_000, true);
    blinkEvery(meter, 4_000, 10_000, 20_000);
    meter.setQuality(lost(20_000));
    blinkEvery(meter, 4_000, 20_000, 30_000);
    meter.setTalking(30_000, false); // the face is still out of view
    blinkEvery(meter, 4_000, 30_000, 40_000);
    meter.setQuality(ok(40_000));
    blinkEvery(meter, 4_000, 40_000, 70_000); // 7 blinks
    expect(meter.rate(70_000)).toBe(14); // only the 30 s since 40 s counted
  });

  it('still counts blinks while only the chest is out of view', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality({ t: 0, quality: 'chest-not-visible', hint: '' });
    blinkEvery(meter, 4_000, 0, 120_000);
    expect(meter.rate(120_000)).toBe(15);
  });

  it('falls as blinks stop', () => {
    const meter = new BlinkRateMeter();
    meter.setQuality(ok(0));
    blinkEvery(meter, 4_000, 0, 60_000);
    expect(meter.rate(90_000)).toBe(8); // only the blinks from 32 s to 60 s are still in the window
    expect(meter.rate(121_000)).toBe(0);
  });

  it('forgets everything on reset', () => {
    const meter = steady();
    meter.reset();
    expect(meter.rate(120_000)).toBeNull();
  });
});
