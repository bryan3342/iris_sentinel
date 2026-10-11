import { ConfirmChannel, decideSelection, DwellDetector, DoubleBlinkDetector, viewportFrame, type CalibrationFrame, type ConfirmEvent, type GazeAim } from '@iris/core';
import type { GazeProvider, Point2, Unsubscribe } from '@iris/protocol';
import { pageSelect, type SelectResult } from '../content/select';
import type { PageMarks } from './page-marks';
import type { TargetList } from './target-list';

type Target = TargetList['targets'][number];
/** Clicks a confirmed target; the page checks everything again before it does. `blinked` says the confirm was a double blink, the only one that opens a risky target. */
export type Select = (list: TargetList, target: Target, blinked: boolean) => Promise<SelectResult>;
/** What a confirm did: a selection's result, or NO_TARGET for a double blink with no number aimed before it. */
export type Outcome = SelectResult | 'NO_TARGET';

export const selectInPage: Select = async (list, target, blinked) => {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: list.tabId },
    func: pageSelect,
    args: [{ documentToken: list.documentToken, revision: list.revision, id: target.id, rect: target.rect, blinked }],
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
  /**
   * Whether resting on a safe target for a second selects it. Off for the eyes, which rest naturally
   * while reading, so only a double blink clicks; on for pointing with the mouse, where resting is
   * deliberate and the mouse has no other way to confirm.
   */
  dwell?: boolean;
  /** Told where the user is looking on each sample, in page pixels, or null with eyes closed or the face lost. */
  onGaze?: (at: Point2 | null, list: TargetList) => void;
}

const ARM_MS = 10_000; // how long a target picked by voice waits for the user's confirm
/** Whether only the person's own confirm may open a target: a missing flag never reads as safe. */
export const isRisky = (target: { risky?: boolean }) => target.risky !== false;

/**
 * Connects gaze to the page. Each sample updates the aim, and the page
 * highlight moves only when the aimed target changes. Each fresh target list
 * is aimed from the last gaze point before it is drawn. Dwell and any other
 * confirm method meet in `confirms`; each confirm goes through decideSelection,
 * so a safe target is selected by any confirm and a risky one only by a
 * double blink. Snapping stays in the side panel; the page learns which
 * target is aimed and which to select, and `onGaze` feeds the live cursor that
 * Iris draws inside its closed overlay. The caller owns the provider's
 * lifecycle (the camera preview shares it).
 */
export class GazeSession {
  readonly confirms = new ConfirmChannel();
  private readonly dwell = new DwellDetector();
  private readonly doubleBlink = new DoubleBlinkDetector();
  private readonly frameFor: (list: TargetList) => CalibrationFrame;
  private readonly select: Select;
  private list: TargetList | null = null;
  private lastT = 0;
  /** A target the voice agent picked, until the user confirms it, it expires, or the page moves it. */
  private armed: { id: number; until: number } | null = null;
  /** An action the voice agent asked for, such as closing a tab, that waits for the user's double blink on that tab. */
  private action: { tabId: number; run: () => void; until: number } | null = null;
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
        if (this.armed && sample.t > this.armed.until) this.disarm();
        if (this.action && sample.t > this.action.until) this.action = null;
        const aimed = this.aim.update(sample);
        if (this.list) this.options.onGaze?.(sample.eye ? this.aim.point : null, this.list);
        this.marks.setAim(aimed);
        // A double blink (or, for the mouse, a dwell) confirms the aimed target; decideSelection says what it opens.
        const dwelt = this.options.dwell ? this.dwell.update(sample, aimed) : null;
        const event = dwelt ?? this.doubleBlink.update(sample, aimed);
        if (event) this.confirms.emit(event);
      }),
      this.confirms.onConfirm((event) => this.handle(event)),
    ];
  }

  stop(): void {
    if (!this.running) return;
    this.stops.forEach((stop) => stop());
    this.stops = [];
    this.doubleBlink.reset();
    this.disarm();
    this.action = null;
    this.marks.follow(null);
    this.marks.stop();
  }

  private follow(list: TargetList): number | null {
    // A double blink in progress keeps its locked target only while that number still means the same element.
    const locked = this.doubleBlink.locked;
    if (locked !== null && !this.samePlace(locked, list)) this.doubleBlink.reset();
    if (this.armed && !this.samePlace(this.armed.id, list)) this.disarm();
    if (this.action && this.action.tabId !== list.tabId) this.action = null; // never acts on a tab the user moved away from
    this.list = list;
    return this.aim.setTargets(list.targets, this.frameFor(list));
  }

  /**
   * The voice agent picked target `id` of the current scan: it is marked on the page, and the user's next
   * double blink opens it wherever they are looking (a mouse dwell on it works too). It stays picked for ten
   * seconds, until a page change moves it, or until something is selected. Nothing clicks from this alone.
   * Returns false when the current scan has no such target.
   */
  arm(id: number): boolean {
    if (!this.list?.targets.some((t) => t.id === id)) return false;
    this.action = null; // the latest request wins: one double blink never does two things
    this.armed = { id, until: this.lastT + ARM_MS };
    this.marks.setArmed(id);
    return true;
  }

  /**
   * The voice agent asked for an action that needs the user's confirm, such as closing tab `tabId`: the
   * user's next double blink on that tab runs it, for ten seconds, in place of selecting a target. It
   * replaces any target picked by voice. Nothing runs from this alone.
   */
  armAction(tabId: number, run: () => void): void {
    this.disarm();
    this.action = { tabId, run, until: this.lastT + ARM_MS };
  }

  private disarm(): void {
    this.armed = null;
    this.marks.setArmed(null);
  }

  /** Whether target `id` in the new scan is the same element, in the same place, as in the current one. */
  private samePlace(id: number, list: TargetList): boolean {
    const before = this.list?.targets.find((t) => t.id === id);
    const after = list.targets.find((t) => t.id === id);
    return Boolean(before && after && this.list!.tabId === list.tabId && this.list!.documentToken === list.documentToken &&
      Math.abs(before.rect.x - after.rect.x) <= 4 && Math.abs(before.rect.y - after.rect.y) <= 4);
  }

  private handle(event: ConfirmEvent): void {
    if (event.source === 'double-blink' && this.action) {
      const { run } = this.action;
      this.action = null;
      run();
      return;
    }
    const list = this.list;
    // A target picked by voice is what a double blink confirms, wherever the user is looking; otherwise a
    // double blink brings the target it locked before the eyes closed, and a dwell the aimed one.
    const byVoice = event.source === 'double-blink' && this.armed !== null;
    const id = byVoice ? this.armed!.id : event.target === undefined ? this.aim.current : event.target;
    const target = list?.targets.find((t) => t.id === id) ?? null;
    const outcome = decideSelection(event, target && { id: target.id, risky: isRisky(target) });
    if (outcome.kind === 'needs-double-blink') this.options.onOutcome?.('NEEDS_DOUBLE_BLINK');
    if (outcome.kind === 'none' && event.source === 'double-blink') this.options.onOutcome?.('NO_TARGET');
    if (outcome.kind === 'select' && list && target && this.options.learn && !byVoice) {
      // Learned at the confirm, from the eyes' samples during the dwell, before the page reacts.
      // Never for a voice pick: the eyes were not on that target, so it would teach the aim a wrong offset.
      const center = { x: target.rect.x + target.rect.width / 2, y: target.rect.y + target.rect.height / 2 };
      if (this.aim.learn(center)) this.options.onLearned?.();
    }
    if (outcome.kind === 'select') this.disarm();
    if (outcome.kind === 'select' && list && target) {
      void this.select(list, target, event.source === 'double-blink').then(
        (result) => this.options.onOutcome?.(result),
        () => this.options.onOutcome?.('STALE'),
      );
    }
  }
}
