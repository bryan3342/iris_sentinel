import { TiltScroller } from '@iris/core';
import type { GazeSample } from '@iris/protocol';
import { HEAD_SCROLL_PORT, pageScrollStream } from '../content/scroll';
import { PageChannel } from './page-channel';

/**
 * Head-tilt scrolling for the browsing tab: each camera sample's head pitch becomes a scroll speed
 * (see TiltScroller), sent to the page only when it changes, over one open connection. Only the
 * pitch is used; nothing is stored or sent off the computer.
 */
export class HeadScroller {
  private readonly tilt = new TiltScroller();
  private readonly channel = new PageChannel(HEAD_SCROLL_PORT,
    (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: pageScrollStream }));
  private port: chrome.runtime.Port | null = null;
  private sent = 0;

  /** Feeds one camera sample; `tabId` is the browsing tab to scroll, or null when there is none. */
  update(sample: GazeSample, tabId: number | null): void {
    const speed = this.tilt.update(sample.head.pitch, sample.t, sample.eye !== null);
    if (tabId === null) return;
    const port = this.channel.connected(tabId);
    if (!port) return;
    if (port !== this.port) { // a new page starts still
      this.port = port;
      this.sent = 0;
    }
    const small = speed !== 0 && this.sent !== 0 && Math.sign(speed) === Math.sign(this.sent) && Math.abs(speed - this.sent) < 25;
    if (speed === this.sent || small) return;
    this.sent = speed;
    port.postMessage({ speed });
  }

  stop(): void {
    this.channel.close();
    this.tilt.reset();
    this.port = null;
    this.sent = 0;
  }
}
