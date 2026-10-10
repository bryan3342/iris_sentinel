// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { pageScroll } from '../../extension/src/content/scroll';

let scrollTo: ReturnType<typeof vi.fn>;
const at = (y: number) => vi.stubGlobal('scrollY', y);
beforeEach(() => {
  vi.unstubAllGlobals();
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
  vi.stubGlobal('innerHeight', 1000);
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
});

it('scrolls by most of a screen, never past either end', () => {
  at(1000);
  expect(pageScroll('down')).toBe('MOVED');
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 1800, behavior: 'smooth' });
  at(3900);
  pageScroll('down');
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 4000, behavior: 'smooth' }); // the last screen
  at(500);
  pageScroll('up');
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
});

it('jumps to the top or bottom, and says when it is already there', () => {
  at(2000);
  pageScroll('bottom');
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 4000, behavior: 'smooth' });
  at(0);
  expect(pageScroll('top')).toBe('AT_TOP');
  expect(pageScroll('up')).toBe('AT_TOP');
  at(4000);
  expect(pageScroll('down')).toBe('AT_BOTTOM');
  expect(scrollTo).toHaveBeenCalledTimes(1); // only the jump to the bottom moved the page
});
