const RETRY_MS = 1000; // a tab Iris cannot reach (a browser page, no access) is retried at most once a second

/**
 * One open connection from the side panel to a listener in the browsing tab, for messages sent many
 * times a second (the gaze cursor, head-tilt scrolling) without injecting code each time. The
 * listener is installed first in each new tab, and again after a navigation ends the old one.
 */
export class PageChannel {
  private port: chrome.runtime.Port | null = null;
  private tabId: number | null = null;
  private retryAt = 0;

  constructor(private readonly name: string, private readonly install: (tabId: number) => Promise<unknown>) {}

  /** The open connection to tab `tabId`, or null while it is being made (or a tab Iris cannot reach waits to be retried). */
  connected(tabId: number): chrome.runtime.Port | null {
    if (tabId !== this.tabId) {
      if (Date.now() < this.retryAt) return null;
      this.attach(tabId);
    }
    return this.port;
  }

  close(): void {
    this.port?.disconnect();
    this.port = null;
    this.tabId = null;
  }

  private attach(tabId: number): void {
    this.close();
    this.tabId = tabId;
    this.install(tabId).then(() => {
      if (this.tabId !== tabId) return;
      const port = chrome.tabs.connect(tabId, { name: this.name, frameId: 0 });
      // A navigation ends the page's listener; the next message reconnects to the new page.
      port.onDisconnect.addListener(() => {
        if (this.port === port) this.close();
      });
      this.port = port;
    }, () => {
      if (this.tabId !== tabId) return;
      this.tabId = null;
      this.retryAt = Date.now() + RETRY_MS;
    });
  }
}
