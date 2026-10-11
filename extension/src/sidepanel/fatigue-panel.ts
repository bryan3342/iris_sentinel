import { FatigueEngine, type FatigueState } from '@iris/core';
import type { FaceProvider, Unsubscribe, VitalsProvider } from '@iris/protocol';
import type { LinkState } from '../providers/companion/link';
import { addToSession, emptySession, type FatigueSession } from './fatigue-session';
import { fatigueView } from './fatigue-view';

// Side panel section that runs the fatigue engine on the Presage companion's
// live readings while it is connected, shows what it concludes, and passes each
// result to `onFatigue` (the voice check-in). It waits until the user starts
// body signals, which stay off until then to save Presage credits. Every input
// is stamped on the side panel clock when it arrives, so all of them share one
// clock. Nothing here is logged, stored or sent; what the card shows describes
// body readings and stays on screen.

export type BodySource = FaceProvider & VitalsProvider;

export interface FatiguePanelOptions {
  /** Whether a voice conversation is open; fatigue pauses while it is, and for a while after. */
  talking?: () => boolean;
  /** The side panel clock, in milliseconds. */
  now?: () => number;
  /** The companion link, the source whenever it is connected. It is started and stopped elsewhere. */
  live: BodySource & { readonly state: LinkState; onState(listener: (state: LinkState) => void): Unsubscribe };
  /** Called with each result. Only the level and pause may be used beyond the card. */
  onFatigue?: (state: FatigueState) => void;
}

interface Run {
  stops: Unsubscribe[];
  timer: ReturnType<typeof setInterval>;
}

export function fatiguePanel({ now = () => performance.now(), live, onFatigue, talking = () => false }: FatiguePanelOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'fatigue';
  const heading = document.createElement('h2');
  heading.textContent = 'Fatigue';
  // Only the level line is announced: the reasons change often and would be read out constantly.
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const progress = document.createElement('p');
  progress.className = 'note progress';
  const why = document.createElement('ul');
  why.className = 'why';
  const signals = document.createElement('ul');
  signals.className = 'signals';
  const response = document.createElement('p');
  const summary = document.createElement('ul');
  summary.className = 'summary';
  const note = document.createElement('p');
  note.className = 'note';
  section.append(heading, status, progress, why, signals, response, summary, note);

  let run: Run | null = null;
  let state: FatigueState | null = null;
  /** Scores and levels of the current run, or of the last one once stopped: shown as its summary. */
  let session: FatigueSession | null = null;

  const lines = (list: HTMLUListElement, items: string[]) =>
    list.replaceChildren(
      ...items.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );

  const render = () => {
    const view = fatigueView(state, { running: run !== null, session });
    if (status.textContent !== view.status) status.textContent = view.status;
    progress.textContent = view.progress ?? '';
    progress.hidden = view.progress === null;
    lines(why, view.why);
    lines(signals, view.signals);
    lines(summary, view.summary);
    response.textContent = view.response ?? '';
    response.hidden = view.response === null;
    note.textContent = view.note ?? '';
    note.hidden = view.note === null;
  };

  const start = () => {
    const engine = new FatigueEngine();
    const stamp = <T extends { t: number }>(value: T): T => ({ ...value, t: now() });
    const stops = [
      live.onQuality((status) => engine.setQuality(stamp(status))),
      live.onBlink((blink) => engine.addBlink(stamp(blink))),
      live.onVitals((sample) => engine.addVitals(stamp(sample))),
    ];
    const timer = setInterval(() => {
      engine.setTalking(now(), talking());
      state = engine.update(now());
      session = addToSession(session ?? emptySession(), state);
      onFatigue?.(state);
      render();
    }, 1_000);
    run = { stops, timer };
    session = emptySession(now());
    render();
  };

  const stop = () => {
    if (!run) return;
    run.stops.forEach((unsubscribe) => unsubscribe());
    clearInterval(run.timer);
    run = null;
    state = null; // the session summary stays on screen as the result
    render();
  };

  // A run lasts as long as the companion stays connected.
  const follow = (state: LinkState) => {
    if (state === 'connected' && !run) start();
    if (state !== 'connected' && run) stop();
  };
  live.onState(follow);
  follow(live.state);
  render();
  return section;
}
