import { describe, expect, it } from 'vitest';
import type { VitalsSample } from '@iris/protocol';
import type { LinkState } from '../../extension/src/providers/companion/link';
import { watchStruggle } from '../../extension/src/sidepanel/struggle-watch';

/** Stands in for the companion link: the test plays its connection and its heart rate readings, one a second. */
function companion() {
  const states = new Set<(state: LinkState) => void>();
  const vitals = new Set<(sample: VitalsSample) => void>();
  const link = {
    onState: (listener: (state: LinkState) => void) => (states.add(listener), () => void states.delete(listener)),
    onVitals: (listener: (sample: VitalsSample) => void) => (vitals.add(listener), () => void vitals.delete(listener)),
  };
  const set = (state: LinkState) => states.forEach((listener) => listener(state));
  let now = 0;
  const feed = (from: number, seconds: number, pulse: number) => {
    for (let s = 0; s < seconds; s++) {
      now = from + s * 1000;
      vitals.forEach((listener) => listener({ t: now, pulse: { value: pulse, confidence: 0.9, stable: true }, breathing: null, hrv: null }));
    }
  };
  return { link, set, feed, now: () => now };
}

describe('watchStruggle', () => {
  it('offers help once heart rate holds well above the resting level, learning it afresh for each connection', () => {
    const { link, set, feed, now } = companion();
    const offered: number[] = [];
    const stop = watchStruggle(link, () => false, () => void offered.push(now()));
    set('connected');
    feed(0, 60, 70); // the first minute is the resting level
    feed(60_000, 30, 90); // well above it for 20 seconds
    expect(offered).toEqual([80_000]);

    set('disconnected');
    set('connected');
    feed(700_000, 90, 90); // a new session learns 90 as its resting level, so 90 is no struggle
    expect(offered).toEqual([80_000]);

    stop();
    feed(800_000, 90, 150);
    expect(offered).toEqual([80_000]); // stopped: no longer watching
  });

  it('stays quiet while a conversation is open', () => {
    const { link, set, feed } = companion();
    const offered: number[] = [];
    watchStruggle(link, () => true, () => void offered.push(1));
    set('connected');
    feed(0, 60, 70);
    feed(60_000, 60, 100);
    expect(offered).toEqual([]);
  });
});
