// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { numbersPanel } from '../../extension/src/sidepanel/numbers';
import type { PageMarks } from '../../extension/src/sidepanel/page-marks';

describe('numbers switch', () => {
  it('can be turned on by Iris, as when it notices a struggle, which shows the numbers once', () => {
    let started = 0;
    const marks = { start: () => void started++, stop: () => {}, showNumbers: () => {} } as unknown as PageMarks;
    const numbers = numbersPanel(marks);
    document.body.replaceChildren(numbers.element); // a switch changes only while it is on the page
    const toggle = numbers.element.querySelector('input')!;
    expect(toggle.checked).toBe(false);
    numbers.turnOn();
    numbers.turnOn(); // already on: nothing more
    expect(toggle.checked).toBe(true);
    expect(started).toBe(1);
  });
});
