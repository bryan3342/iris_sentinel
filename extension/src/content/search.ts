/**
 * Searches with the page's own search box, as a person would: types the words into it and presses
 * Enter, and when the page does not take the key itself, submits the box's form as Enter would. Runs
 * in Chrome's isolated world and must remain self-contained for executeScript.
 *
 * Only a box that is plainly for search is used: a text field, search field or text area that is of
 * type search, inside a search landmark, or named or labeled for search, in a form that searches by
 * address (GET) and holds no password field. Such a form only loads its results page; a form that
 * posts data, a login, a comment box or any other field is never touched. A box on show is used
 * before a hidden one. Returns NO_SEARCH_BOX when there is none, so the web can be searched instead.
 */
export function pageSearch(query: string): 'SEARCHED' | 'NO_SEARCH_BOX' {
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const forSearch = (el: HTMLInputElement | HTMLTextAreaElement) => el.type === 'search' || el.closest('[role="search"], search') !== null ||
    [el.getAttribute('role'), el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.title].some((text) => !!text && /search/i.test(text));
  const boxes = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter((el) => {
    const form = el.form;
    return (el instanceof HTMLTextAreaElement || el.type === 'text' || el.type === 'search') && !el.disabled && !el.readOnly &&
      form !== null && /^get$/i.test(form.method) && !form.querySelector('input[type="password"]') && forSearch(el);
  });
  const box = boxes.find(shown) ?? boxes[0];
  if (!box) return 'NO_SEARCH_BOX';
  // The element's own value setter, so a page that tracks the value in its scripts (React) sees the change.
  const prototype = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(box, query);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
  if (box.dispatchEvent(enter)) box.form!.requestSubmit(); // the page did not take the key, as YouTube does: submit as Enter would
  return 'SEARCHED';
}
