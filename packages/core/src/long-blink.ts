import type { GazeSample } from '@iris/protocol';
import type { ConfirmEvent } from './confirm';

export interface LongBlinkOptions {
  /** Shortest closure that clicks, in milliseconds. Natural blinks last about 0.1 to 0.4 seconds. */
  minMs?: number;
  /** Longest closure that clicks; longer reads as resting the eyes, never as a click. */
  maxMs?: number;
  /** How long the aim must have held still before the eyes closed for its target to be locked. */
  steadyMs?: number;
}

const CLOSED = 0.5; // both eyes' closure scores above this count as closed
const OPEN = 0.35; // and both below this as open again; the gap stops a half-closed flicker from counting twice

type Segment = { aim: number | null; since: number };

/**
 * Long blink: a click when both eyes close for `minMs` to `maxMs` and open again. The target is
 * locked when the eyes close, from the aim that had held still for `steadyMs` just before: a
 * change in the last moments is the closing lids distorting the iris reading, so the earlier aim
 * wins, and the noisy readings on reopening play no part. The confirm carries that target and
 * fires on reopening, once per closure. An ordinary blink, a wink (one eye), resting the eyes too
 * long, a lost face (which reads as open), or no steady aim before closing never clicks.
 *
 * The camera holds back samples during the start of every blink, so the closure is timed from the
 * last open sample, not the first closed one.
 */
export class LongBlinkDetector {
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly steadyMs: number;
  private lastOpen: number | null = null;
  private held: Segment | null = null;
  private before: (Segment & { until: number }) | null = null;
  private closed: { since: number; target: number | null } | null = null;

  constructor({ minMs = 500, maxMs = 1500, steadyMs = 200 }: LongBlinkOptions = {}) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.steadyMs = steadyMs;
  }

  /** The target locked by a closure in progress, or null. */
  get locked(): number | null {
    return this.closed?.target ?? null;
  }

  /** Feeds one gaze sample and the aim after it; returns a confirm when a long blink ends. */
  update(sample: GazeSample, aim: number | null): ConfirmEvent | null {
    const { left, right } = sample.blink;
    if (left > CLOSED && right > CLOSED) {
      if (!this.closed) {
        const since = this.lastOpen ?? sample.t;
        this.closed = { since, target: this.steadyAimBefore(since) };
      }
      return null;
    }
    if (left >= OPEN || right >= OPEN) return null; // half open: neither closed nor open yet
    this.lastOpen = sample.t;
    const closure = this.closed;
    if (!closure) {
      this.track(aim, sample.t);
      return null;
    }
    this.closed = null;
    this.held = { aim, since: sample.t };
    this.before = null;
    const length = sample.t - closure.since;
    if (length < this.minMs || length > this.maxMs || closure.target === null) return null;
    return { t: sample.t, source: 'long-blink', target: closure.target };
  }

  /** Forgets any closure in progress, for example when the page's targets change under it. */
  reset(): void {
    this.closed = null;
  }

  private track(aim: number | null, t: number): void {
    if (this.held && this.held.aim === aim) return;
    this.before = this.held ? { ...this.held, until: t } : null;
    this.held = { aim, since: t };
  }

  private steadyAimBefore(closedAt: number): number | null {
    if (this.held && closedAt - this.held.since >= this.steadyMs) return this.held.aim;
    if (this.before && this.before.until - this.before.since >= this.steadyMs) return this.before.aim;
    return null;
  }
}
