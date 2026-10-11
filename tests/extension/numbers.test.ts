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
    const { element } = numbersPanel(marks);
    document.body.replaceChildren(element); // a click changes a switch only while it is on the page
    const toggle = element.querySelector('input')!;
    expect(toggle.checked).toBe(false);
    toggle.click();
    toggle.click();
    expect(calls).toEqual(['numbers on', 'start', 'numbers off', 'stop']);
  });

  it('can be turned on by Iris, as when it notices a struggle, which shows the numbers once', () => {
    let started = 0;
    const marks = { start: () => void started++, stop: () => {}, showNumbers: () => {} } as unknown as PageMarks;
    const numbers = numbersPanel(marks);
    document.body.replaceChildren(numbers.element);
    const toggle = numbers.element.querySelector('input')!;
    expect(toggle.checked).toBe(false);
    numbers.turnOn();
    numbers.turnOn(); // already on: nothing more
    expect(toggle.checked).toBe(true);
    expect(started).toBe(1);
  });
});
