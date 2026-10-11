import { broker, type PageCoordinator } from '../../page-understanding/coordinator';
import { GATEWAY } from '../../page-understanding/gateway';
import { watchPageAccess } from '../setup/page-access';
import { elevenLabsVoice } from './elevenlabs';
import type { GazePanel } from '../gaze-panel';
import type { PageMarks } from '../page-marks';
import { HandsFree, type HandsFreeStatus } from './hands-free';
import { micLevels } from './mic-level';
import { browserTools } from './tools';

const LISTENING_KEY = 'iris.listening';
const GREETED_KEY = 'iris.greeted';
/** Spoken the first time the panel ever opens (and shown, in case Chrome holds back the sound). */
export const INTRO = "Hi, I'm Iris. I help you browse the web hands-free. Look at a link or button to aim at it, and blink twice to open it. Tilt your head to scroll. Or just talk to me: say scroll down, go back, summarize this, or click number 12. Whenever you need me, just speak.";
/** Spoken on every later opening. */
export const READY = 'Iris is ready.';
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

export function conversationPanel(page: { coordinator: PageCoordinator; marks: PageMarks; gaze: GazePanel }): HTMLElement {
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = 'Talk to Iris';
  const notice = document.createElement('p');
  notice.textContent = 'Just speak. Iris listens for your voice on this laptop, and only once you start talking does it send microphone audio to ElevenLabs; it hangs up after a minute of quiet. Say things like "scroll down", "go to the top", "go back", "summarize this", "what is this", "find the sign-in link" or "click number 12". Summaries and descriptions send the visible page to Gemini and their text to the voice agent. Iris never clicks on its own: a found or named number is selected, and you open it by blinking twice. Turn off Listening, or close this panel, to stop all microphone use.';
  const label = document.createElement('label');
  const listening = document.createElement('input'); listening.type = 'checkbox';
  label.append(listening, ' Listening');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const action = document.createElement('p'); action.setAttribute('aria-live', 'polite');
  const handsFree = new HandsFree({
    agent: elevenLabsVoice,
    tools: browserTools({ ...page, report: (said) => { action.textContent = said; } }),
    listen: micLevels,
    // Access to the local server comes from the one-time page access grant: no prompt without a click.
    getUrl: async () => {
      if (!await chrome.permissions.contains({ origins: [`${GATEWAY}/*`] })) throw new Error('GATEWAY_ACCESS');
      return (await broker({ type: 'iris.voice.session' }) as { signedUrl: string }).signedUrl;
    },
    onStatus: (s) => {
      status.textContent = describe(s);
      if (s.kind === 'talking' && introPending) {
        introPending = false;
        void chrome.storage.local.set({ [GREETED_KEY]: true }).catch(() => {});
      }
    },
  });
  let introPending = false;
  // Listening is on unless the person turned it off, and stays off across panel openings if they did.
  // Iris greets on opening, unless listening is off: the full intro once, until it has been heard.
  void chrome.storage.local.get([LISTENING_KEY, GREETED_KEY]).catch(() => ({} as Record<string, unknown>)).then((stored) => {
    listening.checked = stored[LISTENING_KEY] !== false;
    handsFree.setOn(listening.checked);
    if (!listening.checked) return;
    introPending = stored[GREETED_KEY] !== true;
    if (introPending) action.textContent = INTRO;
    handsFree.greet(introPending ? INTRO : READY);
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
  return panel;
}
