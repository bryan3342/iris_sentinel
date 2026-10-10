// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { pageSnapshot } from '../../extension/src/page-understanding/page-helper';

// happy-dom has no layout. Each element's box comes from its data-box attribute
// ("x y width height"), and hit testing returns the innermost element whose box contains the point.
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

beforeEach(() => {
  vi.stubGlobal('visualViewport', { width: 800, height: 600, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectOf);
  vi.spyOn(Element.prototype, 'getAnimations').mockReturnValue([]);
  // happy-dom computes no styles; Chrome's defaults for a visible element.
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  Object.assign(document, { elementFromPoint: hit });
  Object.assign(ShadowRoot.prototype, { elementFromPoint: hit });
  delete (globalThis as { __irisUnderstandingV01?: unknown }).__irisUnderstandingV01;
  document.body.innerHTML = `
    <a href="/one" data-box="10 10 100 20">Account settings</a>
    <button data-box="10 40 80 20">Send</button>
    <button disabled data-box="10 70 80 20">Off</button>
    <video data-box="200 10 300 200"></video>
    <input data-box="10 100 200 20">
    <x-widget data-box="10 130 200 40"></x-widget>`;
  const widget = document.querySelector('x-widget')!;
  widget.attachShadow({ mode: 'open' }).innerHTML = '<button data-box="20 140 60 20">Inside</button>';
});

it('finds links and buttons on a page that page understanding refuses', () => {
  expect(pageSnapshot().blocked).toBe(true); // the video blocks screenshots
  const gaze = pageSnapshot('targets');
  expect(gaze.targets.map((t) => [t.role, t.rect.y])).toEqual([['link', 10], ['button', 40], ['button', 140]]);
});

it('reports positions only: no labels, masks, images or blocking verdict', () => {
  const gaze = pageSnapshot('targets');
  expect(Object.keys(gaze).sort()).toEqual(['documentToken', 'revision', 'targets', 'targetsTruncated', 'viewport']);
  expect(gaze.targets.every((t) => !('label' in t))).toBe(true);
});

it('marks what selecting each target would risk, failing toward a second confirm', () => {
  const row = (i: number) => `data-box="10 ${10 + i * 30} 200 20"`;
  document.body.innerHTML = `
    <a href="https://example.com/news" ${row(0)}>Today's news</a>
    <a href="https://example.com/a" ${row(1)}>Delete my account</a>
    <a href="https://example.com/f.pdf" download ${row(2)}>Report</a>
    <a href="mailto:someone@example.com" ${row(3)}>Write to us</a>
    <div role="link" ${row(4)}>Styled link</div>
    <button ${row(5)}>Menu</button>
    <button ${row(6)}>Send</button>
    <button aria-label="" ${row(7)}></button>
    <form><button type="button" ${row(8)}>Next</button></form>
    <button ${row(9)}>  show   more </button>`;
  const flags = pageSnapshot('targets').targets.map((t) => [t.rect.y, t.risky]);
  expect(flags).toEqual([
    [10, false], // a plain link to a web page
    [40, true], // a risky word
    [70, true], // a download
    [100, true], // opens another app
    [130, true], // not a real link: cannot tell what it does
    [160, false], // a plainly harmless button
    [190, true], // a risky word
    [220, true], // icon only: cannot tell what it does
    [250, true], // inside a form
    [280, false], // harmless, whitespace aside
  ]);
});

