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

// Each eye's closure score must rise this far above its own resting level to count as closed, and
// fall back to within this of it to count as open again; the gap stops a half-closed flicker from
// counting twice. Resting levels differ between people, between the two eyes and with where they
// look, and lids that rest heavy would never read as open against fixed limits.
const CLOSED_ABOVE_REST = 0.2;
const OPEN_ABOVE_REST = 0.12;
const MIN_CLOSED = 0.5; // never easier to close than this, or to open than MIN_OPEN, whatever the rest
const MIN_OPEN = 0.35;
const MAX_CLOSED = 0.85; // and a heavy-lidded rest never puts closed out of reach
const REST_MS = 2_000; // how quickly the resting level follows the lids (time constant)
const LID_JUMP_MS = 120; // an aim change this close to a blink is the closing lids, not the user moving on
// Blinking twice quickly, people often lift the lids only part way between the two blinks: the
// closure (both eyes' mean) falls from about 0.8 to 0.4 or 0.6 and rises again. A blink therefore
// also ends when the closure falls this far below its peak with at least one eye no longer closed,
// and the next starts once both eyes are closed again and the closure has risen this far from its
// lowest point since. The closed plateau of a single blink wavers by well under either amount.
const REOPEN_DROP = 0.15;
const RECLOSE_RISE = 0.12;

type Segment = { aim: number | null; since: number };
/** One closure: when it began, the target it carries, its highest closure so far, and whether it began from open eyes. */
type Closure = { since: number; target: number | null; peak: number; fresh: boolean };

/**
 * Double blink: a click the moment the eyes open after two quick blinks of both eyes. The target
 * is locked as the first blink starts, from the aim that had held still for `steadyMs` just
 * before: a change in the last moments is the closing lids distorting the iris reading, so the
 * earlier aim wins, and nothing after that moment can redirect the click. With no steady aim
 * before the first blink the confirm carries a null target: nothing is clicked unless a target was
 * picked another way (by voice). A single blink, a wink (one eye), a closure longer than a quick
 * blink, or blinks too far apart is no double blink at all. Each click needs two fresh blinks.
 *
 * The defaults fit deliberate blinks, which are slower than natural ones: each closure up to 0.6 s,
 * and the pair within 1.3 s of the first closing. Closed and open are judged against each eye's own
 * resting level (see CLOSED_ABOVE_REST). Between the two blinks the lids need only lift part way
 * (see REOPEN_DROP), but the first blink must start from open eyes, so lids fluttering while the eyes
 * rest closed never click. The camera holds back the start of every blink, so each closure is timed
 * from the last open sample, not the first closed one.
 */
export class DoubleBlinkDetector {
  private readonly blinkMaxMs: number;
  private readonly windowMs: number;
  private readonly steadyMs: number;
  private lastOpen: number | null = null;
  private held: Segment | null = null;
  private before: (Segment & { until: number }) | null = null;
  /** The closure in progress. */
  private closed: Closure | null = null;
  /** The first of two blinks, once it has ended. */
  private first: Closure | null = null;
  /** The lowest closure since the last blink ended, which the next blink must rise clearly above. */
  private valley = 0;
  /** Whether the eyes have opened fully since the last blink ended; only then can a new pair begin. */
  private openSinceBlink = true;
  /** Each eye's resting closure, learned while no closure is in progress. */
  private rest = { left: 0.1, right: 0.1 };
  private lastT: number | null = null;

  constructor({ blinkMaxMs = 600, windowMs = 1_300, steadyMs = 200 }: DoubleBlinkOptions = {}) {
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
    const closedAt = (eye: 'left' | 'right') => Math.min(MAX_CLOSED, Math.max(MIN_CLOSED, this.rest[eye] + CLOSED_ABOVE_REST));
    const openAt = (eye: 'left' | 'right') => Math.min(closedAt(eye) - 0.1, Math.max(MIN_OPEN, this.rest[eye] + OPEN_ABOVE_REST));
    const closed = left > closedAt('left') && right > closedAt('right');
    const open = left < openAt('left') && right < openAt('right');
    const level = (left + right) / 2;
    if (!closed && !this.closed) this.learnRest(sample);
    else this.lastT = sample.t;
    if (this.closed) {
      this.closed.peak = Math.max(this.closed.peak, level);
      const lifted = !closed && level <= this.closed.peak - REOPEN_DROP;
      return open || lifted ? this.ended(sample.t, level, open) : null; // otherwise still closed, or barely opening
    }
    this.valley = Math.min(this.valley, level);
    if (closed && level >= this.valley + RECLOSE_RISE) {
      const since = this.lastOpen ?? sample.t;
      // Only the first blink of a pair locks a target; the second confirms it.
      const fresh = this.first !== null || this.openSinceBlink;
      const target = this.first ? this.first.target : fresh ? this.steadyAimBefore(since) : null;
      this.closed = { since, target, peak: level, fresh };
      return null;
    }
    if (!open) return null; // half open: neither closed nor open yet
    this.lastOpen = sample.t;
    this.openSinceBlink = true;
    this.track(aim, sample.t);
    return null;
  }

  /** The closure in progress ended at `t`, the eyes open or lifted part way; returns a click when it was the second quick blink. */
  private ended(t: number, level: number, open: boolean): ConfirmEvent | null {
    const blink = this.closed!;
    this.closed = null;
    this.valley = level;
    this.lastOpen = t; // the next closure is timed from here
    this.openSinceBlink = open;
    // A long closure, or one that began while the eyes were still closed, is not one of the quick blinks.
    if (t - blink.since > this.blinkMaxMs || !blink.fresh) {
      this.first = null;
      return null;
    }
    if (!this.first) {
      this.first = blink;
      return null;
    }
    const { target } = this.first;
    this.first = null;
    return { t, source: 'double-blink', target };
  }

  /** Moves each eye's resting level toward its closure now; the slow pace keeps a blink's edges from moving it much. */
  private learnRest({ t, blink }: GazeSample): void {
    const k = this.lastT === null ? 1 : 1 - Math.exp(-(t - this.lastT) / REST_MS); // the first sample sets it
    this.lastT = t;
    this.rest = { left: this.rest.left + (blink.left - this.rest.left) * k, right: this.rest.right + (blink.right - this.rest.right) * k };
  }

  /** Forgets any blinks in progress, for example when the page's targets change under them. */
  reset(): void {
    this.closed = null;
    this.first = null;
    this.lastOpen = null;
    this.held = null;
    this.before = null;
    this.valley = 0;
    this.openSinceBlink = false; // a new pair starts only once the eyes are seen open again
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
