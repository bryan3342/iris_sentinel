// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { VOICE_LINES } from '../../extension/src/sidepanel/agent/voice-lines';
import { CALIBRATE, DONE, INTRO } from '../../extension/src/sidepanel/setup/first-run';
import { slidesView } from '../../extension/src/sidepanel/setup/slides';

it('shows each slide with its spoken line as the caption, over the panel, and leaves nothing behind when closed', () => {
  const root = document.createElement('div');
  const view = slidesView(root);
  expect(root.querySelector('.setup')).toBeNull(); // nothing until there is something to show
  view.show(INTRO[0]!);
  const overlay = root.querySelector('.setup')!;
  expect(overlay.getAttribute('role')).toBe('dialog');
  expect(overlay.querySelector('h2')!.textContent).toBe(INTRO[0]!.title);
  expect(overlay.querySelector('.caption')!.textContent).toBe(VOICE_LINES.welcome);
  expect([...overlay.querySelectorAll('.progress li')].map((step) => step.classList.contains('now')))
    .toEqual([true, false, false, false, false, false]);
  view.show(DONE);
  expect(overlay.querySelector('.caption')!.textContent).toBe(VOICE_LINES.enjoy);
  expect(overlay.querySelectorAll('.progress li.now')).toHaveLength(1);
  view.close();
  expect(root.querySelector('.setup')).toBeNull();
});

it('can cover the panel at once, blank, so the panel never shows before the opening animation and the first slide', () => {
  const root = document.createElement('div');
  const view = slidesView(root);
  view.cover();
  const overlay = root.querySelector('.setup')!;
  expect(overlay.childElementCount).toBe(0); // no picture, title or progress dots yet
  view.show(INTRO[0]!);
  expect(root.querySelectorAll('.setup')).toHaveLength(1); // the first slide fills the same cover
  expect(overlay.querySelector('h2')!.textContent).toBe(INTRO[0]!.title);
  view.close();
  expect(root.querySelector('.setup')).toBeNull();
});

it('says what access is missing, with a button only for website access, which Chrome grants only from a click', () => {
  const root = document.createElement('div');
  const view = slidesView(root);
  const first = vi.fn(), second = vi.fn();
  view.needs({ camera: true, websites: true }, first);
  const button = root.querySelector('.setup button') as HTMLButtonElement;
  expect(button.hidden).toBe(false);
  expect(root.querySelector('.setup .caption')!.textContent).toMatch(/camera/i);
  view.needs({ camera: false, websites: true }, second);
  button.click();
  expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]); // the latest request is the one asked
  view.needs({ camera: true, websites: false }, second);
  expect(button.hidden).toBe(true);
  view.show(CALIBRATE);
  expect(button.hidden).toBe(true);
});
