import { vi } from 'vitest';

// happy-dom has no layout. Each element's box comes from its data-box attribute
// ("x y width height"), and hit testing returns the last element in document
// order whose box contains the point, so a later element covers an earlier one.
const box = (el: Element) => (el.getAttribute('data-box') ?? '').split(' ').map(Number);
function rectOf(this: Element): DOMRect {
  const [x = 0, y = 0, width = 0, height = 0] = box(this);
  return { left: x, top: y, right: x + width, bottom: y + height, x, y, width, height, toJSON() {} } as DOMRect;
}
function hit(this: Document | ShadowRoot, px: number, py: number): Element | null {
  const inside = [...this.querySelectorAll('[data-box]')].filter((el) => {
    const [x = 0, y = 0, w = 0, h = 0] = box(el);
    return px >= x && px <= x + w && py >= y && py <= y + h;
  });
  return inside.at(-1) ?? null;
}

/** Installs the fake layout, an unzoomed visual viewport, and a fresh page helper state. */
export function fakeLayout(): void {
  vi.stubGlobal('visualViewport', { width: 800, height: 600, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectOf);
  vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([]);
  // happy-dom computes no styles; Chrome's defaults for a visible element.
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  Object.assign(document, { elementFromPoint: hit });
  Object.assign(ShadowRoot.prototype, { elementFromPoint: hit });
  delete (globalThis as { __irisUnderstandingV01?: unknown }).__irisUnderstandingV01;
}
