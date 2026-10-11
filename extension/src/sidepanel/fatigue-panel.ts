import { FatigueEngine, type FatigueState } from '@iris/core';
import type { FaceProvider, Unsubscribe, VitalsProvider } from '@iris/protocol';
import type { LinkState } from '../providers/companion/link';
import { DEMO_WARM_UP, SimulatedBodyProvider, TIRING_DEMO } from '../providers/simulated/body';
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

export function fatiguePanel({ now = () => performance.now(), body = demoBody, live, onFatigue }: FatiguePanelOptions = {}): HTMLElement {
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
  const why = document.createElement('ul');
  const response = document.createElement('p');
  section.append(heading, play, coverLabel, status, why, response);

  let run: Run | null = null;
  let state: FatigueState | null = null;

  const render = () => {
    const view = fatigueView(state);
    if (status.textContent !== view.status) status.textContent = view.status;
    why.replaceChildren(
      ...view.why.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );
    response.textContent = view.response ?? '';
    response.hidden = view.response === null;
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
      state = engine.update(now());
      if (liveSource) onFatigue?.(state);
      render();
    }, 1_000);
    run = { source, live: Boolean(liveSource), stops, timer };
    if (!liveSource) void source.start();
    render();
  };

  const stop = () => {
    if (!run) return;
    if (!run.live) run.source.stop();
    run.stops.forEach((unsubscribe) => unsubscribe());
    clearInterval(run.timer);
    run = null;
    state = null;
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
