import { applyCalibration, PointFilter, type CalibrationModel } from '@iris/core';
import type { GazeSample } from '@iris/protocol';

/** A circle drawn where the user is looking, from calibrated and smoothed samples. */
export class GazeDot {
  private readonly element = document.createElement('div');
  private readonly filter = new PointFilter({ minCutoff: 0.8, beta: 3 });

  constructor(private readonly model: CalibrationModel) {
    this.element.className = 'gaze-dot';
    document.body.append(this.element);
  }

  update(sample: GazeSample): void {
    this.element.hidden = sample.eye === null;
    if (!sample.eye) return;
    const point = this.filter.filter(applyCalibration(this.model, sample.eye, sample.head), sample.t);
    this.element.style.transform = `translate(${point.x * window.innerWidth}px, ${point.y * window.innerHeight}px)`;
  }

  remove(): void {
    this.element.remove();
  }
}
