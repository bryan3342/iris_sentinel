import { expect, it, vi } from 'vitest';
import { openByVoice } from '../../extension/src/sidepanel/voice-open';
import type { TargetList } from '../../extension/src/sidepanel/target-list';

const VIEWPORT = { width: 1280, height: 720, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 };
const RECT = { x: 100, y: 200, width: 80, height: 20 };
const list = (risky?: boolean): TargetList => ({ tabId: 7, documentToken: 'doc_abcdefghijklmnop', revision: 3, viewport: VIEWPORT,
  targetsTruncated: false, window: { left: 0, top: 0 }, zoom: 1,
  targets: [{ id: 12, role: 'link', rect: RECT, ...(risky === undefined ? {} : { risky }) }] });

it('opens a safe target at once, telling the page the confirm was not a double blink', async () => {
  const select = vi.fn(async () => 'SELECTED' as const), pick = vi.fn();
  expect(await openByVoice(12, RECT, { read: async () => list(false), select, pick })).toBe('OPENED');
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ tabId: 7, revision: 3 }), expect.objectContaining({ id: 12 }), false);
  expect(pick).not.toHaveBeenCalled();
});

it('never clicks a risky or unclassified target: it is picked for the person\'s own confirm', async () => {
  for (const risky of [true, undefined]) {
    const select = vi.fn(), pick = vi.fn(() => 'PICKED_EYES' as const);
    expect(await openByVoice(12, undefined, { read: async () => list(risky), select, pick })).toBe('PICKED_EYES');
    expect(select).not.toHaveBeenCalled();
    expect(pick).toHaveBeenCalledWith(12);
  }
});

it('opens nothing when the target moved since it was found, is gone, or the page refuses the click', async () => {
  const select = vi.fn(async () => 'STALE' as const), pick = vi.fn();
  expect(await openByVoice(12, { ...RECT, y: 260 }, { read: async () => list(false), select, pick })).toBe('STALE');
  expect(select).not.toHaveBeenCalled();
  expect(await openByVoice(40, undefined, { read: async () => list(false), select, pick })).toBe('NO_SUCH_NUMBER');
  expect(await openByVoice(12, undefined, { read: async () => null, select, pick })).toBe('NO_SUCH_NUMBER');
  expect(await openByVoice(12, undefined, { read: async () => list(false), select, pick })).toBe('STALE');
});

it('falls back to the person\'s confirm when the page itself judges the target risky', async () => {
  const select = vi.fn(async () => 'NEEDS_DOUBLE_BLINK' as const), pick = vi.fn(() => 'PICKED_EYES' as const);
  expect(await openByVoice(12, undefined, { read: async () => list(false), select, pick })).toBe('PICKED_EYES');
  expect(pick).toHaveBeenCalledWith(12);
});
