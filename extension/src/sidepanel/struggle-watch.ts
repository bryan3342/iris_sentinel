import { StruggleDetector } from '@iris/core';
import type { Unsubscribe, VitalsSample } from '@iris/protocol';
import type { LinkState } from '../providers/companion/link';

/** The part of the companion link the watch reads. */
export interface StruggleSource {
  onState(listener: (state: LinkState) => void): Unsubscribe;
  onVitals(listener: (sample: VitalsSample) => void): Unsubscribe;
}

/**
 * Watches the companion's live heart rate and breathing for a sudden struggle (see
 * StruggleDetector) and calls `onStruggle` when Iris should offer help. Each new connection is a
 * new measuring session, so the resting level is learned afresh. `talking` says whether a voice
 * conversation is open. Returns a function that stops watching. Readings stay in memory.
 */
export function watchStruggle(source: StruggleSource, talking: () => boolean, onStruggle: () => void): Unsubscribe {
  const detector = new StruggleDetector();
  const stops = [
    source.onState((state) => {
      if (state !== 'connected') detector.reset();
    }),
    source.onVitals((sample) => {
      if (detector.update(sample, talking())) onStruggle();
    }),
  ];
  return () => stops.forEach((stop) => stop());
}
