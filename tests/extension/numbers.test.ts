// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { numbersPanel } from '../../extension/src/sidepanel/numbers';
import type { PageMarks } from '../../extension/src/sidepanel/page-marks';

describe('numbers switch', () => {
  it('starts off, and draws the numbers only while switched on', () => {
    const calls: string[] = [];
    const marks = {
      start: () => void calls.push('start'),
      stop: () => void calls.push('stop'),
      showNumbers: (on: boolean) => void calls.push(`numbers ${on ? 'on' : 'off'}`),
    } as unknown as PageMarks;
    const label = numbersPanel(marks);
    document.body.replaceChildren(label); // a click changes a switch only while it is on the page
    const toggle = label.querySelector('input')!;
    expect(toggle.checked).toBe(false);
    toggle.click();
    toggle.click();
    expect(calls).toEqual(['numbers on', 'start', 'numbers off', 'stop']);
  });
});
