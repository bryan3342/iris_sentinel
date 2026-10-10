import type { GazeAim } from '@iris/core';
import type { GazeProvider, Unsubscribe } from '@iris/protocol';
import type { PageMarks } from './page-marks';

/**
 * Connects gaze to the page: each sample from the provider updates the aim,
 * and the page highlight moves only when the aimed target changes. Each fresh
 * target list is aimed from the last gaze point before it is drawn. Gaze
 * points stay in the side panel; the page only learns which target is aimed.
 * The caller owns the provider's lifecycle (the camera preview shares it).
 */
export class GazeSession {
  private stopSamples: Unsubscribe | null = null;

  constructor(
    private readonly provider: GazeProvider,
    private readonly aim: GazeAim,
    private readonly marks: PageMarks,
  ) {}

  get running(): boolean {
    return this.stopSamples !== null;
  }

  start(): void {
    if (this.stopSamples) return;
    this.marks.follow((list) => this.aim.setTargets(list.targets, list.viewport));
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
