import type { Point2 } from '@iris/protocol';
import { GAZE_CURSOR_PORT, pageOverlay } from '../content/overlay';

const RETRY_MS = 1000; // a tab Iris cannot draw on (a browser page, no access) is retried at most once a second

/**
 * The live gaze cursor on the browsing tab. Each smoothed gaze point goes over one
 * open connection to the page's overlay, which moves a red ring there; nothing is
 * injected per frame. A new tab, or a page that navigated, gets the overlay's
 * listener first. The point is drawn inside Iris's closed overlay and never leaves
 * this computer.
 */
export class GazeCursor {
  private port: chrome.runtime.Port | null = null;
  private tabId: number | null = null;
  private last: Point2 | null = null;
  private retryAt = 0;

  /** Shows the cursor at `at` (viewport pixels) on tab `tabId`, or hides it for null. */
  move(tabId: number, at: Point2 | null): void {
    if (tabId !== this.tabId) {
      if (Date.now() < this.retryAt) return;
      this.attach(tabId);
    }
    const port = this.port;
    if (!port) return; // still connecting
    const same = at && this.last ? Math.abs(at.x - this.last.x) < 0.5 && Math.abs(at.y - this.last.y) < 0.5 : at === this.last;
    if (same) return;
    this.last = at;
    port.postMessage({ at });
  }

  /** Hides the cursor and closes the connection. */
  stop(): void {
    this.port?.disconnect();
    this.port = null;
    this.tabId = null;
    this.last = null;
  }

  private attach(tabId: number): void {
    this.stop();
    this.tabId = tabId;
    chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [{ type: 'listen' }] }).then(() => {
      if (this.tabId !== tabId) return;
      const port = chrome.tabs.connect(tabId, { name: GAZE_CURSOR_PORT, frameId: 0 });
      // A navigation ends the page's listener; the next point reconnects to the new page.
      port.onDisconnect.addListener(() => {
        if (this.port === port) this.stop();
      });
      this.port = port;
    }, () => {
      if (this.tabId !== tabId) return;
      this.tabId = null;
      this.retryAt = Date.now() + RETRY_MS;
    });
  }
}
