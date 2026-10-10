// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NumberedTarget } from '@iris/protocol';
import { pageOverlay } from '../../extension/src/content/overlay';
import { pageSnapshot } from '../../extension/src/page-understanding/page-helper';

type Globals = typeof globalThis & { __irisUnderstandingV01?: unknown; __irisOverlayV01?: { host: HTMLElement; layer: HTMLElement } };
const g = globalThis as Globals;
const TARGETS: NumberedTarget[] = [
  { id: 1, role: 'link', rect: { x: 10, y: 20, width: 120, height: 30 } },
  { id: 2, role: 'button', rect: { x: 200, y: 20, width: 80, height: 30 } },
];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0)); // let mutation observers run
const drawn = () => [...(g.__irisOverlayV01?.layer.children ?? [])] as HTMLElement[];
const show = (snapshot: { documentToken: string; revision: number }, highlight: number | null) =>
  pageOverlay({ type: 'show', documentToken: snapshot.documentToken, revision: snapshot.revision, targets: TARGETS, highlight });

beforeEach(() => {
  // happy-dom has no visual viewport; Chrome always does. An unzoomed one, as the scanner requires.
  vi.stubGlobal('visualViewport', { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {} });
  g.__irisOverlayV01?.host.remove();
  delete g.__irisOverlayV01;
  delete g.__irisUnderstandingV01;
  document.body.replaceChildren();
});

describe('page overlay', () => {
  it('draws every number and highlights one target, without blocking the page', async () => {
    expect(await show(pageSnapshot(), 2)).toBe('SHOWN');
    const host = g.__irisOverlayV01!.host;
    expect(host.parentNode).toBe(document.documentElement);
    expect(host.shadowRoot).toBeNull(); // closed: page scripts cannot reach into it
    expect(host.style.pointerEvents).toBe('none');
    expect(drawn().filter((el) => el.className.startsWith('badge')).map((el) => el.textContent)).toEqual(['1', '2']);
    const aim = drawn().filter((el) => el.className === 'aim');
    expect(aim).toHaveLength(1);
    expect([aim[0]!.style.left, aim[0]!.style.top, aim[0]!.style.width]).toEqual(['200px', '20px', '80px']);
    expect(drawn().at(-1)!.textContent).toBe('2'); // the aimed number is drawn on top
  });

  it('does not count its own mounting or redrawing as a page change', async () => {
    const snapshot = pageSnapshot();
    await show(snapshot, 1);
    await settle();
    expect(pageSnapshot().revision).toBe(snapshot.revision);
    expect(await show(snapshot, 2)).toBe('SHOWN');
    await settle();
    expect(pageSnapshot().revision).toBe(snapshot.revision);
  });

  it('is erased by the next page change, and an old revision is refused', async () => {
    const snapshot = pageSnapshot();
    await show(snapshot, 1);
    document.body.append(document.createElement('p'));
    await settle();
    expect(drawn()).toHaveLength(0);
    expect(await show(snapshot, 1)).toBe('STALE');
    expect(drawn()).toHaveLength(0);
  });

  it('refuses a document it has not scanned', async () => {
    const snapshot = pageSnapshot();
    expect(await show({ ...snapshot, documentToken: 'another_document_token' }, 1)).toBe('STALE');
    expect(g.__irisOverlayV01).toBeUndefined();
  });

  it('clears on request', async () => {
    await show(pageSnapshot(), 1);
    expect(await pageOverlay({ type: 'clear' })).toBe('CLEARED');
    expect(drawn()).toHaveLength(0);
  });

  it('shows one calibration dot that a page change does not erase, without moving the page counter', async () => {
    const snapshot = pageSnapshot();
    await show(snapshot, 1);
    expect(await pageOverlay({ type: 'dot', at: { x: 0.25, y: 0.75 } })).toBe('SHOWN');
    document.body.append(document.createElement('p'));
    await settle();
    const [shade, dot] = drawn();
    expect(shade!.className).toBe('shade');
    expect([dot!.className, dot!.style.left, dot!.style.top]).toEqual(['dot', '25%', '75%']);
    expect(await pageOverlay({ type: 'dot', at: null })).toBe('CLEARED');
    expect(drawn()).toHaveLength(0);
    await settle();
    expect(pageSnapshot().revision).toBe(snapshot.revision + 1); // only the page's own change counted
  });
});
