import { companionLink } from '../providers/companion/link';
import {
  bodySignalsView,
  initialBodySignals,
  withLink,
  withQuality,
  withStatus,
  withVitals,
} from './body-signals';

// Side panel section for the Presage companion. Opening the panel connects to
// the companion, and closing the panel ends it, so body sensing only runs while
// Iris is open. What it shows is worked out in body-signals.ts.

/** Side panel section that connects to the companion as soon as it is shown. */
export function companionPanel(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'body-signals';
  // Only the status line is announced to screen readers: the countdown below
  // changes every second and would be read out constantly.
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const camera = document.createElement('p');
  const signals = document.createElement('ul');
  const note = document.createElement('p');
  note.className = 'note';
  section.append(status, camera, signals, note);

  const link = companionLink();
  let state = initialBodySignals(link.state);
  let ticker: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    const view = bodySignalsView(state, performance.now());
    if (status.textContent !== view.status) status.textContent = view.status;
    camera.textContent = view.camera ?? '';
    camera.hidden = view.camera === null;
    signals.replaceChildren(
      ...view.signals.map((line) => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }),
    );
    note.textContent = view.note ?? '';
    note.hidden = view.note === null;
    // Tick once a second only while measuring, for the warm-up countdown and stale readings.
    if (view.signals.length > 0 && ticker === null) ticker = setInterval(render, 1000);
    if (view.signals.length === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };

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
    render();
  });
  render();
  void link.start();
  return section;
}
