export type ScrollDirection = 'down' | 'up' | 'top' | 'bottom';

/**
 * Scrolls the page by most of a screen, or to its top or bottom. Runs in
 * Chrome's isolated world and must remain self-contained for executeScript.
 * It only scrolls: no clicks, focus changes or page edits. Returns where the
 * page ended up, so the caller can say when there was nowhere left to go.
 */
export function pageScroll(direction: ScrollDirection): 'MOVED' | 'AT_TOP' | 'AT_BOTTOM' {
  const page = document.scrollingElement ?? document.documentElement;
  const max = page.scrollHeight - innerHeight;
  const from = scrollY;
  const to = direction === 'top' ? 0 : direction === 'bottom' ? max
    : Math.max(0, Math.min(max, from + (direction === 'down' ? 0.8 : -0.8) * innerHeight));
  if (Math.abs(to - from) < 1) return direction === 'up' || direction === 'top' ? 'AT_TOP' : 'AT_BOTTOM';
  scrollTo({ top: to, behavior: 'smooth' });
  return 'MOVED';
}

/** The connection over which the side panel streams the head-tilt scroll speed to the page. */
export const HEAD_SCROLL_PORT = 'iris.head-scroll';

/**
 * Head-tilt scrolling in the page: scrolls continuously at the speed the side panel sends (CSS pixels
 * per second, positive down, capped at 3000) until it sends zero or disconnects. Runs in Chrome's
 * isolated world and must remain self-contained for executeScript. It only scrolls, and installs its
 * listener once per page.
 */
export function pageScrollStream(): void {
  const host = globalThis as typeof globalThis & { __irisScrollV01?: boolean };
  if (host.__irisScrollV01) return;
  host.__irisScrollV01 = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'iris.head-scroll') return; // HEAD_SCROLL_PORT; self-contained for executeScript
    let speed = 0, last = 0, carry = 0, frame = 0;
    const step = (now: number) => {
      if (speed === 0) { frame = 0; return; }
      const dt = last ? Math.min(100, now - last) : 16; // a stalled frame never jumps the page
      last = now;
      carry += (speed * dt) / 1000;
      const whole = Math.trunc(carry); // keep fractions so slow scrolling still moves
      if (whole) { scrollBy(0, whole); carry -= whole; }
      frame = requestAnimationFrame(step);
    };
    port.onMessage.addListener((message: unknown) => {
      const s = (message as { speed?: unknown } | null)?.speed;
      speed = typeof s === 'number' && Number.isFinite(s) ? Math.max(-3000, Math.min(3000, s)) : 0;
      if (speed !== 0 && !frame) { last = 0; frame = requestAnimationFrame(step); }
    });
    port.onDisconnect.addListener(() => { speed = 0; });
  });
}
