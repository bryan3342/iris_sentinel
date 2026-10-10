import { ConfirmChannel, DwellDetector, SelectionGate, viewportFrame, type CalibrationFrame, type ConfirmEvent, type GazeAim } from '@iris/core';
import type { GazeProvider, Unsubscribe } from '@iris/protocol';
import { pageSelect, type SelectResult } from '../content/select';
import type { PageMarks } from './page-marks';
import type { TargetList } from './target-list';

type Target = TargetList['targets'][number];
/** Clicks a confirmed target. The page checks everything again before it does. */
export type Select = (list: TargetList, target: Target, confirmedTwice: boolean) => Promise<SelectResult>;
export type Outcome = SelectResult | 'CONFIRM_AGAIN';

export const selectInPage: Select = async (list, target, confirmedTwice) => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: list.tabId },
    func: pageSelect,
    args: [{ documentToken: list.documentToken, revision: list.revision, id: target.id, rect: target.rect, confirmedTwice }],
  });
  return (result?.result as SelectResult | undefined) ?? 'STALE';
};

export interface GazeSessionOptions {
  /** Where each page sits in the calibration: the page itself (default), or the screen for a screen calibration. */
  frameFor?: (list: TargetList) => CalibrationFrame;
  select?: Select;
  /** Told what each confirm led to, for the side panel's status line. */
  onOutcome?: (outcome: Outcome) => void;
  /**
   * Each selection teaches the calibration where the user was looking (the selected target's
   * center), so the map keeps up as their posture changes. Only for a real eye calibration.
   */
  learn?: boolean;
  /** Told when a selection was learned, so the calibration can be saved. */
  onLearned?: () => void;
}

const isRisky = (target: Target) => target.risky !== false; // a missing flag never reads as safe

/**
 * Connects gaze to the page. Each sample updates the aim, and the page
 * highlight moves only when the aimed target changes. Each fresh target list
 * is aimed from the last gaze point before it is drawn. Dwell and any other
 * confirm method meet in `confirms`; each confirm goes through the selection
 * gate, so a safe target is selected at once and a risky one only after a
 * second confirm. Gaze points stay in the side panel; the page only learns
 * which target is aimed, and which to select. The caller owns the provider's
 * lifecycle (the camera preview shares it).
 */
export class GazeSession {
  readonly confirms = new ConfirmChannel();
  private readonly dwell = new DwellDetector();
  private readonly gate = new SelectionGate();
  private readonly frameFor: (list: TargetList) => CalibrationFrame;
  private readonly select: Select;
  private list: TargetList | null = null;
  private lastT = 0;
  private stops: Unsubscribe[] = [];

  constructor(
    private readonly provider: GazeProvider,
    private readonly aim: GazeAim,
    private readonly marks: PageMarks,
    private readonly options: GazeSessionOptions = {},
  ) {
    this.frameFor = options.frameFor ?? ((list) => viewportFrame(list.viewport));
    this.select = options.select ?? selectInPage;
  }

  get running(): boolean {
    return this.stops.length > 0;
  }

  start(): void {
    if (this.running) return;
    this.marks.follow((list) => this.follow(list));
    this.marks.start();
    this.stops = [
      this.provider.onSample((sample) => {
        this.lastT = sample.t;
        const aimed = this.aim.update(sample);
        this.marks.setAim(aimed);
        const event = this.dwell.update(sample, aimed);
        if (event) this.confirms.emit(event);
        this.marks.setPending(this.gate.pending(sample.t));
      }),
      this.confirms.onConfirm((event) => this.handle(event)),
    ];
  }

  stop(): void {
    if (!this.running) return;
    this.stops.forEach((stop) => stop());
    this.stops = [];
    this.gate.reset();
    this.marks.setPending(null);
    this.marks.follow(null);
    this.marks.stop();
  }

  private follow(list: TargetList): number | null {
    // A risky target waiting for its second confirm stays armed only if the new scan still shows
    // the same element in the same place; otherwise a new element under the old number could be
    // selected with one confirm.
    const waiting = this.gate.pending(this.lastT);
    const before = this.list?.targets.find((t) => t.id === waiting);
    const after = list.targets.find((t) => t.id === waiting);
    const same = before && after && this.list!.tabId === list.tabId && this.list!.documentToken === list.documentToken &&
      Math.abs(before.rect.x - after.rect.x) <= 4 && Math.abs(before.rect.y - after.rect.y) <= 4 && isRisky(after);
    if (waiting !== null && !same) this.gate.reset();
    this.list = list;
    return this.aim.setTargets(list.targets, this.frameFor(list));
  }

  private handle(event: ConfirmEvent): void {
    const list = this.list;
    const target = list?.targets.find((t) => t.id === this.aim.current) ?? null;
    const outcome = this.gate.confirm(event, target && { id: target.id, risky: isRisky(target) });
    if (outcome.kind === 'confirm-again') {
      this.marks.setPending(outcome.target);
      this.options.onOutcome?.('CONFIRM_AGAIN');
    }
    if (outcome.kind === 'select' && list && target && this.options.learn) {
      // Learned at the confirm, from the eyes' samples during the dwell, before the page reacts.
      const center = { x: target.rect.x + target.rect.width / 2, y: target.rect.y + target.rect.height / 2 };
      if (this.aim.learn(center)) this.options.onLearned?.();
    }
    if (outcome.kind === 'select' && list && target) {
      void this.select(list, target, isRisky(target)).then(
        (result) => this.options.onOutcome?.(result),
        () => this.options.onOutcome?.('STALE'),
      );
    }
  }
}
