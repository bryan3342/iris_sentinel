import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalibrationStore, GazeAim, GazePointer } from '@iris/core';
import type { Point2 } from '@iris/protocol';
import type { OverlayCommand } from '../../extension/src/content/overlay';
import { scripted, simulatedCalibration, SimulatedGazeProvider } from '../../extension/src/providers/simulated/gaze';
import { GazeSession, type Outcome } from '../../extension/src/sidepanel/gaze-session';
import { PageMarks } from '../../extension/src/sidepanel/page-marks';
import { LiveTargetList } from '../../extension/src/sidepanel/target-list';

const VIEWPORT = { width: 1000, height: 800, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 };
// Three links in a row, like a navigation bar.
const TARGETS = [1, 2, 3].map((id) => ({ id, role: 'link', rect: { x: 100 + (id - 1) * 300, y: 100, width: 200, height: 40 }, risky: false }));
let targets = TARGETS;
const centerOf = (id: number): Point2 => {
  const { rect } = targets.find((t) => t.id === id)!;
  return { x: (rect.x + rect.width / 2) / VIEWPORT.width, y: (rect.y + rect.height / 2) / VIEWPORT.height };
};

let active: number, revision: number, sent: { tabId: number; command: OverlayCommand }[];
const shows = () => sent.filter((s) => s.command.type === 'show').map((s) => (s.command as { highlight: number | null }).highlight);

beforeEach(() => {
  vi.useFakeTimers();
  active = 1;
  revision = 0;
  sent = [];
  targets = TARGETS;
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: active, windowId: 1, url: `https://site${active}.example` }]) },
    windows: { get: vi.fn(async () => ({ left: 0, top: 0 })) },
    scripting: {
      executeScript: vi.fn(async ({ target, func, args }: { target: { tabId: number }; func: { name: string }; args?: [OverlayCommand] }) => {
        const documentToken = `document_for_tab_${target.tabId}_abc`;
        if (func.name === 'pageOverlay') {
          sent.push({ tabId: target.tabId, command: args![0] });
          return [{ frameId: 0, result: 'SHOWN' }];
        }
        if (func.name === 'pageRevision') return [{ frameId: 0, result: { documentToken, revision } }];
        return [{ frameId: 0, result: { documentToken, revision, viewport: VIEWPORT, targets, targetsTruncated: false } }];
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PageMarks', () => {
  it('draws the numbers once, and redraws only when the aim actually changes', async () => {
    const marks = new PageMarks(new LiveTargetList());
    marks.start();
    await vi.advanceTimersByTimeAsync(600);
    marks.setAim(2);
    marks.setAim(2);
    marks.setAim(null);
    expect(shows()).toEqual([null, 2, null]);
    marks.stop();
  });

  it('erases the previous tab on a tab switch, and stops only when its last user stops', async () => {
    const marks = new PageMarks(new LiveTargetList());
    marks.start();
    marks.start(); // the numbers switch and gaze both on
    await vi.advanceTimersByTimeAsync(300);
    active = 2;
    await vi.advanceTimersByTimeAsync(300);
    expect(sent.map((s) => `${s.command.type}:${s.tabId}`)).toEqual(['show:1', 'clear:1', 'show:2']);
    marks.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(sent.at(-1)!.command.type).toBe('show'); // still running for the other user
    marks.stop();
    expect(sent.at(-1)).toEqual({ tabId: 2, command: { type: 'clear' } });
  });

  it('reports the target the user rested on, not the ones passed on the way to the panel', async () => {
    let now = 0;
    const marks = new PageMarks(new LiveTargetList(), () => now);
    marks.start();
    await vi.advanceTimersByTimeAsync(300);
    marks.setAim(1);
    now = 1000;
    marks.setAim(2); // passing over
    now = 1100;
    marks.setAim(3); // passing over
    now = 1200;
    expect(marks.aimed?.target.id).toBe(1);
    expect(marks.aimed?.list.documentToken).toBe('document_for_tab_1_abc');
    marks.stop();
    expect(marks.aimed).toBeNull();
  });
});

describe('GazeSession', () => {
  function session(look: Parameters<typeof scripted>[0]) {
    const store = new CalibrationStore();
    store.setDots(simulatedCalibration(), VIEWPORT);
    const provider = new SimulatedGazeProvider(scripted(look), { noise: 0.02, seed: 4 });
    const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()));
    return { provider, gaze };
  }

  it('highlights the target the user looks at, messaging the page only when the aim moves', async () => {
    const { provider, gaze } = session([{ at: centerOf(1), ms: 1500 }, { at: centerOf(3), ms: 1500 }]);
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(shows()).toEqual([null, 1, 3]); // numbers first, then one message per aim change
    gaze.stop();
    provider.stop();
  });

  it('holds the highlight while the eyes are closed, and aims a refreshed list before drawing it', async () => {
    const { provider, gaze } = session([{ at: centerOf(2), ms: 1000 }, { at: null, ms: 2000 }]);
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(1500);
    revision = 1; // the page changed while the eyes were closed
    await vi.advanceTimersByTimeAsync(1000);
    expect(shows().slice(-2)).toEqual([2, 2]); // the refresh is drawn once, already aimed
    gaze.stop();
    provider.stop();
    expect(sent.at(-1)!.command.type).toBe('clear');
  });
});

describe('selecting with gaze', () => {
  const RISKY_2 = TARGETS.map((t) => (t.id === 2 ? { ...t, risky: true } : t));
  function selecting(look: () => Point2 | null) {
    const store = new CalibrationStore();
    store.setDots(simulatedCalibration(), VIEWPORT);
    const provider = new SimulatedGazeProvider(look, { noise: 0.02, seed: 6 });
    const selected: [number, boolean][] = [];
    const outcomes: Outcome[] = [];
    const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()), {
      select: async (_list, target, confirmedTwice) => { selected.push([target.id, confirmedTwice]); return 'SELECTED'; },
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    return { provider, gaze, selected, outcomes };
  }
  const pendings = () => sent.filter((s) => s.command.type === 'show').map((s) => (s.command as { pending?: number | null }).pending ?? null);

  it('selects a safe target the user dwells on, once', async () => {
    const { provider, gaze, selected } = selecting(() => centerOf(1));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(selected).toEqual([[1, false]]);
    gaze.stop();
    provider.stop();
  });

  it('asks again for a risky target, marks it on the page, and selects it after a look away and back', async () => {
    targets = RISKY_2;
    let looking = 2;
    const { provider, gaze, selected, outcomes } = selecting(() => centerOf(looking));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(outcomes).toEqual(['CONFIRM_AGAIN']);
    expect(pendings()).toContain(2);
    looking = 1; // a glance shorter than a dwell
    await vi.advanceTimersByTimeAsync(600);
    looking = 2;
    await vi.advanceTimersByTimeAsync(1500);
    expect(selected).toEqual([[2, true]]);
    gaze.stop();
    provider.stop();
  });

  it('selects through the stand-in exactly as through dwell', async () => {
    const { provider, gaze, selected } = selecting(() => centerOf(1));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(500); // aimed, but no dwell yet
    gaze.confirmNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(selected).toEqual([[1, false]]);
    gaze.stop();
    provider.stop();
  });

  it('forgets a waiting risky target when the page moves it, so one confirm cannot select what is there now', async () => {
    targets = RISKY_2;
    let looking = 2;
    const { provider, gaze, selected, outcomes } = selecting(() => centerOf(looking));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(1500);
    targets = RISKY_2.map((t) => (t.id === 2 ? { ...t, rect: { ...t.rect, y: 400 } } : t)); // the page moved it
    revision = 1;
    looking = 1;
    await vi.advanceTimersByTimeAsync(600);
    looking = 2;
    await vi.advanceTimersByTimeAsync(1500);
    expect(selected).toEqual([]);
    expect(outcomes).toEqual(['CONFIRM_AGAIN', 'CONFIRM_AGAIN']);
    gaze.stop();
    provider.stop();
  });
});
