import type { GazeSample } from '@iris/protocol';
import type { ConfirmEvent } from './confirm';

export interface LongBlinkOptions {
  /**
   * Shortest closure that confirms, in milliseconds, counted from the first sample that shows both
   * eyes closed. The camera provider holds back samples during an ordinary blink (under 400 ms),
   * so the first closed sample already comes after that; 300 ms more makes a confirm a deliberate
   * closure of about 0.7 seconds.
   */
  minMs?: number;
  /** Longest closure that still confirms: longer reads as resting the eyes, never as a click. */
  maxMs?: number;
}

const CLOSED = 0.5; // both eyes' closure scores above this count as closed
const OPEN = 0.35; // and both below this as open again; the gap stops a half-closed flicker from counting twice

/**
 * Long blink: a confirm when both eyes close deliberately and open again on the same target. It
 * fires on reopening, once per closure. An ordinary blink, a wink (one eye), resting the eyes too
 * long, or a lost face (which reads as open) never confirms, and neither does a closure during
 * which the aim moved, so the target confirmed is the one the user was looking at.
 */
export class LongBlinkDetector {
  private readonly minMs: number;
  private readonly maxMs: number;
  private closed: { since: number; aim: number | null } | null = null;

  constructor({ minMs = 300, maxMs = 1600 }: LongBlinkOptions = {}) {
    this.minMs = minMs;
    this.maxMs = maxMs;
  }

  /** Feeds one gaze sample and the aim after it; returns a confirm when a long blink ends. */
  update(sample: GazeSample, aim: number | null): ConfirmEvent | null {
    const { left, right } = sample.blink;
    if (left > CLOSED && right > CLOSED) {
      this.closed ??= { since: sample.t, aim };
      return null;
    }
    if (left >= OPEN || right >= OPEN || !this.closed) return null; // still in between, or never closed
    const { since, aim: before } = this.closed;
    this.closed = null;
    const held = sample.t - since;
    if (held < this.minMs || held > this.maxMs || aim === null || aim !== before) return null;
    return { t: sample.t, source: 'long-blink' };
  }

  reset(): void {
    this.closed = null;
  }
}
