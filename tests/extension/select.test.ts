// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { pageSelect, type SelectCommand } from '../../extension/src/content/select';
import { pageSnapshot, type PageTargets } from '../../extension/src/page-understanding/page-helper';
import { fakeLayout } from '../helpers/fake-layout';

let clicked: string[];
let scan: PageTargets;
document.addEventListener('click', (e) => { e.preventDefault(); clicked.push((e.composedPath()[0] as Element).textContent ?? ''); }, true);

beforeEach(() => {
  fakeLayout();
  clicked = [];
  document.body.innerHTML = `
    <a href="https://example.com/news" data-box="10 10 200 20">Today's news</a>
    <button data-box="10 40 200 20">Delete</button>
    <x-card data-box="10 70 200 40"></x-card>`;
  document.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = '<button data-box="20 80 60 20">Menu</button>';
  scan = pageSnapshot('targets');
});

const command = (id: number, confirmedTwice = false): SelectCommand => {
  const target = scan.targets.find((t) => t.id === id)!;
  return { documentToken: scan.documentToken, revision: scan.revision, id, rect: target.rect, confirmedTwice };
};

it('clicks exactly the element behind a confirmed safe target, including inside a shadow root', () => {
  expect(pageSelect(command(1))).toBe('SELECTED');
  expect(pageSelect(command(3))).toBe('SELECTED');
  expect(clicked).toEqual(["Today's news", 'Menu']);
});

it('refuses a risky target without a second confirm, checked in the page itself', () => {
  expect(pageSelect(command(2))).toBe('NEEDS_SECOND_CONFIRM');
  expect(clicked).toEqual([]);
  expect(pageSelect(command(2, true))).toBe('SELECTED');
  expect(clicked).toEqual(['Delete']);
});

it('clicks nothing once the target has gone, moved, been covered, or the document is another', () => {
  expect(pageSelect({ ...command(1), documentToken: 'another_document_token' })).toBe('STALE');
  expect(pageSelect({ ...command(1), revision: scan.revision + 99 })).toBe('STALE'); // no such scan
  document.querySelector('a')!.setAttribute('data-box', '10 300 200 20');
  expect(pageSelect(command(1))).toBe('STALE');
  document.body.insertAdjacentHTML('beforeend', '<div data-box="0 30 300 40">A cookie banner</div>');
  expect(pageSelect(command(2, true))).toBe('STALE');
  document.querySelector('x-card')!.remove();
  expect(pageSelect(command(3))).toBe('STALE');
  expect(clicked).toEqual([]);
});
