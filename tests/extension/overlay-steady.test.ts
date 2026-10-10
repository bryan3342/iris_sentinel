// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { pageOverlay } from '../../extension/src/content/overlay';
import { pageSnapshot, type PageTargets } from '../../extension/src/page-understanding/page-helper';
import { fakeLayout } from '../helpers/fake-layout';

type Globals = typeof globalThis & { __irisOverlayV01?: { host: HTMLElement; layer: HTMLElement }; __irisOverlayHoldV01?: number };
const g = globalThis as Globals;
const frame = () => new Promise((resolve) => setTimeout(resolve, 50)); // mutation observers, then one animation frame
const badges = () => [...(g.__irisOverlayV01?.layer.children ?? [])].filter((el) => el.className.startsWith('badge')).length;
const show = (scan: Pick<PageTargets, 'documentToken' | 'revision' | 'targets'>) =>
  pageOverlay({ type: 'show', documentToken: scan.documentToken, revision: scan.revision, targets: scan.targets, highlight: null });

beforeEach(() => {
  vi.restoreAllMocks();
  g.__irisOverlayV01?.host.remove();
  delete g.__irisOverlayV01;
  delete g.__irisOverlayHoldV01;
  fakeLayout();
  document.body.innerHTML = `
    <a href="/one" data-box="10 10 100 20">One</a>
    <button data-box="10 40 80 20">Menu</button>
    <p id="clock" data-box="300 10 100 20">12:00</p>`;
});

it('keeps the numbers through page changes that move nothing, like a ticking clock or a hover effect', async () => {
  const scan = pageSnapshot('targets');
  expect(await show(scan)).toBe('SHOWN');
  for (const time of ['12:01', '12:02', '12:03']) {
    document.getElementById('clock')!.textContent = time;
    document.querySelector('button')!.classList.toggle('hover');
    await frame();
  }
  expect(badges()).toBe(2);
});

it('erases the numbers once a numbered element moves or leaves the page', async () => {
  await show(pageSnapshot('targets'));
  document.querySelector('a')!.setAttribute('data-box', '10 210 100 20'); // pushed down by new content
  await frame();
  expect(badges()).toBe(0);
  await show(pageSnapshot('targets'));
  document.querySelector('button')!.remove();
  await frame();
  expect(badges()).toBe(0);
});

it('lands a draw from a slightly older scan while its elements are still where they were', async () => {
  const scan = pageSnapshot('targets');
  document.getElementById('clock')!.textContent = '12:01'; // the page moved on before the draw arrived
  await frame();
  expect(pageSnapshot('targets').revision).toBeGreaterThan(scan.revision);
  expect(await show(scan)).toBe('SHOWN');
  document.querySelector('a')!.setAttribute('data-box', '10 210 100 20');
  await frame();
  expect(await show(scan)).toBe('STALE'); // an element it numbered has moved
});

it('still erases a drawing that did not come from a gaze scan on any change', async () => {
  const snapshot = pageSnapshot(); // page understanding's own scan keeps no elements
  expect(await show(snapshot)).toBe('SHOWN');
  document.getElementById('clock')!.textContent = '12:01';
  await frame();
  expect(badges()).toBe(0);
});

it('does not let a frame check pending from an earlier drawing erase a calibration dot', async () => {
  await show(pageSnapshot('targets'));
  document.getElementById('clock')!.textContent = '12:01';
  await Promise.resolve(); // the mutation observer has fired; the frame check is pending
  document.querySelector('a')!.setAttribute('data-box', '10 210 100 20'); // would fail the check
  await pageOverlay({ type: 'dot', at: { x: 0.5, y: 0.5 } });
  await frame();
  expect(g.__irisOverlayV01?.layer.querySelector('.dot')).not.toBeNull();
});
