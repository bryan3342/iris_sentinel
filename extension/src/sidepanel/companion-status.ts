import { companionLink, type CompanionLink } from '../providers/companion/link';
import {
  type BodyAction,
  bodySignalsView,
  ESTIMATES_NOTE,
  initialBodySignals,
  withLink,
  withQuality,
  withStatus,
  withVitals,
} from './body-signals';
import { vitalsGraph } from './vitals-graph';
import { emptyGraph, graphView, withGraphSample } from './vitals-graph-view';

// Side panel section for the Presage companion. Body signals stay off until the
// user presses Start, because every Presage session uses credits (1 credit is 30
// seconds of measuring). Stop, or closing the panel, ends the companion and
// Presage with it, so body sensing only runs while Iris is open. What it shows
// is worked out in body-signals.ts, and its heart rate and breathing graph in
// vitals-graph-view.ts. The graph outlasts Stop, to look back on, until Start.

/** Side panel section with the body signals and a button to start or stop them. */
export function companionPanel(link: CompanionLink = companionLink()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'body-signals';
  // Only the status line is announced to screen readers: the countdown below
  // changes every second and would be read out constantly.
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const button = document.createElement('button');
  const camera = document.createElement('p');
  const signals = document.createElement('ul');
  const note = document.createElement('p');
  note.className = 'note';
  const graph = vitalsGraph();
  section.append(status, button, camera, signals, graph.element, note);

  let state = initialBodySignals(link.state);
  let history = emptyGraph();
  let action: BodyAction | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    const view = bodySignalsView(state, performance.now());
    if (status.textContent !== view.status) status.textContent = view.status;
    action = view.action;
    button.textContent = action === 'stop' ? 'Stop body signals' : 'Start body signals';
    button.hidden = action === null;
    camera.textContent = view.camera ?? '';
    camera.hidden = view.camera === null;
    signals.replaceChildren(
      ...view.signals.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );
    // The note stays as long as the graph does, which can outlast measuring.
    const noteText = view.note ?? (graph.element.hidden ? null : ESTIMATES_NOTE);
    note.textContent = noteText ?? '';
    note.hidden = noteText === null;
    // Tick once a second only while measuring, for the warm-up countdown and stale readings.
    if (view.signals.length > 0 && ticker === null) ticker = setInterval(render, 1000);
    if (view.signals.length === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };

  button.addEventListener('click', () => {
    if (action === 'stop') {
      link.stop();
      return;
    }
    // After a reported problem the old connection can still be open, so close
    // it first: starting again means a fresh companion, a fresh Presage session
    // and a fresh graph.
    link.stop();
    history = emptyGraph();
    graph.draw(null);
    void link.start();
  });

  link.onState((linkState) => {
    state = withLink(state, linkState);
    render();
  });
  link.onStatus((companion) => {
    state = withStatus(state, companion, performance.now());
    render();
  });
  link.onQuality((quality) => {
    state = withQuality(state, quality);
    render();
  });
  link.onVitals((sample) => {
    state = withVitals(state, sample);
    history = withGraphSample(history, sample);
    graph.draw(graphView(history));
    render();
  });
  render();
  return section;
}
