// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { PointerProvider } from '@iris/protocol';
import { fingerPanel } from '../../extension/src/sidepanel/finger-panel';

describe('finger tracing switch', () => {
  it('starts off, runs hand tracking only while on, and can be switched on by Iris', async () => {
    const calls: string[] = [];
    const provider: PointerProvider = {
      start: async () => void calls.push('start'),
      stop: () => void calls.push('stop'),
      onSample: () => () => {},
    };
    let made = 0;
    const finger = fingerPanel({
      makeProvider: () => (made++, provider),
      list: () => null,
      gaze: { pointWith: () => {}, pinch: () => {} },
      cursor: { move: () => {}, stop: () => void calls.push('ring off') },
    });
    document.body.replaceChildren(finger.element); // a switch changes only while it is on the page
    const toggle = finger.element.querySelector('input')!;
    expect(toggle.checked).toBe(false);
    expect(calls).toEqual([]); // nothing runs until it is switched on

    finger.turnOn();
    finger.turnOn(); // already on: nothing more
    await Promise.resolve();
    expect(toggle.checked).toBe(true);
    expect(calls).toEqual(['start']);

    toggle.click(); // the user switches it off
    toggle.click(); // and on again: the model loaded once is reused
    await Promise.resolve();
    expect(calls).toEqual(['start', 'stop', 'ring off', 'start']);
    expect(made).toBe(1);
  });
});
