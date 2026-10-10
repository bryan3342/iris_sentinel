import { CalibrationStore, GazePointer, type Viewport } from '@iris/core';
import type { GazeSample, Point2 } from '@iris/protocol';

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

/** A circle drawn where the user is looking, from calibrated, head-corrected, fixation-smoothed samples. */
export class GazeDot {
  private readonly element = document.createElement('div');
  private readonly pointer: GazePointer;

  constructor(store: CalibrationStore, host: HTMLElement) {
    this.pointer = new GazePointer(store);
    this.element.className = 'gaze-dot';
    host.append(this.element);
  }

  update(sample: GazeSample): void {
    const point = this.pointer.update(sample, viewport());
    if (point) this.element.style.transform = `translate(${point.x}px, ${point.y}px)`;
  }

  /** The user confirmed a target at `pixel`; see GazePointer.confirm. */
  confirm(pixel: Point2): boolean {
    return this.pointer.confirm(pixel, viewport());
  }

  remove(): void {
    this.element.remove();
  }
}
