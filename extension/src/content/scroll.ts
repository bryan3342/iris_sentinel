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
