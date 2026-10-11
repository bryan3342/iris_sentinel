import type { Point2, PointerProvider } from '@iris/protocol';
import { FINGER_CURSOR_PORT } from '../content/overlay';
import { FingerPointer } from './finger-pointer';
import { GazeCursor } from './gaze-cursor';
import type { GazePanel } from './gaze-panel';
import type { TargetList } from './target-list';

export interface FingerPanel {
  element: HTMLElement;
  /** Switches finger tracing on for the user, as when Iris notices a struggle; the user can switch it off again. */
  turnOn(): void;
}

export interface FingerPanelDeps {
  /** Makes the hand tracker on the camera video; called once, the first time tracing is switched on. */
  makeProvider: () => PointerProvider;
  /** The live target list of the page in view, or null without one. */
  list: () => TargetList | null;
  gaze: Pick<GazePanel, 'pointWith' | 'pinch'>;
  /** The blue finger ring on the page. */
  cursor?: { move(tabId: number, at: Point2 | null): void; stop(): void };
}

/**
 * Side panel switch for finger tracing, off at first. While it is on, the hand tracker reads the
 * camera, a blue ring follows the index fingertip on the page, the finger aims while a hand is in
 * view, and a pinch clicks (see FingerPointer); anything that may submit, pay, delete or send still
 * needs a double blink. The hand model loads the first time it is switched on.
 */
export function fingerPanel({ makeProvider, list, gaze, cursor = new GazeCursor(FINGER_CURSOR_PORT) }: FingerPanelDeps): FingerPanel {
  const element = document.createElement('div');
  element.className = 'finger-tracing';
  const label = document.createElement('label');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  label.append(toggle, ' Trace my finger (pinch to click)');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.hidden = true;
  element.append(label, status);

  let provider: PointerProvider | null = null;
  let pointer: FingerPointer | null = null;

  const on = () => {
    status.hidden = true;
    const hands = (provider ??= makeProvider());
    pointer ??= new FingerPointer({
      provider: hands, list,
      ring: (tabId, at) => cursor.move(tabId, at),
      aim: (target) => gaze.pointWith(target),
      pinch: (t, target) => gaze.pinch(t, target),
    });
    const following = pointer;
    hands.start().then(() => {
      // Switched off while the model loaded: the tracker stays off (see stop), and so does following.
      if (toggle.checked) following.start();
    }, () => {
      toggle.checked = false;
      status.textContent = 'Finger tracing could not start. Try again, or reopen the side panel.';
      status.hidden = false;
    });
  };
  const off = () => {
    pointer?.end();
    provider?.stop();
    cursor.stop();
  };
  toggle.addEventListener('change', () => (toggle.checked ? on() : off()));

  return {
    element,
    turnOn() {
      if (toggle.checked) return;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change')); // the same path as the user's own click
    },
  };
}
