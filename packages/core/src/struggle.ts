import type { Reading, VitalsSample } from '@iris/protocol';

/**
 * Notices a sudden sign of struggle in the body signals: heart rate or breathing well above the
 * user's own resting level, and held there for a while. It learns the resting level from the first
 * minute of trusted readings of each measuring session, counts only readings Presage trusts, starts
 * over when readings pause (the face left the camera), sets everything aside while the user talks
 * and shortly after (talking raises both), and speaks up at most once every ten minutes. It never
 * diagnoses: it only says when Iris should offer help. Readings stay in memory.
 */

export type StruggleSignal = 'pulse' | 'breathing';
const SIGNALS: StruggleSignal[] = ['pulse', 'breathing'];

export interface StruggleOptions {
  /** How long trusted readings are gathered for the resting level, from the first one, in milliseconds. */
  learnMs?: number;
  /** How far above the resting level counts, as a fraction, per signal. */
  rise?: Record<StruggleSignal, number>;
  /** How long the rise must hold, in milliseconds. */
  holdMs?: number;
  /** Least time between two offers of help, in milliseconds. */
  cooldownMs?: number;
  /** Quiet needed after the user talks, in milliseconds. */
  afterTalkMs?: number;
  /** A gap in trusted readings longer than this starts the hold over, in milliseconds. */
  gapMs?: number;
}

const DEFAULTS: Required<StruggleOptions> = {
  learnMs: 60_000,
  rise: { pulse: 0.2, breathing: 0.3 },
  holdMs: 20_000,
  cooldownMs: 10 * 60_000,
  afterTalkMs: 30_000,
  gapMs: 5_000,
};

/** Fewest trusted readings the resting level is learned from, however long that takes. */
const MIN_LEARNED = 10;

interface Track {
  /** When the first trusted reading of the session arrived. */
  first: number | null;
  learned: number[];
  baseline: number | null;
  lastSeen: number | null;
  /** Since when trusted readings have stayed above the bar. */
  aboveSince: number | null;
}

const newTrack = (): Track => ({ first: null, learned: [], baseline: null, lastSeen: null, aboveSince: null });

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export class StruggleDetector {
  private readonly o: Required<StruggleOptions>;
  private tracks: Record<StruggleSignal, Track> = { pulse: newTrack(), breathing: newTrack() };
  private lastTalk = -Infinity;
  private lastOffer = -Infinity;

  constructor(options: StruggleOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** A new measuring session: the resting level is learned again. The ten minutes between offers carry over. */
  reset(): void {
    this.tracks = { pulse: newTrack(), breathing: newTrack() };
    this.lastTalk = -Infinity;
  }

  /** Feeds one sample (`talking`: a voice conversation is open); true when Iris should offer help now. */
  update(sample: VitalsSample, talking: boolean): boolean {
    if (talking) this.lastTalk = sample.t;
    if (sample.t - this.lastTalk < this.o.afterTalkMs) {
      for (const signal of SIGNALS) this.tracks[signal].aboveSince = null;
      return false;
    }
    let struggling = false;
    for (const signal of SIGNALS) if (this.step(signal, sample.t, sample[signal])) struggling = true;
    if (!struggling || sample.t - this.lastOffer < this.o.cooldownMs) return false;
    this.lastOffer = sample.t;
    for (const signal of SIGNALS) this.tracks[signal].aboveSince = null;
    return true;
  }

  /** Updates one signal; true when it has held above its bar long enough. */
  private step(signal: StruggleSignal, t: number, reading: Reading | null): boolean {
    const track = this.tracks[signal];
    const paused = track.lastSeen !== null && t - track.lastSeen > this.o.gapMs;
    if (!reading?.stable) {
      if (paused) track.aboveSince = null;
      return false;
    }
    if (paused) track.aboveSince = null;
    track.lastSeen = t;
    if (track.baseline === null) {
      track.first ??= t;
      if (t - track.first < this.o.learnMs || track.learned.length < MIN_LEARNED) {
        track.learned.push(reading.value);
        return false;
      }
      track.baseline = median(track.learned);
    }
    if (reading.value > track.baseline * (1 + this.o.rise[signal])) track.aboveSince ??= t;
    else track.aboveSince = null;
    return track.aboveSince !== null && t - track.aboveSince >= this.o.holdMs;
  }
}
