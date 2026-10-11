/**
 * Decides, from microphone loudness alone, that the user has started speaking, so the voice agent
 * connects only when spoken to. It hears levels, never words, and nothing leaves the laptop. The
 * room's background level is learned as it goes: it follows quiet quickly and rises only slowly, so
 * speech does not raise it but a fan or TV that keeps running is absorbed within a minute. Sound
 * must stay well above that background for a moment, so a cough, a bang or a door never opens it,
 * and starts are capped so a noisy room cannot keep connecting.
 */

export interface SpeechGateOptions {
  /** How far above the background, in dB, counts as speech. */
  marginDb?: number;
  /** The quietest level, in dBFS, that can count as speech, whatever the background. */
  minDb?: number;
  /** How long sound must stay loud before it counts, in milliseconds. */
  onsetMs?: number;
  /** A dip shorter than this, in milliseconds, does not break the run (gaps between syllables). */
  gapMs?: number;
  /** At most this many starts per window. */
  maxStarts?: number;
  windowMs?: number;
}

const DEFAULTS: Required<SpeechGateOptions> = { marginDb: 15, minDb: -50, onsetMs: 300, gapMs: 150, maxStarts: 3, windowMs: 60_000 };
// Time constants, in milliseconds, for the background level falling, rising in quiet and rising while loud.
const FALL_MS = 500, RISE_MS = 5_000, RISE_LOUD_MS = 20_000;

export class SpeechGate {
  private readonly o: Required<SpeechGateOptions>;
  private floor: number | null = null;
  private last: number | null = null;
  private since: number | null = null;
  private opened = false; // this run already opened the gate
  private lastLoud = -Infinity;
  private starts: number[] = [];

  constructor(options: SpeechGateOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** Takes one loudness reading (dBFS) at time `t` (ms); true once when speech has started. */
  update(db: number, t: number): boolean {
    if (!Number.isFinite(db)) return false;
    this.floor ??= db;
    const dt = this.last === null ? 0 : Math.max(0, t - this.last);
    this.last = t;
    const loud = db >= Math.max(this.o.minDb, this.floor + this.o.marginDb);
    const tau = db < this.floor ? FALL_MS : loud ? RISE_LOUD_MS : RISE_MS;
    this.floor += (db - this.floor) * (1 - Math.exp(-dt / tau));
    if (!loud) {
      if (t - this.lastLoud > this.o.gapMs) { this.since = null; this.opened = false; }
      return false;
    }
    this.lastLoud = t;
    this.since ??= t;
    if (this.opened || t - this.since < this.o.onsetMs) return false;
    this.opened = true; // one open per run, however long it lasts
    this.starts = this.starts.filter((s) => t - s < this.o.windowMs);
    if (this.starts.length >= this.o.maxStarts) return false;
    this.starts.push(t);
    return true;
  }

  /** Forgets a run in progress (when listening resumes), keeping the background and the start count. */
  reset(): void {
    this.since = null;
    this.opened = false;
    this.last = null;
    this.lastLoud = -Infinity;
  }
}
