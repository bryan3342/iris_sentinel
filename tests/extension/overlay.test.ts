// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NumberedTarget } from '@iris/protocol';
import { pageOverlay } from '../../extension/src/content/overlay';
import { pageSnapshot } from '../../extension/src/page-understanding/page-helper';

type Globals = typeof globalThis & { __irisUnderstandingV01?: unknown; __irisOverlayV01?: { host: HTMLElement; layer: HTMLElement; cursor: HTMLElement } };
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
  vi.restoreAllMocks();
  // happy-dom has no visual viewport; Chrome always does. An unzoomed one, as the scanner requires.
  vi.stubGlobal('visualViewport', { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1, addEventListener() {} });
  g.__irisOverlayV01?.host.remove();
  delete g.__irisOverlayV01;
  delete g.__irisUnderstandingV01;
  delete (g as { __irisOverlayHoldV01?: number }).__irisOverlayHoldV01;
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

  it('with numbers off, outlines the aimed and voice-picked targets but draws no numbers', async () => {
    const snapshot = pageSnapshot();
    const result = await pageOverlay({
      type: 'show', documentToken: snapshot.documentToken, revision: snapshot.revision, targets: TARGETS, highlight: 1, armed: 2, numbers: false,
    });
    expect(result).toBe('SHOWN');
    expect(drawn().map((el) => el.className)).toEqual(['aim', 'aim armed', 'armed-note']);
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

  it('refuses to draw numbers while held for a screenshot, until released or the hold lapses', async () => {
    const snapshot = pageSnapshot();
    await show(snapshot, 1);
    expect(await pageOverlay({ type: 'hold' })).toBe('CLEARED');
    expect(drawn()).toHaveLength(0);
    expect(await show(snapshot, 2)).toBe('HELD');
    expect(drawn()).toHaveLength(0);
    expect(await pageOverlay({ type: 'release' })).toBe('CLEARED');
    expect(await show(snapshot, 2)).toBe('SHOWN');
    await pageOverlay({ type: 'hold' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_001);
    expect(await show(snapshot, 2)).toBe('SHOWN');
  });

  it('moves the live gaze cursor over the side panel connection, hiding it when it should not show', async () => {
    const connects: ((port: unknown) => void)[] = [];
    vi.stubGlobal('chrome', { runtime: { onConnect: { addListener: (l: (port: unknown) => void) => connects.push(l) } } });
    const snapshot = pageSnapshot();
    expect(await pageOverlay({ type: 'listen' })).toBe('SHOWN');
    await pageOverlay({ type: 'listen' });
    expect(connects).toHaveLength(1); // one listener, however often it is started
    let receive: (m: unknown) => void = () => {}, drop: () => void = () => {};
    connects[0]!({ name: 'iris.gaze-cursor', onMessage: { addListener: (l: typeof receive) => (receive = l) }, onDisconnect: { addListener: (l: typeof drop) => (drop = l) } });
    const cursor = g.__irisOverlayV01!.cursor;
    receive({ at: { x: 120, y: 40 } });
    expect([cursor.hidden, cursor.style.transform]).toEqual([false, 'translate(120px, 40px)']);
    receive({ at: null });
    expect(cursor.hidden).toBe(true);
    receive({ at: { x: 'left', y: 1 } });
    expect(cursor.hidden).toBe(true);
    receive({ at: { x: 1, y: 1 } });
    await pageOverlay({ type: 'hold' }); // a screenshot never shows it
    expect(cursor.hidden).toBe(true);
    receive({ at: { x: 2, y: 2 } });
    expect(cursor.hidden).toBe(true);
    await pageOverlay({ type: 'release' });
    receive({ at: { x: 3, y: 3 } });
    expect(cursor.hidden).toBe(false);
    drop();
    expect(cursor.hidden).toBe(true);
    await settle();
    expect(pageSnapshot().revision).toBe(snapshot.revision); // moving the cursor is not a page change
  });

  it('ignores other connections', async () => {
    const connects: ((port: unknown) => void)[] = [];
    vi.stubGlobal('chrome', { runtime: { onConnect: { addListener: (l: (port: unknown) => void) => connects.push(l) } } });
    await pageOverlay({ type: 'listen' });
    const onMessage = { addListener: vi.fn() };
    connects[0]!({ name: 'something-else', onMessage, onDisconnect: { addListener: vi.fn() } });
    expect(onMessage.addListener).not.toHaveBeenCalled();
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
