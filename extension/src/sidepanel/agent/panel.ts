import { CheckIn, type FatigueState } from '@iris/core';
import { validateTabMatch } from '@iris/protocol';
import { broker, type PageCoordinator } from '../../page-understanding/coordinator';
import { GATEWAY } from '../../page-understanding/gateway';
import { watchPageAccess } from '../setup/page-access';
import { elevenLabsVoice } from './elevenlabs';
import type { GazePanel } from '../gaze-panel';
import type { PageMarks } from '../page-marks';
import { HandsFree, type HandsFreeStatus } from './hands-free';
import { micLevels } from './mic-level';
import { navigationTools } from './navigation';
import { browserTools } from './tools';
import { playLine } from './voice-lines';

const LISTENING_KEY = 'iris.listening';
/** Spoken when the user seems tired. Fixed, so nothing about their body reaches the voice agent. */
export const CHECK_IN = 'Want a hand, or a short break?';
/** Spoken when heart rate or breathing suddenly rise well above the user's resting level. Fixed, like CHECK_IN. */
export const STRUGGLE = 'We can see there is a sort of struggle here.';
const PROBLEMS: Record<string, string> = {
  MICROPHONE: 'Allow your microphone under Voice setup, and Iris starts listening.',
  AUDIO_BLOCKED: 'Click anywhere in this panel once to turn on listening.',
  GATEWAY_ACCESS: 'Allow Iris on all websites when setup asks, and Iris starts listening.',
};

function describe(status: HandsFreeStatus): string {
  switch (status.kind) {
    case 'off': return 'Listening is off. The microphone is not in use.';
    case 'waiting': return 'Just speak: Iris is waiting for your voice.';
    case 'connecting': return 'Connecting...';
    case 'talking': return status.state === 'speaking' ? 'Iris is speaking.' : 'Iris is listening.';
    case 'problem': return PROBLEMS[status.code] ?? `${status.code}. Iris tries again in 30 seconds; check the local server and ElevenLabs setup.`;
  }
}

export interface ConversationPanel {
  element: HTMLElement;
  /** Takes each live fatigue result; Iris checks in by voice when the user seems tired (see CheckIn). */
  onFatigue(state: FatigueState): void;
  /** Heart rate or breathing suggest a struggle (see StruggleDetector): Iris says so, unless Listening is off. */
  onStruggle(): void;
  /** A conversation is connecting or open. The fatigue card pauses meanwhile. */
  readonly talking: boolean;
}

/**
 * `opening` settles once the opening animation and setup are over, saying whether Iris already spoke
 * during them; listening and the greeting wait for it, so Iris never hears its own setup lines.
 */
export function conversationPanel(page: { coordinator: PageCoordinator; marks: PageMarks; gaze: GazePanel },
  opening: Promise<{ spoke: boolean }> = Promise.resolve({ spoke: false })): ConversationPanel {
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = 'Talk to Iris';
  const label = document.createElement('label');
  const listening = document.createElement('input'); listening.type = 'checkbox';
  label.append(listening, ' Listening');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const action = document.createElement('p'); action.setAttribute('aria-live', 'polite');
  const report = (said: string) => { action.textContent = said; };
  const handsFree = new HandsFree({
    agent: elevenLabsVoice,
    tools: {
      ...browserTools({ ...page, report }),
      ...navigationTools({
        // The background asks the Iris server; the answer is checked again here before any tab changes.
        matchTab: async (input) => validateTabMatch(await broker({ type: 'iris.tabs.match', input }), input),
        confirm: (tabId, run) => page.gaze.confirm(tabId, run),
        report,
      }),
    },
    listen: micLevels,
    // Access to the local server comes from the one-time page access grant: no prompt without a click.
    getUrl: async () => {
      if (!await chrome.permissions.contains({ origins: [`${GATEWAY}/*`] })) throw new Error('GATEWAY_ACCESS');
      return (await broker({ type: 'iris.voice.session' }) as { signedUrl: string }).signedUrl;
    },
    onStatus: (s) => { status.textContent = describe(s); },
  });
  // Listening is on unless the person turned it off, and stays off across panel openings if they did.
  // After setup Iris says "Iris here!", output only, unless it has just spoken during setup; listening
  // starts after that, so Iris never hears itself.
  void Promise.all([chrome.storage.local.get(LISTENING_KEY).catch(() => ({} as Record<string, unknown>)), opening]).then(async ([stored, { spoke }]) => {
    listening.checked = stored[LISTENING_KEY] !== false;
    if (!spoke) await playLine('ready');
    handsFree.setOn(listening.checked);
  });
  listening.addEventListener('change', () => {
    void chrome.storage.local.set({ [LISTENING_KEY]: listening.checked }).catch(() => {});
    handsFree.setOn(listening.checked);
  });
  // Pick up again as soon as the person fixes what stopped listening.
  panel.ownerDocument.addEventListener('pointerdown', () => handsFree.retry());
  watchPageAccess((granted) => { if (granted) handsFree.retry(); });
  void navigator.permissions.query({ name: 'microphone' as PermissionName }).then((permission) => {
    permission.addEventListener('change', () => { if (permission.state === 'granted') handsFree.retry(); });
  }, () => {});
  addEventListener('pagehide', () => handsFree.setOn(false), { once: true });
  panel.append(title, label, status, action);
  const checkIn = new CheckIn();
  return {
    element: panel,
    onFatigue(state) {
      // Only the level and pause are read. With Listening off, Iris stays quiet.
      if (listening.checked && checkIn.update(state, performance.now(), handsFree.talking)) handsFree.greet(CHECK_IN);
    },
    onStruggle() {
      // Nothing about the readings is said or sent: only this fixed line. With Listening off, Iris stays quiet.
      if (listening.checked && !handsFree.talking) handsFree.greet(STRUGGLE);
    },
    get talking() {
      return handsFree.talking;
    },
  };
}
