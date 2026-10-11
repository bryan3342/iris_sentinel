// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { brandHeader } from '../../extension/src/sidepanel/brand';

it('renders the Iris wordmark with an accessible name', () => {
  const header = brandHeader();
  expect(header.getAttribute('role')).toBe('img');
  expect(header.getAttribute('aria-label')).toBe('Iris');
  // The eye stands in for the first letter, so only "ris" is spelled out.
  expect(header.textContent?.replace(/\s+/g, '')).toBe('ris');
  expect(header.querySelectorAll('svg')).toHaveLength(1);
});

it('draws the eye that blinks and glances', () => {
  const header = brandHeader();
  expect(header.querySelector('.blink')).not.toBeNull();
  expect(header.querySelector('.look')).not.toBeNull();
});
