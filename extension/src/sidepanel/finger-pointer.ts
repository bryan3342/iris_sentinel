import { PinchDetector, PointFilter, snapToTarget, trackpadToScreen, type SnapOptions } from '@iris/core';
import type { Point2, PointerProvider, PointerSample, Unsubscribe } from '@iris/protocol';
import type { TargetList } from './target-list';

/** A fingertip is far steadier than gaze, so it aims only at what is close to its ring. */
export const FINGER_SNAP: SnapOptions = { maxDistance: 40, hysteresis: 12 };

export interface FingerPointerDeps {
  provider: PointerProvider;
  /** The live target list of the page in view, or null without one. */
  list: () => TargetList | null;
  /** Moves the finger ring on tab `tabId` (viewport pixels), or hides it with null. */
  ring: (tabId: number, at: Point2 | null) => void;
  /** Aims at the target under the finger (null for none), or hands aiming back to the eyes with undefined. */
  aim: (target: number | null | undefined) => void;
  /** A pinch clicked `target` (or nothing) at `t`, on the camera's clock. */
  pinch: (t: number, target: number | null) => void;
}

/**
 * Finger tracing: the index fingertip, mapped like a trackpad onto the page in view, moves a blue
 * ring there and aims at the link or button under it, and touching the thumb to it clicks that
 * target. While the fingers come together the aim holds, so the click lands on what the finger
 * pointed at. With no hand in view the ring hides and the eyes aim again.
 */
export class FingerPointer {
  // A finger moves smoothly, unlike gaze with its jumps: steady while it rests, quick when it moves.
  private readonly filter = new PointFilter({ minCutoff: 1, beta: 0.02 });
  private readonly pinches = new PinchDetector();
  private target: number | null = null;
  /** The tab the ring is shown on, or null while no hand is in view. */
  private tabId: number | null = null;
  private stopListening: Unsubscribe | null = null;

  constructor(private readonly deps: FingerPointerDeps) {}

  start(): void {
    this.stopListening ??= this.deps.provider.onSample((sample) => this.update(sample));
  }

  /** Stops following the hand: the ring hides and the eyes aim again. */
  end(): void {
    this.stopListening?.();
    this.stopListening = null;
    this.release();
  }

  private release(): void {
    if (this.tabId === null) return;
    this.deps.ring(this.tabId, null);
    this.tabId = null;
    this.target = null;
    this.filter.reset();
    this.pinches.update(null, 0);
    this.deps.aim(undefined);
  }

  private update(sample: PointerSample): void {
    const list = this.deps.list();
    if (!sample.tip || !list) {
      this.release();
      return;
    }
    if (this.tabId !== null && this.tabId !== list.tabId) this.deps.ring(this.tabId, null); // moved to another tab
    this.tabId = list.tabId;
    const place = trackpadToScreen(sample.tip);
    const at = this.filter.filter({ x: place.x * list.viewport.width, y: place.y * list.viewport.height }, sample.t);
    this.deps.ring(list.tabId, at);
    const { hold, pinch } = this.pinches.update(sample.gap, sample.t);
    if (!hold) this.target = snapToTarget(at, list.targets, this.target, FINGER_SNAP);
    this.deps.aim(this.target);
    if (pinch) this.deps.pinch(sample.t, this.target);
  }
}
