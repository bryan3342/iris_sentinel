import type { LightAdvice } from '@iris/core';
import { MediaPipeGazeProvider } from '../providers/mediapipe/provider';
import { companionLink } from '../providers/companion/link';
import { companionPanel } from './companion-status';
import { fatiguePanel } from './fatigue-panel';
import { isExtensionPage, openCamera } from './setup/camera';
import { gazePanel } from './gaze-panel';
import { numbersPanel } from './numbers';
import { PageMarks } from './page-marks';
import { pageAccessPanel } from './setup/page-access';
import { LiveTargetList } from './target-list';
import { EyeTrace } from './trace';
import { microphonePanel } from './setup/microphone';
import { conversationPanel } from './agent/panel';
import { PageCoordinator } from '../page-understanding/coordinator';
import { brandHeader } from './brand';
import { firstOpenSplash } from './splash';

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
  if (isExtensionPage()) {
    // One page understanding coordinator for the voice tools: one request at a time.
    const coordinator = new PageCoordinator({ afterCapture: () => marks.redraw() });
    addEventListener('pagehide', () => coordinator.cancel(), { once: true }); // closing the panel ends a pending request
    // The first opening ever starts with the Iris animation; the spoken intro follows it.
    const voice = conversationPanel({ coordinator, marks, gaze }, firstOpenSplash(document.body));
    // One companion link: its card shows the readings, and the fatigue card turns them into a level for voice check-ins.
    const link = companionLink();
    root.append(microphonePanel(), voice.element, pageAccessPanel(), numbersPanel(marks), gaze.element,
      companionPanel(link), fatiguePanel({ live: link, onFatigue: (state) => voice.onFatigue(state), talking: () => voice.talking }));
  }

  openCamera()
    .then((stream) => {
      video.srcObject = stream;
      return startTracking(video, preview, root, status);
    })
    .then((provider) => gaze.useCamera(provider))
    .catch((error: unknown) => {
      if (video.srcObject) {
        status.textContent = 'Eye tracking failed to start.';
        console.error('Iris: eye tracking failed', error);
        return;
      }
      status.textContent = 'Camera is off.';
      if (isExtensionPage()) root.append(grantButton());
    });
}

// Tracking keeps working in poor light, more slowly and less precisely, so these only suggest a fix.
const LIGHT_ADVICE: Record<NonNullable<LightAdvice>, string> = {
  dim: 'Your face is too dark for steady tracking. Turn on a light in front of you.',
  backlit: 'There is bright light behind you, so your face is in shadow. Face the light, or close the blind behind you.',
  bright: 'Your face is washed out by bright light. Dim the light pointed at you.',
};

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

function grantButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Allow camera';
  button.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  });
  return button;
}
