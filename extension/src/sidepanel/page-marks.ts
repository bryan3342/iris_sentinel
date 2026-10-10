import { pageOverlay, type OverlayCommand } from '../content/overlay';
import type { LiveTargetList, TargetList } from './target-list';

function send(tabId: number, command: OverlayCommand): void {
  // A failed draw is retried by the next refresh; a failed erase is undone by the next page change.
  void chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [command] }).catch(() => {});
}

/**
 * The one thing that draws on the browsing tab: every target's number plus the
 * aimed target, from the live target list. The numbers switch and gaze aiming
 * both use it, so they never overwrite each other. The page is messaged only
 * when the list or the aim changes, and moving to another tab erases the
 * previous one. Runs while at least one user has started it.
 */
export class PageMarks {
  private users = 0;
  private list: TargetList | null = null;
  private aim: number | null = null;
  private pending: number | null = null;
  private drawnTab: number | null = null;
  private stopListening: (() => void) | null = null;
  private aimFor: ((list: TargetList) => number | null) | null = null;

  constructor(private readonly targets: LiveTargetList) {}

  start(): void {
    if (this.users++ > 0) return;
    this.stopListening = this.targets.onChange((list) => this.setList(list));
    this.targets.start();
  }

  stop(): void {
    if (this.users === 0 || --this.users > 0) return;
    this.stopListening?.();
    this.stopListening = null;
    this.targets.stop();
    this.setList(null);
  }

  /** The list currently drawn, which the aim's target IDs belong to. */
  get current(): TargetList | null {
    return this.list;
  }

  /** Marks a risky target that waits for its second confirm, or nothing. */
  setPending(id: number | null): void {
    if (id === this.pending) return;
    this.pending = id;
    this.draw();
  }

  /** Lets gaze pick the aim for each new list, so a refresh is drawn once, already aimed. Null stops it. */
  follow(aimFor: ((list: TargetList) => number | null) | null): void {
    this.aimFor = aimFor;
    this.aim = this.list && aimFor ? aimFor(this.list) : null;
    this.draw();
  }

  /** Highlights target `id` of the current list, or nothing. */
  setAim(id: number | null): void {
    if (id === this.aim) return;
    this.aim = id;
    this.draw();
  }

  private setList(list: TargetList | null): void {
    if (this.drawnTab !== null && this.drawnTab !== list?.tabId) send(this.drawnTab, { type: 'clear' });
    this.drawnTab = list?.tabId ?? null;
    this.list = list;
    // IDs are only valid for the scan they came from, so the aim is picked afresh.
    this.aim = list && this.aimFor ? this.aimFor(list) : null;
    this.draw();
  }

  private draw(): void {
    const list = this.list;
    if (!list) return;
    send(list.tabId, { type: 'show', documentToken: list.documentToken, revision: list.revision, targets: list.targets, highlight: this.aim, pending: this.pending });
  }
}
