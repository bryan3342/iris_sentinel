import { CalibrationStore, GazeAim, GazePointer, measureAccuracy, type AccuracyReport } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';
import { pagePointer } from '../content/pointer';
import { simulatedCalibration, SimulatedGazeProvider } from '../providers/simulated/gaze';
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
/** One check in plain words, with up to three earlier ones (other lid angles or seats) to compare against. */
function describeCheck(report: AccuracyReport, earlier: AccuracyRecord[]): string {
  const { posture } = report;
  const now = `Gaze lands ${round(report.meanPx)} px from where you look on average (${round(report.share * 100)}% of the screen width), ` +
    `worst ${round(report.worstPx)} px; left-right ${round(report.meanXPx)} px, up-down ${round(report.meanYPx)} px. ` +
    `Head turned ${round(posture.yawDeg)}°, tilted ${round(posture.pitchDeg)}°.`;
  const before = earlier.slice(-3).map((r) => `${round(r.report.meanPx)} px (tilted ${round(r.report.posture.pitchDeg)}°)`);
  return before.length ? `${now} Earlier checks: ${before.join(', ')}.` : now;
}

const OUTCOMES: Record<Outcome, string> = {
  SELECTED: 'Selected.',
  CONFIRM_AGAIN: 'That one may submit, pay, delete or send. Look away, then dwell on it again to confirm.',
  NEEDS_SECOND_CONFIRM: 'That one needs a second confirm. Nothing was selected.',
  STALE: 'The page changed, so nothing was selected.',
};

/**
 * Side panel controls for gaze: calibrating on the page, aiming with the
 * camera, or, for development, the mouse standing in for the eyes. One at a
 * time. Looking aims; a dwell (one second on a target) confirms and selects it,
 * and a risky target needs a second confirm.
 */
export function gazePanel(marks: PageMarks, targets: LiveTargetList): { element: HTMLElement; useCamera(provider: GazeProvider): void } {
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
  const calibrate = document.createElement('button');
  calibrate.textContent = 'Calibrate on this page';
  const check = document.createElement('button');
  check.textContent = 'Check accuracy';
  const report = (outcome: Outcome) => { status.textContent = OUTCOMES[outcome]; };
  eyes.input.disabled = calibrate.disabled = check.disabled = true;
  let camera: GazeProvider | null = null;
  let active: { session: GazeSession; stop?: () => void } | null = null;

  let generation = 0; // bumps on every stop, so a slow calibration load cannot start a stale session

  const stop = () => {
    generation++;
    active?.session.stop();
    active?.stop?.();
    active = null;
    status.textContent = '';
  };
  /** Aims with the camera through a calibration saved in screen positions. */
  const aimWithEyes = (provider: GazeProvider, store: CalibrationStore) => {
    eyes.input.checked = true;
    active = { session: new GazeSession(provider, new GazeAim(new GazePointer(store)), marks, {
      frameFor: screenFrame, onOutcome: report,
      // Every gaze selection refines the calibration for the posture the user is in now.
      learn: true, onLearned: () => void saveSamples(store.samples),
    }) };
    active.session.start();
    status.textContent = 'Looking aims at the nearest number. Dwell on it for a second to select it.';
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
    status.textContent = 'Look at each dot on the page until it moves. This takes about 16 seconds.';
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
      status.textContent = 'Look at each dot until it moves. This takes about 16 seconds.';
      const samples = await checkOnPage(provider, list);
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
  mouse.input.addEventListener('change', () => {
    stop();
    eyes.input.checked = false;
    if (!mouse.input.checked) return;
    const sim = mouseGaze(targets);
    active = { session: new GazeSession(sim.provider, new GazeAim(new GazePointer(sim.store)), marks, { onOutcome: report }), stop: sim.stop };
    active.session.start();
    void sim.provider.start();
    status.textContent = 'Move the mouse over the page: the nearest number is highlighted. Rest on it for a second to select it.';
  });
  section.append(calibrate, check, eyes.label, mouse.label, status);
  return {
    element: section,
    useCamera(provider) {
      camera = provider;
      eyes.input.disabled = calibrate.disabled = check.disabled = false;
    },
  };
}
