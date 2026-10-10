import { viewportFrame, type CalibrationFrame, type GazeAim } from '@iris/core';
import type { GazeProvider, Unsubscribe } from '@iris/protocol';
import type { PageMarks } from './page-marks';
import type { TargetList } from './target-list';

/**
 * Connects gaze to the page: each sample from the provider updates the aim,
 * and the page highlight moves only when the aimed target changes. Each fresh
 * target list is aimed from the last gaze point before it is drawn. Gaze
 * points stay in the side panel; the page only learns which target is aimed.
 * The caller owns the provider's lifecycle (the camera preview shares it).
 * `frameFor` says where each page sits in the calibration: the page itself for
 * a calibration made over it, or the screen for one saved in screen positions.
 */
export class GazeSession {
  private stopSamples: Unsubscribe | null = null;

  constructor(
    private readonly provider: GazeProvider,
    private readonly aim: GazeAim,
    private readonly marks: PageMarks,
    private readonly frameFor: (list: TargetList) => CalibrationFrame = (list) => viewportFrame(list.viewport),
  ) {}

  get running(): boolean {
    return this.stopSamples !== null;
  }

  start(): void {
    if (this.stopSamples) return;
    this.marks.follow((list) => this.aim.setTargets(list.targets, this.frameFor(list)));
    this.marks.start();
    this.stopSamples = this.provider.onSample((sample) => this.marks.setAim(this.aim.update(sample)));
  }

  stop(): void {
    if (!this.stopSamples) return;
    this.stopSamples();
    this.stopSamples = null;
    this.marks.follow(null);
    this.marks.stop();
  }
}
