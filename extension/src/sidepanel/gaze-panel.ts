import { CalibrationStore, GazeAim, GazePointer, measureAccuracy, RestingPoint, type AccuracyReport } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';
import { pagePointer } from '../content/pointer';
import { simulatedCalibration, SimulatedGazeProvider } from '../providers/simulated/gaze';
import { GazeCursor } from './gaze-cursor';
import { HeadScroller } from './head-scroll';
import { GazeSession, type Outcome } from './gaze-session';
import type { PageMarks } from './page-marks';
import { loadSamples, saveCheck, saveSamples, type AccuracyRecord } from './setup/calibration-storage';
import { calibrateOnPage, checkOnPage, screenFrame } from './setup/page-calibration';
import type { LiveTargetList } from './target-list';

const POINTER_POLL_MS = 50;
const screenSize = () => ({ width: screen.width, height: screen.height });

/** Pointing with the mouse: the mouse over the browsing tab aims like the eyes, with a perfect calibration. */
function mouseGaze(targets: LiveTargetList): { provider: SimulatedGazeProvider; store: CalibrationStore; stop: () => void } {
  let at: Point2 | null = null;
  const timer = setInterval(() => {
    const tabId = targets.list?.tabId;
    if (tabId === undefined) return void (at = null);
    chrome.scripting.executeScript({ target: { tabId }, func: pagePointer })
      .then(([result]) => { at = result?.result ?? null; }, () => { at = null; });
  }, POINTER_POLL_MS);
  const provider = new SimulatedGazeProvider(() => at);
  const store = new CalibrationStore();
  store.setDots(simulatedCalibration(), screenSize());
  return { provider, store, stop: () => { clearInterval(timer); provider.stop(); } };
}

const round = (v: number) => Math.round(v);
/** Where a check dot sat, in words: top left, middle, bottom right and so on. */
function place(at: Point2): string {
  const row = at.y < 1 / 3 ? 'top' : at.y > 2 / 3 ? 'bottom' : 'middle';
  const column = at.x < 1 / 3 ? 'left' : at.x > 2 / 3 ? 'right' : 'center';
  return row === 'middle' && column === 'center' ? 'the middle' : row === 'middle' ? `middle ${column}` : `${row} ${column}`;
}
/** One check in plain words, with up to three earlier ones (other lid angles or seats) to compare against. */
function describeCheck(report: AccuracyReport, earlier: AccuracyRecord[]): string {
  const { posture, regions, worst } = report;
  const px = (v: number | null) => (v === null ? 'n/a' : `${round(v)} px`);
  const now = `Gaze lands ${round(report.meanPx)} px from where you look on average, about ${report.meanDeg.toFixed(1)}° of visual angle ` +
    `(webcam eye trackers typically reach 1° to 2°; ${round(report.share * 100)}% of the screen width); ` +
    `left-right ${round(report.meanXPx)} px, up-down ${round(report.meanYPx)} px. ` +
    `Corners ${px(regions.corners)}, edges ${px(regions.edges)}, between the quadrants ${px(regions.middle)}; ` +
    `top half ${px(regions.top)}, bottom half ${px(regions.bottom)}.` +
    (worst ? ` Worst: ${place(worst.target)} (${round(worst.px)} px).` : '') +
    ` Head turned ${round(posture.yawDeg)}°, tilted ${round(posture.pitchDeg)}°.`;
  const before = earlier.slice(-3).map((r) => `${round(r.report.meanPx)} px (tilted ${round(r.report.posture.pitchDeg)}°)`);
  return before.length ? `${now} Earlier checks: ${before.join(', ')}.` : now;
}

const OUTCOMES: Record<Outcome, string> = {
  SELECTED: 'Selected.',
  NEEDS_DOUBLE_BLINK: 'That one may submit, pay, delete or send, so only a double blink opens it. Nothing was selected.',
  STALE: 'The page changed, so nothing was selected.',
};

/**
 * Side panel controls for gaze: calibrating on the page, aiming with the
 * camera, or, for development, the mouse standing in for the eyes. One at a
 * time. Looking aims; a double blink confirms and selects it (with the mouse, resting one second on a target does),
 * and a risky target opens only with a double blink.
 */
/** What picking a target by voice led to: ready for the eyes' or the mouse's confirm, nothing aiming, or no such number. */
export type PickResult = 'PICKED_EYES' | 'PICKED_MOUSE' | 'NO_AIMING' | 'NO_SUCH_NUMBER';

export interface GazePanel {
  element: HTMLElement;
  useCamera(provider: GazeProvider): void;
  /** Picks target `id` for the user's next confirm (see GazeSession.arm). */
  pick(id: number): PickResult;
  /** Where on the page the eyes (or mouse) rested in the last few seconds, or null. */
  lookedAt(): Point2 | null;
}

export function gazePanel(marks: PageMarks, targets: LiveTargetList): GazePanel {
  const section = document.createElement('section');
  section.className = 'gaze-aim';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const toggle = (text: string) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, ` ${text}`);
    return { label, input };
  };
  const eyes = toggle('Aim with my eyes');
  const mouse = toggle('Point with the mouse');
  const tilt = toggle('Tilt your head to scroll');
  tilt.input.checked = true;
  const calibrate = document.createElement('button');
  calibrate.textContent = 'Calibrate on this page';
  const check = document.createElement('button');
  check.textContent = 'Check accuracy';
  const report = (outcome: Outcome) => { status.textContent = OUTCOMES[outcome]; };
  eyes.input.disabled = calibrate.disabled = check.disabled = true;
  // The live cursor follows wherever the user looks (or points), on the page itself.
  const cursor = new GazeCursor();
  // Recent gaze on the current tab, for "summarize this". Kept in memory only, for five seconds.
  const rest = new RestingPoint();
  let restTab: number | null = null;
  const onGaze = (at: Point2 | null, list: { tabId: number }) => {
    cursor.move(list.tabId, at);
    if (list.tabId !== restTab) { rest.clear(); restTab = list.tabId; }
    rest.push(at, performance.now());
  };
  let camera: GazeProvider | null = null;
  let active: { session: GazeSession; stop?: () => void; mouse?: boolean } | null = null;
  // Head-tilt scrolling runs alongside eye aiming, from the same camera samples.
  const headScroll = new HeadScroller();

  let generation = 0; // bumps on every stop, so a slow calibration load cannot start a stale session

  const stop = () => {
    generation++;
    active?.session.stop();
    active?.stop?.();
    active = null;
    cursor.stop();
    rest.clear();
    headScroll.stop();
    status.textContent = '';
  };
  /** Aims with the camera through a calibration saved in screen positions. */
  const aimWithEyes = (provider: GazeProvider, store: CalibrationStore) => {
    eyes.input.checked = true;
    active = { session: new GazeSession(provider, new GazeAim(new GazePointer(store)), marks, {
      frameFor: screenFrame, onOutcome: report, onGaze,
      // Every gaze selection refines the calibration for the posture the user is in now.
      learn: true, onLearned: () => void saveSamples(store.samples),
    }), stop: provider.onSample((sample) => {
      if (tilt.input.checked) headScroll.update(sample, targets.list?.tabId ?? null);
    }) };
    active.session.start();
    status.textContent = 'Looking aims at the nearest number. Blink twice quickly to select it; looking alone never clicks.';
  };
  eyes.input.addEventListener('change', () => {
    stop();
    mouse.input.checked = false;
    if (!eyes.input.checked || !camera) return;
    const provider = camera;
    const mine = generation;
    void loadSamples().then((samples) => {
      let store: CalibrationStore | null = null;
      try { store = new CalibrationStore(samples, screenSize()); } catch { store = null; }
      if (mine !== generation) return;
      if (!store?.model) {
        eyes.input.checked = false;
        status.textContent = 'Calibrate on this page first.';
        return;
      }
      aimWithEyes(provider, store);
    });
  });
  calibrate.addEventListener('click', () => {
    if (!camera) return;
    const provider = camera;
    stop();
    eyes.input.checked = mouse.input.checked = false;
    const mine = generation;
    calibrate.disabled = true;
    status.textContent = 'Look at each dot on the page until it moves. This takes about 29 seconds.';
    void (async () => {
      const list = await targets.read().catch(() => null);
      if (!list) {
        status.textContent = 'Open a website in this tab, then calibrate.';
        return;
      }
      const store = new CalibrationStore();
      store.setDots(await calibrateOnPage(provider, list), screenSize());
      await saveSamples(store.samples);
      if (mine === generation) aimWithEyes(provider, store);
    })().catch(() => {
      status.textContent = 'Calibration needs your face in view. Try again.';
    }).finally(() => {
      calibrate.disabled = false;
    });
  });
  check.addEventListener('click', () => {
    if (!camera) return;
    const provider = camera;
    stop();
    eyes.input.checked = mouse.input.checked = false;
    const mine = generation;
    check.disabled = true;
    void (async () => {
      const store = new CalibrationStore(await loadSamples(), screenSize());
      if (!store.model) {
        status.textContent = 'Calibrate on this page first.';
        return;
      }
      const list = await targets.read().catch(() => null);
      if (!list) {
        status.textContent = 'Open a website in this tab, then check.';
        return;
      }
      status.textContent = 'Look at each dot until it moves. This takes about 29 seconds.';
      const samples = await checkOnPage(provider, list);
      if (samples.length === 0) throw new Error('no gaze samples'); // an empty check would read as 0 px error
      const result = measureAccuracy(store.model, samples, screenSize());
      const checks = await saveCheck({ at: Date.now(), report: result, frame: screenSize(), samples });
      if (mine !== generation) return;
      aimWithEyes(provider, store);
      status.textContent = describeCheck(result, checks.slice(0, -1));
    })().catch(() => {
      status.textContent = 'The check needs your face in view. Try again.';
    }).finally(() => {
      check.disabled = false;
    });
  });
  tilt.input.addEventListener('change', () => {
    if (!tilt.input.checked) headScroll.stop();
  });
  mouse.input.addEventListener('change', () => {
    stop();
    eyes.input.checked = false;
    if (!mouse.input.checked) return;
    const sim = mouseGaze(targets);
    active = { session: new GazeSession(sim.provider, new GazeAim(new GazePointer(sim.store)), marks, { onOutcome: report, onGaze, dwell: true }), stop: sim.stop, mouse: true };
    active.session.start();
    void sim.provider.start();
    status.textContent = 'Move the mouse over the page: the nearest number is highlighted. Rest on it for a second to select it. Anything that may submit, pay, delete or send needs a double blink, so aim with your eyes for those.';
  });
  section.append(calibrate, check, eyes.label, tilt.label, mouse.label, status);
  return {
    element: section,
    useCamera(provider) {
      camera = provider;
      eyes.input.disabled = calibrate.disabled = check.disabled = false;
      // A calibration saved for this screen carries over: aiming resumes by itself, with no new dots.
      const mine = generation;
      void loadSamples().then((samples) => {
        let store: CalibrationStore | null = null;
        try { store = new CalibrationStore(samples, screenSize()); } catch { store = null; }
        if (mine !== generation || active || !store?.model) return;
        aimWithEyes(provider, store);
        status.textContent = 'Aiming with your saved calibration for this screen. Blink twice quickly to select; looking alone never clicks.';
      });
    },
    lookedAt: () => (active ? rest.point(performance.now()) : null),
    pick(id) {
      if (!active) return 'NO_AIMING';
      if (!active.session.arm(id)) return 'NO_SUCH_NUMBER';
      return active.mouse ? 'PICKED_MOUSE' : 'PICKED_EYES';
    },
  };
}
