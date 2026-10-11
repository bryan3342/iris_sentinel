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
import { playLine, VOICE_LINES } from './voice-lines';

const LISTENING_KEY = 'iris.listening';
const GREETED_KEY = 'iris.greeted';
/** Spoken when the user seems tired. Fixed, so nothing about their body reaches the voice agent. */
export const CHECK_IN = 'Want a hand, or a short break?';
const PROBLEMS: Record<string, string> = {
  MICROPHONE: 'Allow your microphone under Voice setup, and Iris starts listening.',
  AUDIO_BLOCKED: 'Click anywhere in this panel once to turn on listening.',
  GATEWAY_ACCESS: 'Allow Iris on all websites (above), and Iris starts listening.',
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
  /** A conversation is connecting or open. The fatigue card pauses meanwhile. */
  readonly talking: boolean;
}

/** `opening` resolves once the panel's opening animation is over; listening and the greeting wait for it. */
export function conversationPanel(page: { coordinator: PageCoordinator; marks: PageMarks; gaze: GazePanel }, opening: Promise<void> = Promise.resolve()): ConversationPanel {
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = 'Talk to Iris';
  const notice = document.createElement('p');
  notice.textContent = 'Just speak. Iris listens for your voice on this laptop, and only once you start talking does it send microphone audio to ElevenLabs; it hangs up after a minute of quiet. Say things like "scroll down", "go back", "go to the tab with the recipe", "next tab", "open YouTube", "search for the weather", "zoom in", "summarize this", "what is this", "click the sign-in link" or "click number 12". Summaries, descriptions and clicking by description send the visible page to Gemini, and finding a tab sends your open tabs\' titles and site names; their text goes to the voice agent. A link or button you ask for opens at once, but anything that may submit, pay, delete or send, and closing a tab, waits for you to blink twice. Turn off Listening, or close this panel, to stop all microphone use.';
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
  // After the opening animation Iris speaks a fixed line, output only: the full intro (also shown)
  // until it has played once, then "Iris here!". Listening starts after it, so Iris never hears itself.
  void Promise.all([chrome.storage.local.get([LISTENING_KEY, GREETED_KEY]).catch(() => ({} as Record<string, unknown>)), opening]).then(async ([stored]) => {
    listening.checked = stored[LISTENING_KEY] !== false;
    const intro = stored[GREETED_KEY] !== true;
    if (intro) action.textContent = VOICE_LINES.intro;
    if (await playLine(intro ? 'intro' : 'ready') && intro) void chrome.storage.local.set({ [GREETED_KEY]: true }).catch(() => {});
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
  panel.append(title, notice, label, status, action);
  const checkIn = new CheckIn();
  return {
    element: panel,
    onFatigue(state) {
      // Only the level and pause are read. With Listening off, Iris stays quiet.
      if (listening.checked && checkIn.update(state, performance.now(), handsFree.talking)) handsFree.greet(CHECK_IN);
    },
    get talking() {
      return handsFree.talking;
    },
  };
}
