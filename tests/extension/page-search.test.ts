// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSearch } from '../../extension/src/content/search';
import { fakeLayout } from '../helpers/fake-layout';

/** What each form would send: its id and fields. The browser would load the results page; the test only records it. */
let sent: { form: string; fields: Record<string, FormDataEntryValue> }[];

/** Shows `html` as the page, recording every form submission instead of leaving the page. */
function page(html: string): void {
  document.body.innerHTML = html;
  for (const form of document.forms) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sent.push({ form: form.id, fields: Object.fromEntries(new FormData(form)) });
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  fakeLayout(); // an element is shown when it has a data-box
  sent = [];
  document.body.replaceChildren();
});

describe('pageSearch', () => {
  // The search boxes of Wikipedia, Amazon and eBay as they are built, where pressing Enter submits the form.
  it.each([
    ['Wikipedia', `<div role="search"><form id="searchform" action="/w/index.php">
       <input type="search" name="search" placeholder="Search Wikipedia" aria-label="Search Wikipedia" id="searchInput" data-box="266 17 404 32">
       <input type="hidden" name="title" value="Special:Search"></form></div>`,
      { form: 'searchform', fields: { search: 'solar eclipse', title: 'Special:Search' } }],
    ['Amazon', `<form id="nav-search-bar-form" role="search" method="GET" action="/s/ref=nb_sb_noss">
       <input type="text" id="twotabsearchtextbox" name="field-keywords" role="searchbox" aria-label="Search Amazon" placeholder="Search Amazon" data-box="382 11 637 38"></form>`,
      { form: 'nav-search-bar-form', fields: { 'field-keywords': 'solar eclipse' } }],
    ['eBay', `<form id="gh-f" method="get" action="https://www.ebay.com/sch/i.html">
       <input type="text" id="gh-ac" name="_nkw" role="combobox" aria-label="Search for anything" title="Search" data-box="272 51 743 39"></form>`,
      { form: 'gh-f', fields: { _nkw: 'solar eclipse' } }],
  ])('types into the search box on %s and submits its search form', (_site, html, search) => {
    page(html);
    expect(pageSearch('solar eclipse')).toBe('SEARCHED');
    expect(sent).toEqual([search]);
  });

  it('presses Enter as a person does, and leaves the search to the page when it takes the key, as YouTube does', () => {
    page(`<div role="search"><form id="yt" action="/results">
      <textarea name="search_query" role="combobox" data-box="402 16 618 24"></textarea></form></div>`);
    const box = document.querySelector('textarea')!;
    const seen: string[] = [];
    box.addEventListener('input', () => seen.push(`input ${box.value}`));
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault(); // the page searches with its own script
      seen.push(`search ${box.value}`);
    });
    expect(pageSearch('solar eclipse')).toBe('SEARCHED');
    expect(seen).toEqual(['input solar eclipse', 'search solar eclipse']);
    expect(sent).toEqual([]); // not searched twice
  });

  it('uses the search box on show over a hidden one', () => {
    page(`<form id="collapsed" action="/find"><input type="search" name="q"></form>
      <form id="header" action="/find"><input type="search" name="q" data-box="10 10 300 30"></form>`);
    expect(pageSearch('solar eclipse')).toBe('SEARCHED');
    expect(sent.map((s) => s.form)).toEqual(['header']);
  });

  it.each([
    ['a comment box', '<form method="post" action="/comment"><textarea name="comment" placeholder="Add a comment" data-box="0 0 300 80"></textarea></form>'],
    ['a search that posts data', '<form method="post" action="/search"><input type="search" name="q" data-box="0 0 300 30"></form>'],
    ['a search box with no form', '<div role="search"><input type="search" aria-label="Search" data-box="0 0 300 30"></div>'],
    ['a form with a password field', '<form action="/account"><input type="text" name="search_user" data-box="0 0 300 30"><input type="password" name="pin"></form>'],
    ['a disabled search box', '<form action="/search"><input type="search" name="q" disabled data-box="0 0 300 30"></form>'],
    ['a read-only search box', '<form action="/search"><input type="search" name="q" readonly data-box="0 0 300 30"></form>'],
    ['a plain text field', '<form action="/subscribe"><input type="text" name="email" placeholder="Your email" data-box="0 0 300 30"></form>'],
  ])('never touches %s, so the web is searched instead', (_what, html) => {
    page(html);
    const pressed = vi.fn();
    document.addEventListener('keydown', pressed, { once: true });
    expect(pageSearch('solar eclipse')).toBe('NO_SEARCH_BOX');
    expect([...document.querySelectorAll('input, textarea')].map((el) => (el as HTMLInputElement).value)).not.toContain('solar eclipse');
    expect(pressed).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    document.removeEventListener('keydown', pressed);
  });
});
