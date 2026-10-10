import { CalibrationStore, GazeAim, GazePointer } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';
import { pagePointer } from '../content/pointer';
import { simulatedCalibration, SimulatedGazeProvider } from '../providers/simulated/gaze';
import { GazeSession } from './gaze-session';
import type { PageMarks } from './page-marks';
import { loadSamples, saveSamples } from './setup/calibration-storage';
import { calibrateOnPage, screenFrame } from './setup/page-calibration';
import type { LiveTargetList } from './target-list';

const POINTER_POLL_MS = 50;
const screenSize = () => ({ width: screen.width, height: screen.height });

/** Development only: the mouse over the browsing tab stands in for the eyes, with a perfect calibration. */
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

/**
 * Side panel controls for aiming at page targets with gaze: calibrating on the
 * page, aiming with the camera, or, for development, the mouse standing in for
 * the eyes. One at a time. Looking only aims; nothing is clicked.
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
  const mouse = toggle('Developer: the mouse stands in for the eyes');
  const calibrate = document.createElement('button');
  calibrate.textContent = 'Calibrate on this page';
  eyes.input.disabled = calibrate.disabled = true;
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
    active = { session: new GazeSession(provider, new GazeAim(new GazePointer(store)), marks, screenFrame) };
    active.session.start();
    status.textContent = 'Looking aims at the nearest number. Nothing is clicked.';
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
  mouse.input.addEventListener('change', () => {
    stop();
    eyes.input.checked = false;
    if (!mouse.input.checked) return;
    const sim = mouseGaze(targets);
    active = { session: new GazeSession(sim.provider, new GazeAim(new GazePointer(sim.store)), marks), stop: sim.stop };
    active.session.start();
    void sim.provider.start();
    status.textContent = 'Move the mouse over the page: the nearest number is highlighted. Nothing is clicked.';
  });
  section.append(calibrate, eyes.label, mouse.label, status);
  return {
    element: section,
    useCamera(provider) {
      camera = provider;
      eyes.input.disabled = calibrate.disabled = false;
    },
  };
}
