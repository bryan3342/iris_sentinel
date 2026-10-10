import { BLINK_LIMIT_MS } from '@iris/protocol';
import { microseconds, type PresageDetection } from '../presage/map';

// Turns Presage's per-frame "eyes closing" flag into one event per blink, for
// the blink rate behind the fatigue score. A blink runs from the first frame
// flagged closed to the first frame flagged open again. Packets can repeat
// frames and split a blink across two packets, so frames are ordered and
// de-duplicated by timestamp, and an unfinished blink carries over.

/**
 * Closures shorter than this are flicker, not blinks: on the demo laptop real
 * blinks lasted 133 to 233 ms, while 33 to 67 ms flags came from noise such as a
 * second face in view.
 */
export const MIN_BLINK_MS = 100;

export class BlinkSegmenter {
  /** The newest frame seen, in microseconds; anything at or before it is a repeat. */
  private lastFrameUs = Number.NEGATIVE_INFINITY;
  /** When the current closure began, in microseconds, or null while the eyes are open. */
  private closedSinceUs: number | null = null;

  /** Adds a packet's frames and returns the length, in milliseconds, of each blink that ended in it. */
  add(frames: PresageDetection[] | null | undefined): number[] {
    const fresh = (frames ?? [])
      // A frame without a timestamp cannot be ordered, so it is skipped.
      .filter((frame) => frame.timestamp !== null && frame.timestamp !== undefined)
      .map((frame) => ({ at: microseconds(frame.timestamp), closed: frame.detected === true }))
      .filter((frame) => frame.at > this.lastFrameUs)
      .sort((a, b) => a.at - b.at);
    const blinks: number[] = [];
    for (const frame of fresh) {
      this.lastFrameUs = frame.at;
      if (frame.closed) {
        this.closedSinceUs ??= frame.at;
      } else if (this.closedSinceUs !== null) {
        const durationMs = (frame.at - this.closedSinceUs) / 1000;
        this.closedSinceUs = null;
        if (durationMs >= MIN_BLINK_MS && durationMs <= BLINK_LIMIT_MS) blinks.push(durationMs);
      }
    }
    return blinks;
  }
}
