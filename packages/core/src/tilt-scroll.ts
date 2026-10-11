/**
 * Head-tilt scrolling: tilting the head down past a threshold scrolls down, up scrolls up, and the
 * further the tilt the faster the page moves, up to a maximum. Tilt is measured from the user's
 * own resting head position, which re-centers slowly while they are not tilting on purpose, so a
 * new seat or lid angle settles in instead of scrolling by itself. The pitch is smoothed so quick
 * nods and jitter never scroll, the start threshold sits above the stop threshold so scrolling
 * does not flicker at the edge, and it stops at once when the face is lost or the eyes close.
 */

export interface TiltScrollOptions {
  /** Tilt from rest, in degrees, that starts scrolling. */
  startDeg?: number;
  /** Tilt from rest, in degrees, below which scrolling stops. */
  stopDeg?: number;
  /** Tilt at which scrolling reaches full speed. */
  fullDeg?: number;
  /** Speed at the start threshold and at full tilt, in CSS pixels per second. */
  minSpeed?: number;
  maxSpeed?: number;
  /** How quickly the pitch reading follows the head, in milliseconds (higher is steadier). */
  smoothMs?: number;
  /** How quickly the resting position follows a new posture, in milliseconds. */
  restMs?: number;
}

const DEG = 180 / Math.PI;

export class TiltScroller {
  private readonly o: Required<TiltScrollOptions>;
  private smoothed: number | null = null;
  private rest: number | null = null;
  private lastT: number | null = null;
  private scrolling = false;

  constructor(options: TiltScrollOptions = {}) {
    this.o = { startDeg: 10, stopDeg: 7, fullDeg: 25, minSpeed: 150, maxSpeed: 1500, smoothMs: 150, restMs: 8000, ...options };
  }

  /**
   * Feeds one head pitch reading (radians, positive downward) at time `t`; `face` is false when no face
   * is seen or the eyes are closed. Returns the scroll speed in CSS pixels per second: positive scrolls
   * down, negative up, zero holds still.
   */
  update(pitch: number, t: number, face: boolean): number {
    const dt = this.lastT === null ? 0 : Math.max(0, t - this.lastT);
    this.lastT = t;
    if (!face) {
      this.scrolling = false;
      return 0;
    }
    const deg = pitch * DEG;
    this.smoothed = this.smoothed === null ? deg : this.smoothed + (deg - this.smoothed) * (1 - Math.exp(-dt / this.o.smoothMs));
    this.rest ??= this.smoothed;
    const tilt = this.smoothed - this.rest;
    const size = Math.abs(tilt);
    if (!this.scrolling && size >= this.o.startDeg) this.scrolling = true;
    else if (this.scrolling && size < this.o.stopDeg) this.scrolling = false;
    if (!this.scrolling) {
      // Not tilting on purpose: let the resting position drift toward where the head actually is.
      this.rest += (this.smoothed - this.rest) * (1 - Math.exp(-dt / this.o.restMs));
      return 0;
    }
    const f = Math.min(1, Math.max(0, (size - this.o.stopDeg) / (this.o.fullDeg - this.o.stopDeg)));
    const speed = this.o.minSpeed + f * f * (this.o.maxSpeed - this.o.minSpeed);
    return Math.sign(tilt) * speed;
  }

  /** Forgets the resting position and any scroll in progress, for a new session. */
  reset(): void {
    this.smoothed = null;
    this.rest = null;
    this.lastT = null;
    this.scrolling = false;
  }
}
