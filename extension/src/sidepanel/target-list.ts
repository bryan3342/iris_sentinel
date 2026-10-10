import type { Unsubscribe } from '@iris/protocol';
import { eligibleTab, validateTargets } from '../page-understanding/capture';
import { pageRevision, pageSnapshot, type PageTargets } from '../page-understanding/page-helper';

/** One scan of the active tab. Target IDs are valid only together with this tab, document and revision. */
export interface TargetList extends PageTargets {
  tabId: number;
}

const POLL_MS = 250; // a few refreshes a second at most

/**
 * Keeps the active tab's numbered targets current for gaze. Every 250 ms it
 * reads the page's change counter (a tiny call) and rescans only when the tab,
 * the document or the counter has moved. Listeners get each new list, or null
 * while the active tab cannot be read (browser pages, no access, mid-load).
 */
export class LiveTargetList {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: TargetList | null = null;
  private reading = false;
  private readonly listeners = new Set<(list: TargetList | null) => void>();

  get list(): TargetList | null {
    return this.current;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.publish(null);
  }

  onChange(listener: (list: TargetList | null) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async tick(): Promise<void> {
    if (this.reading) return; // never overlap reads
    this.reading = true;
    try {
      const list = await this.read();
      if (this.timer !== null) this.publish(list);
    } catch {
      if (this.timer !== null) this.publish(null);
    } finally {
      this.reading = false;
    }
  }

  private async read(): Promise<TargetList | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !eligibleTab(tab)) return null;
    const tabId = tab.id;
    const known = this.current;
    if (known?.tabId === tabId) {
      const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: pageRevision });
      const seen = probe?.result;
      if (seen?.documentToken === known.documentToken && seen.revision === known.revision) return known;
    }
    const [scan] = await chrome.scripting.executeScript({ target: { tabId }, func: pageSnapshot, args: ['targets'] });
    if (scan?.frameId !== 0) return null;
    return { tabId, ...validateTargets(scan.result) };
  }

  private publish(list: TargetList | null): void {
    if (list === this.current) return;
    this.current = list;
    this.listeners.forEach((listener) => listener(list));
  }
}
