import type { LightAdvice } from '@iris/core';
import type { GazeProvider } from '@iris/protocol';
import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { companionLink } from '../providers/companion/link';
import { companionPanel } from './companion-status';
import { fatiguePanel } from './fatigue-panel';
import { cameraAllowed, isExtensionPage, openCamera, watchCamera } from './setup/camera';
import { gazePanel, type GazePanel } from './gaze-panel';
import { numbersPanel } from './numbers';
import { PageMarks } from './page-marks';
import { hasPageAccess, requestPageAccess, watchPageAccess } from './setup/page-access';
import { LiveTargetList } from './target-list';
import { EyeTrace } from './trace';
import { microphonePanel } from './setup/microphone';
import { conversationPanel } from './agent/panel';
import { playLine } from './agent/voice-lines';
import { PageCoordinator } from '../page-understanding/coordinator';
import { brandHeader } from './brand';
import { firstOpenSplash } from './splash';
import { faceSteady } from './setup/calibration';
import { runSetup, type SetupDeps } from './setup/first-run';
import { slidesView } from './setup/slides';

const SETUP_KEY = 'iris.setupDone';
/** Calibration draws its dots on a website; this calm page is opened for it when no website is showing. */
const CALIBRATION_PAGE = 'https://www.wikipedia.org/';
const PAGE_WAIT_MS = 15_000;

/** Builds the side panel UI. Shared by the extension and the playground. */
export function mountPanel(root: HTMLElement): void {
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.append(video);

  const status = document.createElement('p');
  status.className = 'status';
  status.textContent = 'Starting camera...';

  root.replaceChildren(brandHeader(), preview, status);
  const targets = new LiveTargetList();
  const marks = new PageMarks(targets);
  const gaze = gazePanel(marks, targets);
  const camera = startCamera(video, preview, root, status);
  camera.then((provider) => gaze.useCamera(provider), (error: unknown) => {
    status.textContent = 'Eye tracking failed to start.';
    console.error('Iris: eye tracking failed', error);
  });
  if (isExtensionPage()) {
    // One page understanding coordinator for the voice tools: one request at a time.
    const coordinator = new PageCoordinator({ afterCapture: () => marks.redraw() });
    addEventListener('pagehide', () => coordinator.cancel(), { once: true }); // closing the panel ends a pending request
    // The first opening ever starts with the Iris animation and setup; listening waits for both, and
    // still starts if setup could not finish (eye tracking failing to load, say), since voice needs no camera.
    const setup = firstOpenSplash(document.body)
      .then(() => runSetup(slidesView(document.body), setupDeps(gaze, camera, targets)))
      .catch(() => ({ spoke: false }));
    const voice = conversationPanel({ coordinator, marks, gaze }, setup);
    // One companion link: its card shows the readings, and the fatigue card turns them into a level for voice check-ins.
    const link = companionLink();
    root.append(microphonePanel(), voice.element, numbersPanel(marks), gaze.element,
      companionPanel(link), fatiguePanel({ live: link, onFatigue: (state) => voice.onFatigue(state), talking: () => voice.talking }));
  }
}

// Tracking keeps working in poor light, more slowly and less precisely, so these only suggest a fix.
const LIGHT_ADVICE: Record<NonNullable<LightAdvice>, string> = {
  dim: 'Your face is too dark for steady tracking. Turn on a light in front of you.',
  backlit: 'There is bright light behind you, so your face is in shadow. Face the light, or close the blind behind you.',
  bright: 'Your face is washed out by bright light. Dim the light pointed at you.',
};

const CAMERA_RETRY_MS = 3_000;

/**
 * Starts eye tracking. Without camera access it waits until access is allowed (setup asks for it);
 * with access but no picture, as when another app is using the camera, it tries again every few seconds.
 */
async function startCamera(video: HTMLVideoElement, preview: HTMLElement, root: HTMLElement, status: HTMLElement): Promise<MediaPipeGazeProvider> {
  for (;;) {
    try {
      video.srcObject = await openCamera();
      break;
    } catch {
      if (await cameraAllowed()) {
        status.textContent = 'The camera is busy or unavailable. Trying again.';
        await new Promise((resolve) => setTimeout(resolve, CAMERA_RETRY_MS));
        continue;
      }
      status.textContent = 'Camera is off.';
      await new Promise<void>((resolve) => {
        const stop = watchCamera(() => void cameraAllowed().then((allowed) => {
          if (!allowed) return;
          stop();
          resolve();
        }));
      });
    }
  }
  return startTracking(video, preview, root, status);
}

async function startTracking(
  video: HTMLVideoElement,
  preview: HTMLElement,
  root: HTMLElement,
  status: HTMLElement,
): Promise<MediaPipeGazeProvider> {
  status.textContent = 'Loading eye tracking...';
  const provider = new MediaPipeGazeProvider(video);
  const trace = new EyeTrace(video);
  preview.append(trace.overlay);
  root.append(trace.readout);
  provider.onTracePoints((points) => trace.drawPoints(points));
  provider.onSample((sample) => trace.addSample(sample));
  await provider.start();
  const ON = 'Eye tracking on. Processing stays on this computer.';
  status.textContent = ON;
  provider.onLight((advice) => { status.textContent = advice ? LIGHT_ADVICE[advice] : ON; });
  return provider;
}

/** Resolves once `ready` says yes, checking a few times a second, or after `ms` either way. */
async function until(ready: () => Promise<boolean>, ms: number): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end && !(await ready());) await new Promise((resolve) => setTimeout(resolve, 250));
}

/** Setup's view of the browser: Iris's voice, camera and website access, and calibration. */
function setupDeps(gaze: GazePanel, camera: Promise<GazeProvider>, targets: LiveTargetList): SetupDeps {
  const website = async () => (await targets.read().catch(() => null)) !== null;
  let calibrationTab: number | undefined;
  return {
    say: (line) => playLine(line),
    access: async () => ({ camera: await cameraAllowed(), websites: await hasPageAccess() }),
    onAccessChange(listener) {
      const stopWebsites = watchPageAccess(() => listener());
      const stopCamera = watchCamera(listener);
      return () => { stopWebsites(); stopCamera(); };
    },
    askCamera: () => void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') }),
    askWebsites: () => void requestPageAccess().catch(() => false),
    calibrated: () => gaze.calibrated(),
    async calibrate() {
      const provider = await camera;
      if (!(await website())) {
        // The tab opened for an earlier try is shown again rather than opening another.
        const reopened = calibrationTab === undefined ? undefined
          : await chrome.tabs.update(calibrationTab, { active: true }).catch(() => undefined);
        calibrationTab = reopened?.id ?? (await chrome.tabs.create({ url: CALIBRATION_PAGE, active: true }).catch(() => undefined))?.id;
        await until(website, PAGE_WAIT_MS);
      }
      await faceSteady(provider);
      return gaze.calibrate();
    },
    done: async () => (await chrome.storage.local.get(SETUP_KEY).catch(() => ({} as Record<string, unknown>)))[SETUP_KEY] === true,
    markDone: () => chrome.storage.local.set({ [SETUP_KEY]: true }).catch(() => {}),
  };
}
