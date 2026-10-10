import type { Point2 } from '@iris/protocol';

/**
 * Development only: where the mouse is over the page, as a fraction of the
 * visible viewport, or null once it has left. Lets the mouse stand in for the
 * eyes on real sites. Runs in Chrome's isolated world and must remain
 * self-contained for executeScript. Listening changes nothing on the page.
 */
export function pagePointer(): Point2 | null {
  type Pointer = { at: Point2 | null };
  const host = globalThis as typeof globalThis & { __irisPointerV01?: Pointer };
  if (!host.__irisPointerV01) {
    const pointer: Pointer = { at: null };
    host.__irisPointerV01 = pointer;
    addEventListener('pointermove', (e) => {
      const width = visualViewport?.width ?? innerWidth, height = visualViewport?.height ?? innerHeight;
      pointer.at = { x: e.clientX / width, y: e.clientY / height };
    }, true);
    document.documentElement.addEventListener('pointerleave', () => { pointer.at = null; });
  }
  return host.__irisPointerV01.at;
}
