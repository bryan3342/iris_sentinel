import type { PageMarks } from './page-marks';

/**
 * Side panel switch that keeps every target's number drawn on the page, refreshed as the page changes.
 * Off at first: aiming with the eyes needs no numbers, only for naming a target by its number.
 */
export function numbersPanel(marks: PageMarks): HTMLElement {
  const label = document.createElement('label');
  label.className = 'numbers-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  label.append(toggle, ' Show numbers on the page');
  toggle.addEventListener('change', () => {
    marks.showNumbers(toggle.checked);
    if (toggle.checked) marks.start();
    else marks.stop();
  });
  return label;
}
