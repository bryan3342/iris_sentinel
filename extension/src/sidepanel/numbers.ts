import type { PageMarks } from './page-marks';

export interface NumbersPanel {
  element: HTMLElement;
  /** Switches the numbers on for the user, as when Iris notices a struggle; the user can switch them off again. */
  turnOn(): void;
}

/** Side panel switch that keeps every target's number drawn on the page, refreshed as the page changes. */
export function numbersPanel(marks: PageMarks): NumbersPanel {
  const label = document.createElement('label');
  label.className = 'numbers-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  label.append(toggle, ' Show numbers on the page');
  toggle.addEventListener('change', () => (toggle.checked ? marks.start() : marks.stop()));
  return {
    element: label,
    turnOn() {
      if (toggle.checked) return;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change')); // the same path as the user's own click
    },
  };
}
