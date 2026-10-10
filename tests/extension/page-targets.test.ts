// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { pageSnapshot } from '../../extension/src/page-understanding/page-helper';
import { fakeLayout } from '../helpers/fake-layout';

beforeEach(() => {
  fakeLayout();
  document.body.innerHTML = `
    <a href="/one" data-box="10 10 100 20">Account settings</a>
    <button data-box="10 40 80 20">Send</button>
    <button disabled data-box="10 70 80 20">Off</button>
    <video data-box="200 10 300 200"></video>
    <input data-box="10 100 200 20">
    <x-widget data-box="10 130 200 40"></x-widget>`;
  const widget = document.querySelector('x-widget')!;
  widget.attachShadow({ mode: 'open' }).innerHTML = '<button data-box="20 140 60 20">Inside</button>';
});

it('finds links and buttons on a page that page understanding refuses', () => {
  expect(pageSnapshot().blocked).toBe(true); // the video blocks screenshots
  const gaze = pageSnapshot('targets');
  expect(gaze.targets.map((t) => [t.role, t.rect.y])).toEqual([['link', 10], ['button', 40], ['button', 140]]);
});

it('reports positions only: no labels, masks, images or blocking verdict', () => {
  const gaze = pageSnapshot('targets');
  expect(Object.keys(gaze).sort()).toEqual(['documentToken', 'revision', 'targets', 'targetsTruncated', 'viewport']);
  expect(gaze.targets.every((t) => !('label' in t))).toBe(true);
});

it('marks what selecting each target would risk, failing toward a second confirm', () => {
  const row = (i: number) => `data-box="10 ${10 + i * 30} 200 20"`;
  document.body.innerHTML = `
    <a href="https://example.com/news" ${row(0)}>Today's news</a>
    <a href="https://example.com/a" ${row(1)}>Delete my account</a>
    <a href="https://example.com/f.pdf" download ${row(2)}>Report</a>
    <a href="mailto:someone@example.com" ${row(3)}>Write to us</a>
    <div role="link" ${row(4)}>Styled link</div>
    <button ${row(5)}>Menu</button>
    <button ${row(6)}>Send</button>
    <button aria-label="" ${row(7)}></button>
    <form><button type="button" ${row(8)}>Next</button></form>
    <button ${row(9)}>  show   more </button>`;
  const flags = pageSnapshot('targets').targets.map((t) => [t.rect.y, t.risky]);
  expect(flags).toEqual([
    [10, false], // a plain link to a web page
    [40, true], // a risky word
    [70, true], // a download
    [100, true], // opens another app
    [130, true], // not a real link: cannot tell what it does
    [160, false], // a plainly harmless button
    [190, true], // a risky word
    [220, true], // icon only: cannot tell what it does
    [250, true], // inside a form
    [280, false], // harmless, whitespace aside
  ]);
});

it('treats links without a usable address, and mixed harmless and risky names, as risky', () => {
  document.body.innerHTML = `
    <a href="http://[" data-box="10 40 200 20">Broken address</a>
    <button aria-label="Close" data-box="10 70 200 20">Delete</button>`;
  expect(pageSnapshot('targets').targets.map((t) => t.risky)).toEqual([true, true]);
});


it('numbers targets the same way for gaze and page understanding', () => {
  // A layout-less custom element (like display: contents) still holds targets, and an editable link is never a target.
  document.body.innerHTML = `
    <a href="/one" data-box="10 10 100 20">One</a>
    <x-group></x-group>
    <a href="/edit" contenteditable data-box="10 70 100 20">Editable</a>
    <button data-box="10 100 80 20">Last</button>`;
  document.querySelector('x-group')!.attachShadow({ mode: 'open' }).innerHTML = '<button data-box="10 40 60 20">Inside</button>';
  const page = pageSnapshot();
  const shape = (targets: { id: number; rect: { y: number } }[]) => targets.map((t) => [t.id, t.rect.y]);
  expect(page.blocked).toBe(false);
  expect(shape(page.targets)).toEqual([[1, 10], [2, 40], [3, 100]]);
  expect(shape(pageSnapshot('targets').targets)).toEqual(shape(page.targets));
});
