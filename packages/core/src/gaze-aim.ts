import type { GazeSample, Point2 } from '@iris/protocol';
import type { CalibrationFrame, GazePointer } from './gaze-pointer';
import { snapToTarget, type SnapOptions, type SnapTarget } from './snap';

/**
 * Which page target the user is aiming at. Each smoothed gaze point snaps to
 * the current target list. The aim holds while the eyes are closed or the face
 * is lost. Target IDs are only valid for the scan they came from, so a new list
 * re-snaps from the last gaze point instead of carrying an old ID over.
 */

// Webcam gaze error is about 100 px on a laptop screen, so a target counts as
// aimed up to that far from the point, and a neighbor must be clearly closer to take over.
export const DEFAULT_SNAP: SnapOptions = { maxDistance: 100, hysteresis: 30 };

export class GazeAim {
  private targets: readonly SnapTarget[] = [];
  private frame: CalibrationFrame | null = null;
  private aimed: number | null = null;

  constructor(
    private readonly pointer: GazePointer,
    private readonly options: SnapOptions = DEFAULT_SNAP,
  ) {}

  /** The latest smoothed gaze point in page pixels, or null before calibration has one. */
  get point(): Point2 | null {
    return this.pointer.point;
  }

  /** The aimed target ID in the current list, or null. */
  get current(): number | null {
    return this.aimed;
  }

  /** Replaces the list (a fresh scan of the page) and where the page sits in the calibration; returns the aim. */
  setTargets(targets: readonly SnapTarget[], frame: CalibrationFrame): number | null {
    this.targets = targets;
    this.frame = frame;
    const point = this.pointer.point;
    this.aimed = point ? snapToTarget(point, targets, null, this.options) : null;
    return this.aimed;
  }

  /**
   * The user selected the aimed target, whose center is `pixel` on the page: the eyes' last
   * few samples teach the calibration that this is where they were looking. Returns whether
   * the calibration accepted it.
   */
  learn(pixel: Point2): boolean {
    return this.frame ? this.pointer.confirm(pixel, this.frame, true) : false;
  }

  /** Feeds one gaze sample; returns the aim after it. */
  update(sample: GazeSample): number | null {
    if (!this.frame) return null;
    const point = this.pointer.update(sample, this.frame);
    if (!sample.eye || !point) return this.aimed;
    this.aimed = snapToTarget(point, this.targets, this.aimed, this.options);
    return this.aimed;
  }
}
