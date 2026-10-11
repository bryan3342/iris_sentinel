import type { Point2 } from '@iris/protocol';
import { GAZE_CURSOR_PORT, pageOverlay } from '../content/overlay';
import { PageChannel } from './page-channel';

/**
 * The live gaze cursor on the browsing tab. Each smoothed gaze point goes over one
 * open connection to the page's overlay, which moves a red ring there; nothing is
 * injected per frame. The point is drawn inside Iris's closed overlay and never
 * leaves this computer.
 */
export class GazeCursor {
  private readonly channel = new PageChannel(GAZE_CURSOR_PORT,
    (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [{ type: 'listen' }] }));
  private port: chrome.runtime.Port | null = null;
  private last: Point2 | null = null;

  /** Shows the cursor at `at` (viewport pixels) on tab `tabId`, or hides it for null. */
  move(tabId: number, at: Point2 | null): void {
    const port = this.channel.connected(tabId);
    if (!port) return; // still connecting
    if (port !== this.port) { // a new page: nothing shown there yet
      this.port = port;
      this.last = null;
    }
    const same = at && this.last ? Math.abs(at.x - this.last.x) < 0.5 && Math.abs(at.y - this.last.y) < 0.5 : at === this.last;
    if (same) return;
    this.last = at;
    port.postMessage({ at });
  }

  /** Hides the cursor and closes the connection. */
  stop(): void {
    this.channel.close();
    this.port = null;
    this.last = null;
  }
}
