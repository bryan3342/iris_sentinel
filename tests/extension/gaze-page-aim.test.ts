import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalibrationStore, GazeAim, GazePointer } from '@iris/core';
import type { GazeProvider, GazeSample, Point2 } from '@iris/protocol';
import type { OverlayCommand } from '../../extension/src/content/overlay';
import { eyeFor, scripted, SIMULATED_HEAD, simulatedCalibration, SimulatedGazeProvider } from '../../extension/src/providers/simulated/gaze';
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
  function session(look: Parameters<typeof scripted>[0], options: ConstructorParameters<typeof GazeSession>[3] = {}) {
    const store = new CalibrationStore();
    store.setDots(simulatedCalibration(), VIEWPORT);
    const provider = new SimulatedGazeProvider(scripted(look), { noise: 0.02, seed: 4 });
    const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()), options);
    return { provider, gaze };
  }

  it('reports where the user looks for the live cursor, and nothing to show while the eyes are away', async () => {
    const seen: (Point2 | null)[] = [];
    const tabs = new Set<number>();
    const { provider, gaze } = session([{ at: centerOf(2), ms: 1500 }, { at: null, ms: 500 }],
      { onGaze: (at, list) => { seen.push(at); tabs.add(list.tabId); } });
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(1400);
    const looking = seen.at(-1)!;
    const target = TARGETS[1]!.rect;
    expect(Math.abs(looking.x - (target.x + target.width / 2))).toBeLessThan(60);
    expect(Math.abs(looking.y - (target.y + target.height / 2))).toBeLessThan(60);
    await vi.advanceTimersByTimeAsync(400);
    expect(seen.at(-1)).toBeNull();
    expect([...tabs]).toEqual([1]);
    gaze.stop();
    provider.stop();
  });

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
  function selecting(look: () => Point2 | null, learn = false) {
    const store = new CalibrationStore();
    store.setDots(simulatedCalibration(), VIEWPORT);
    const provider = new SimulatedGazeProvider(look, { noise: 0.02, seed: 6 });
    const selected: [number, boolean][] = [];
    const outcomes: Outcome[] = [];
    let learned = 0;
    const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()), {
      select: async (_list, target, confirmedTwice) => { selected.push([target.id, confirmedTwice]); return 'SELECTED'; },
      onOutcome: (outcome) => outcomes.push(outcome),
      learn, onLearned: () => { learned++; },
    });
    return { provider, gaze, selected, outcomes, store, learned: () => learned };
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

  it('teaches the calibration where the user looked at each selection, when asked to learn', async () => {
    const { provider, gaze, store, learned } = selecting(() => centerOf(1), true);
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(3000);
    const confirms = store.samples.filter((s) => s.source === 'confirm');
    expect(confirms).toHaveLength(1);
    expect(learned()).toBe(1);
    const center = centerOf(1); // the selected target's center, as a fraction of the page
    expect(confirms[0]!.target.x).toBeCloseTo(center.x, 5);
    expect(confirms[0]!.target.y).toBeCloseTo(center.y, 5);
    gaze.stop();
    provider.stop();
  });

  it('leaves the calibration alone when not asked to learn, as with the mouse', async () => {
    const { provider, gaze, store, learned } = selecting(() => centerOf(1));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.samples.filter((s) => s.source === 'confirm')).toHaveLength(0);
    expect(learned()).toBe(0);
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

  it('selects through any confirm method exactly as through dwell', async () => {
    const { provider, gaze, selected } = selecting(() => centerOf(1));
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(500); // aimed, but no dwell yet
    gaze.confirms.emit({ t: 500, source: 'stand-in' });
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

describe('confirming with a double blink', () => {
  /** A camera stand-in that plays a script of samples every 33 ms, blinks included. */
  class ScriptedEyes implements GazeProvider {
    private readonly listeners = new Set<(s: GazeSample) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;
    constructor(private readonly frame: (t: number) => GazeSample) {}
    onSample(listener: (s: GazeSample) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    async start() { let t = 0; this.timer = setInterval(() => { t += 33; this.listeners.forEach((l) => l(this.frame(t))); }, 33); }
    stop() { if (this.timer) clearInterval(this.timer); }
  }

  it('selects the target aimed before two quick blinks, at once, even if the reading lands elsewhere after', async () => {
    const lookingAt = (id: number) => (t: number): GazeSample => ({ t, eye: eyeFor(centerOf(id)), head: SIMULATED_HEAD, blink: { left: 0.05, right: 0.05 } });
    // During a quick blink the camera holds the last eye reading and reports the closed lids.
    const blinkingAt = (id: number) => (t: number): GazeSample => ({ ...lookingAt(id)(t), blink: { left: 0.9, right: 0.9 } });
    // Glance at 3, aim at 1 for 450 ms (short of a dwell), blink twice, then the reading lands on 2.
    const script = (t: number) => (t <= 200 ? lookingAt(3) : t <= 650 ? lookingAt(1) : t <= 800 ? blinkingAt(1)
      : t <= 950 ? lookingAt(1) : t <= 1100 ? blinkingAt(1) : lookingAt(2))(t);
    const provider = new ScriptedEyes(script);
    const store = new CalibrationStore();
    store.setDots(simulatedCalibration(), VIEWPORT);
    const selected: number[] = [];
    const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()), {
      select: async (_list, target) => { selected.push(target.id); return 'SELECTED'; },
    });
    gaze.start();
    await provider.start();
    await vi.advanceTimersByTimeAsync(1050);
    expect(selected).toEqual([]); // one blink so far: nothing yet
    await vi.advanceTimersByTimeAsync(150);
    expect(selected).toEqual([1]); // the locked target, the moment the eyes open after the second blink
    gaze.stop();
    provider.stop();
  });

  describe('a target picked by voice', () => {
    const away = { x: 0.5, y: 0.95 }; // far from every target: nothing is aimed
    const eyesOn = (point: Point2, blinking: boolean) => (t: number): GazeSample =>
      ({ t, eye: eyeFor(point), head: SIMULATED_HEAD, blink: blinking ? { left: 0.9, right: 0.9 } : { left: 0.05, right: 0.05 } });
    /** Looks at `point`, blinking twice quickly starting at `blinkAt` ms. */
    const doubleBlinkAt = (point: Point2, blinkAt: number) => (t: number) =>
      eyesOn(point, (t > blinkAt && t <= blinkAt + 150) || (t > blinkAt + 300 && t <= blinkAt + 450))(t);
    function picking(script: (t: number) => GazeSample, learn = false) {
      const provider = new ScriptedEyes(script);
      const store = new CalibrationStore();
      store.setDots(simulatedCalibration(), VIEWPORT);
      const selected: number[] = [];
      let learned = 0;
      const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(new LiveTargetList()), {
        select: async (_list, target) => { selected.push(target.id); return 'SELECTED'; },
        learn, onLearned: () => { learned++; },
      });
      return { provider, gaze, selected, learned: () => learned };
    }

    it('opens with a double blink wherever the user is looking, and is marked on the page', async () => {
      const { provider, gaze, selected } = picking(doubleBlinkAt(away, 1000));
      gaze.start();
      await provider.start();
      await vi.advanceTimersByTimeAsync(500); // the page's targets have arrived
      expect(gaze.arm(99)).toBe(false); // no such number
      expect(gaze.arm(3)).toBe(true);
      expect(sent.at(-1)!.command).toMatchObject({ type: 'show', armed: 3 });
      await vi.advanceTimersByTimeAsync(1100);
      expect(selected).toEqual([3]);
      expect(sent.at(-1)!.command).toMatchObject({ armed: null }); // picked targets clear once selected
      gaze.stop();
      provider.stop();
    });

    it('never teaches the calibration, since the eyes were not on that target', async () => {
      const { provider, gaze, selected, learned } = picking(doubleBlinkAt(away, 1000), true);
      gaze.start();
      await provider.start();
      await vi.advanceTimersByTimeAsync(500);
      gaze.arm(3);
      await vi.advanceTimersByTimeAsync(1100);
      expect(selected).toEqual([3]);
      expect(learned()).toBe(0);
      gaze.stop();
      provider.stop();
    });

    it('expires after ten seconds, so a later double blink opens nothing', async () => {
      const { provider, gaze, selected } = picking(doubleBlinkAt(away, 11_000));
      gaze.start();
      await provider.start();
      await vi.advanceTimersByTimeAsync(500);
      gaze.arm(3);
      await vi.advanceTimersByTimeAsync(11_200);
      expect(selected).toEqual([]);
      gaze.stop();
      provider.stop();
    });

    it('is dropped when a page change moves that number to another place', async () => {
      const { provider, gaze, selected } = picking(doubleBlinkAt(away, 1500));
      gaze.start();
      await provider.start();
      await vi.advanceTimersByTimeAsync(500);
      gaze.arm(3);
      targets = TARGETS.map((t) => (t.id === 3 ? { ...t, rect: { ...t.rect, y: 400 } } : t));
      revision++;
      await vi.advanceTimersByTimeAsync(1300);
      expect(selected).toEqual([]);
      gaze.stop();
      provider.stop();
    });
  });
});
