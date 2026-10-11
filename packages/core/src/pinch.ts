/**
 * Turns the gap between the thumb and index fingertips (in palm lengths, from
 * a PointerProvider) into a click: a pinch. The fingers touching is one click;
 * they must part again, and a short pause must pass, before the next, so a held
 * or trembling pinch never clicks twice. While the fingers come together the aim
 * holds, because pinching pulls the index fingertip toward the thumb and would
 * otherwise drag the click onto a neighbor. Pure, so it is tested directly.
 */

export interface PinchOptions {
  /** Below this gap the fingers touch: a click. */
  closeAt?: number;
  /** Above this gap touching fingers have parted. Higher than closeAt, so a trembling pinch stays one. */
  releaseAt?: number;
  /** Below this gap the fingers are coming together, so the aim holds. */
  holdAt?: number;
  /** Least time between two clicks, in milliseconds. */
  refractoryMs?: number;
}

const DEFAULTS: Required<PinchOptions> = { closeAt: 0.25, releaseAt: 0.35, holdAt: 0.5, refractoryMs: 400 };

export interface PinchState {
  /** The fingers are close or touching: keep the aim where it is. */
  hold: boolean;
  /** The fingers just touched: click. */
  pinch: boolean;
}

export class PinchDetector {
  private readonly o: Required<PinchOptions>;
  private closed = false;
  private lastPinch = -Infinity;

  constructor(options: PinchOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
  }

  /** Feeds one frame's gap (null when no hand is in view) at time `t` in milliseconds. */
  update(gap: number | null, t: number): PinchState {
    if (gap === null) {
      this.closed = false; // the hand left: a pinch in progress is forgotten
      return { hold: false, pinch: false };
    }
    let pinch = false;
    if (!this.closed && gap < this.o.closeAt) {
      this.closed = true;
      if (t - this.lastPinch >= this.o.refractoryMs) {
        pinch = true;
        this.lastPinch = t;
      }
    } else if (this.closed && gap > this.o.releaseAt) {
      this.closed = false;
    }
    return { hold: this.closed || gap < this.o.holdAt, pinch };
  }
}
