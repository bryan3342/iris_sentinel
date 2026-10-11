import { CalibrationStore, GazeAim, GazePointer, RestingPoint } from '@iris/core';
import type { GazeProvider, Point2, Rect } from '@iris/protocol';
import { GazeCursor } from './gaze-cursor';
import { HeadScroller } from './head-scroll';
import { GazeSession, selectInPage, type Outcome } from './gaze-session';
import type { PageMarks } from './page-marks';
import { loadSamples, saveSamples } from './setup/calibration-storage';
import { calibrateOnPage, screenFrame } from './setup/page-calibration';
import type { LiveTargetList } from './target-list';
import { openByVoice, type OpenResult } from './voice-open';

const screenSize = () => ({ width: screen.width, height: screen.height });

const OUTCOMES: Record<Outcome, string> = {
  SELECTED: 'Selected.',
  NEEDS_DOUBLE_BLINK: 'That one may submit, pay, delete or send, so only a double blink opens it. Nothing was selected.',
  STALE: 'The page changed, so nothing was selected.',
  NO_TARGET: 'Double blink seen, but nothing was outlined under your gaze just before it. Rest your eyes on a link or button until it is outlined, then blink twice.',
};

/** What picking a target by voice led to: ready for the user's double blink, nothing aiming yet, or no such number. */
export type PickResult = 'PICKED_EYES' | 'NO_AIMING' | 'NO_SUCH_NUMBER';

export interface GazePanel {
  element: HTMLElement;
  /** The camera is ready: aiming starts with the calibration saved for this screen, if there is one. */
  useCamera(provider: GazeProvider): void;
  /** Whether a calibration saved for this screen exists. */
  calibrated(): Promise<boolean>;
  /** Runs the calibration dots over the website in the active tab, saves them and aims with them; false when they could not run or finish. */
  calibrate(): Promise<boolean>;
  /** Picks target `id` for the user's next confirm (see GazeSession.arm). */
  pick(id: number): PickResult;
  /** Opens target `id` for a spoken request, a risky one only after the user's confirm (see openByVoice); `seen` is where it was when found. */
  open(id: number, seen?: Rect): Promise<OpenResult>;
  /** Has the user's next double blink on tab `tabId` run `run` (see GazeSession.armAction); false unless the eyes are aiming. */
  confirm(tabId: number, run: () => void): boolean;
  /** Where on the page the eyes rested in the last few seconds, or null. */
  lookedAt(): Point2 | null;
}

/**
 * Eye aiming. It runs whenever the camera is on and a calibration fits this screen, which setup makes
 * sure of: looking aims at the nearest link or button, outlined, while a red ring follows the gaze on the page, a double
 * blink selects, and a risky target opens only with a double blink. Head-tilt scrolling runs alongside
 * it from the same camera samples, and is the one switch left here.
 */
export function gazePanel(marks: PageMarks, targets: LiveTargetList): GazePanel {
  const section = document.createElement('section');
  section.className = 'gaze-aim';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const tiltLabel = document.createElement('label');
  const tilt = document.createElement('input');
  tilt.type = 'checkbox';
  tilt.checked = true;
  tiltLabel.append(tilt, ' Tilt your head to scroll');
  const report = (outcome: Outcome) => { status.textContent = OUTCOMES[outcome]; };
  // The live cursor follows wherever the user looks, on the page itself.
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
  let active: { session: GazeSession; stop: () => void } | null = null;
  const headScroll = new HeadScroller();

  let generation = 0; // bumps on every stop, so a slow calibration load cannot start a stale session

  const stop = () => {
    generation++;
    active?.session.stop();
    active?.stop();
    active = null;
    cursor.stop();
    rest.clear();
    headScroll.stop();
  };
  /** Aims with the camera through a calibration saved in screen positions. */
  const aimWithEyes = (provider: GazeProvider, store: CalibrationStore) => {
    active = { session: new GazeSession(provider, new GazeAim(new GazePointer(store)), marks, {
      frameFor: screenFrame, onOutcome: report, onGaze,
      // Every gaze selection refines the calibration for the posture the user is in now.
      learn: true, onLearned: () => void saveSamples(store.samples),
    }), stop: provider.onSample((sample) => {
      if (tilt.checked) headScroll.update(sample, targets.list?.tabId ?? null);
    }) };
    active.session.start();
    status.textContent = 'Looking aims at the nearest link or button, outlined on the page. Blink twice quickly to select it; looking alone never clicks.';
  };
  /** The calibration saved for this screen, or null. */
  const saved = async (): Promise<CalibrationStore | null> => {
    try {
      const store = new CalibrationStore(await loadSamples(), screenSize());
      return store.model ? store : null;
    } catch { return null; }
  };
  tilt.addEventListener('change', () => {
    if (!tilt.checked) headScroll.stop();
  });
  const pick = (id: number): PickResult => {
    if (!active) return 'NO_AIMING';
    return active.session.arm(id) ? 'PICKED_EYES' : 'NO_SUCH_NUMBER';
  };
  section.append(tiltLabel, status);
  return {
    element: section,
    useCamera(provider) {
      camera = provider;
      // A calibration saved for this screen carries over: aiming resumes by itself, with no new dots.
      const mine = generation;
      void saved().then((store) => {
        if (mine !== generation || active || !store) return;
        aimWithEyes(provider, store);
        status.textContent = 'Aiming with your saved calibration for this screen. Blink twice quickly to select; looking alone never clicks.';
      });
    },
    calibrated: async () => (await saved()) !== null,
    async calibrate() {
      const provider = camera;
      const list = provider && await targets.read().catch(() => null);
      if (!provider || !list) return false;
      stop();
      const mine = generation;
      status.textContent = 'Look at each dot on the page until it moves.';
      try {
        const store = new CalibrationStore();
        store.setDots(await calibrateOnPage(provider, list), screenSize());
        await saveSamples(store.samples);
        if (mine === generation) aimWithEyes(provider, store);
        return true;
      } catch {
        status.textContent = 'Calibration needs your face in view. The dots start again.';
        return false;
      }
    },
    lookedAt: () => (active ? rest.point(performance.now()) : null),
    pick,
    open: (id, seen) => openByVoice(id, seen, { read: () => targets.read(), select: selectInPage, pick }),
    confirm(tabId, run) {
      if (!active) return false; // only a double blink confirms an action, and it needs the eyes aiming
      active.session.armAction(tabId, run);
      return true;
    },
  };
}
