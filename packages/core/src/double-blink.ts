import type { GazeSample } from '@iris/protocol';
import type { ConfirmEvent } from './confirm';

export interface DoubleBlinkOptions {
  /** Longest closure that counts as one of the two quick blinks, in milliseconds. */
  blinkMaxMs?: number;
  /** Most time from the first blink's closing to the second blink's opening, in milliseconds. */
  windowMs?: number;
  /** How long the aim must have held still before the first blink for its target to be locked. */
  steadyMs?: number;
}

const CLOSED = 0.5; // both eyes' closure scores above this count as closed
const OPEN = 0.35; // and both below this as open again; the gap stops a half-closed flicker from counting twice
const LID_JUMP_MS = 120; // an aim change this close to a blink is the closing lids, not the user moving on

type Segment = { aim: number | null; since: number };

/**
 * Double blink: a click the moment the eyes open after two quick blinks of both eyes. The target
 * is locked as the first blink starts, from the aim that had held still for `steadyMs` just
 * before: a change in the last moments is the closing lids distorting the iris reading, so the
 * earlier aim wins, and nothing after that moment can redirect the click. A single blink, a wink
 * (one eye), a closure longer than a quick blink, blinks too far apart, or no steady aim before
 * the first blink never clicks. Each click needs two fresh blinks.
 *
 * The camera holds back the start of every blink, so each closure is timed from the last open
 * sample, not the first closed one.
 */
export class DoubleBlinkDetector {
  private readonly blinkMaxMs: number;
  private readonly windowMs: number;
  private readonly steadyMs: number;
  private lastOpen: number | null = null;
  private held: Segment | null = null;
  private before: (Segment & { until: number }) | null = null;
  /** The closure in progress. */
  private closed: { since: number; target: number | null } | null = null;
  /** The first of two blinks, once it has ended. */
  private first: { since: number; target: number | null } | null = null;

  constructor({ blinkMaxMs = 400, windowMs = 800, steadyMs = 200 }: DoubleBlinkOptions = {}) {
    this.blinkMaxMs = blinkMaxMs;
    this.windowMs = windowMs;
    this.steadyMs = steadyMs;
  }

  /** The target locked by a double blink in progress, or null. */
  get locked(): number | null {
    return this.first?.target ?? this.closed?.target ?? null;
  }

  /** Feeds one gaze sample and the aim after it; returns a click when the second blink ends. */
  update(sample: GazeSample, aim: number | null): ConfirmEvent | null {
    const { left, right } = sample.blink;
    if (this.first && sample.t - this.first.since > this.windowMs) this.first = null; // too slow for a pair
    if (left > CLOSED && right > CLOSED) {
      if (!this.closed) {
        const since = this.lastOpen ?? sample.t;
        // Only the first blink of a pair locks a target; the second confirms it.
        this.closed = { since, target: this.first ? this.first.target : this.steadyAimBefore(since) };
      }
      return null;
    }
    if (left >= OPEN || right >= OPEN) return null; // half open: neither closed nor open yet
    this.lastOpen = sample.t;
    const blink = this.closed;
    if (!blink) {
      this.track(aim, sample.t);
      return null;
    }
    this.closed = null;
    if (sample.t - blink.since > this.blinkMaxMs) { // a long closure is not one of the quick blinks
      this.first = null;
      return null;
    }
    if (!this.first) {
      this.first = blink;
      return null;
    }
    const { target } = this.first;
    this.first = null;
    return target === null ? null : { t: sample.t, source: 'double-blink', target };
  }

  /** Forgets any blinks in progress, for example when the page's targets change under them. */
  reset(): void {
    this.closed = null;
    this.first = null;
    this.lastOpen = null;
    this.held = null;
    this.before = null;
  }

  private track(aim: number | null, t: number): void {
    if (this.held && this.held.aim === aim) return;
    this.before = this.held ? { ...this.held, until: t } : null;
    this.held = { aim, since: t };
  }

  /**
   * The aim held still for `steadyMs` before the eyes closed. An aim that changed only in the last
   * moments was thrown by the closing lids, so the steady aim before it counts; a change any earlier
   * means the user had just moved on, and with no steady aim there is no target.
   */
  private steadyAimBefore(closedAt: number): number | null {
    if (this.held && closedAt - this.held.since >= this.steadyMs) return this.held.aim;
    const lidJump = this.held && closedAt - this.held.since <= LID_JUMP_MS;
    if (lidJump && this.before && this.before.until - this.before.since >= this.steadyMs) return this.before.aim;
    return null;
  }
}
