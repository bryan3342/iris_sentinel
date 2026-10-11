import { FatigueEngine, type FatigueState } from '@iris/core';
import type { FaceProvider, Unsubscribe, VitalsProvider } from '@iris/protocol';
import type { LinkState } from '../providers/companion/link';
import { DEMO_WARM_UP, SimulatedBodyProvider, TIRING_DEMO } from '../providers/simulated/body';
import { addToSession, emptySession, type FatigueSession } from './fatigue-session';
import { fatigueView } from './fatigue-view';

// Side panel section that runs the fatigue engine on a body source and shows
// what it concludes. While the Presage companion is connected, the source is
// its live readings, and each result also goes to `onFatigue` (the voice
// check-in). Otherwise Play runs the simulated body: a scripted user who is
// rested for a minute and then tires, so the whole chain can be seen without a
// camera, and "Cover camera" stands in for the face leaving the view. Simulated
// results only show on the card; they never reach `onFatigue`. Every input is
// stamped on the side panel clock when it arrives, so all of them share one clock. Nothing here is logged, stored or
// sent; what the card shows describes body readings and stays on screen.

export type BodySource = FaceProvider & VitalsProvider;

export interface FatiguePanelOptions {
  /** Whether a voice conversation is open; fatigue pauses while it is, and for a while after. */
  talking?: () => boolean;
  /** The side panel clock, in milliseconds. */
  now?: () => number;
  /** Makes the body source for one run. `covered` tells whether the camera is covered. */
  body?: (covered: () => boolean) => BodySource;
  /** The companion link, used as the source whenever it is connected. It is started and stopped elsewhere. */
  live?: BodySource & { readonly state: LinkState; onState(listener: (state: LinkState) => void): Unsubscribe };
  /** Called with each result from live readings. Only the level and pause may be used beyond the card. */
  onFatigue?: (state: FatigueState) => void;
}

const demoBody = (covered: () => boolean): BodySource =>
  new SimulatedBodyProvider({ tiredness: TIRING_DEMO, warmUp: DEMO_WARM_UP, quality: () => (covered() ? 'no-face' : 'ok') });

interface Run {
  source: BodySource;
  live: boolean;
  stops: Unsubscribe[];
  timer: ReturnType<typeof setInterval>;
}

export function fatiguePanel({ now = () => performance.now(), body = demoBody, live, onFatigue, talking = () => false }: FatiguePanelOptions = {}): HTMLElement {
  const section = document.createElement('section');
  section.className = 'fatigue';
  const heading = document.createElement('h2');
  heading.textContent = 'Fatigue (demo, simulated signals)';
  const play = document.createElement('button');
  const coverLabel = document.createElement('label');
  const cover = document.createElement('input');
  cover.type = 'checkbox';
  coverLabel.append(cover, ' Cover camera');
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
  section.append(heading, play, coverLabel, status, progress, why, signals, response, summary, note);

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
    const view = fatigueView(state, { running: run !== null, session, mode: run?.live === false ? 'demo' : 'live' });
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
    play.textContent = run ? 'Stop demo' : 'Play demo';
    heading.textContent = run?.live ? 'Fatigue (live, from Presage)' : 'Fatigue (demo, simulated signals)';
    play.hidden = coverLabel.hidden = Boolean(run?.live);
  };

  const start = (liveSource?: BodySource) => {
    const engine = new FatigueEngine();
    const source = liveSource ?? body(() => cover.checked);
    const stamp = <T extends { t: number }>(value: T): T => ({ ...value, t: now() });
    const stops = [
      source.onQuality((status) => engine.setQuality(stamp(status))),
      source.onBlink((blink) => engine.addBlink(stamp(blink))),
      source.onVitals((sample) => engine.addVitals(stamp(sample))),
    ];
    const timer = setInterval(() => {
      engine.setTalking(now(), talking());
      state = engine.update(now());
      session = addToSession(session ?? emptySession(), state);
      if (liveSource) onFatigue?.(state);
      render();
    }, 1_000);
    run = { source, live: Boolean(liveSource), stops, timer };
    session = emptySession(now());
    if (!liveSource) void source.start();
    render();
  };

  const stop = () => {
    if (!run) return;
    if (!run.live) run.source.stop();
    run.stops.forEach((unsubscribe) => unsubscribe());
    clearInterval(run.timer);
    run = null;
    state = null; // the session summary stays on screen as the result
    render();
  };

  play.addEventListener('click', () => (run ? stop() : start()));
  // Live readings take over from the demo while the companion is connected.
  const follow = (state: LinkState) => {
    if (state === 'connected' && live && !run?.live) { stop(); start(live); }
    if (state !== 'connected' && run?.live) stop();
  };
  if (live) { live.onState(follow); follow(live.state); }
  render();
  return section;
}
