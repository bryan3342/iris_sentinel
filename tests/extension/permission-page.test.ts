// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let getUserMedia: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<main><h1>Camera access</h1><p id="status"></p></main>';
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  remove = vi.fn(async () => {});
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('chrome', { tabs: { getCurrent: vi.fn(async () => ({ id: 42 })), remove } });
});
afterEach(() => vi.unstubAllGlobals());

it('closes itself once the camera is allowed, returning the person to where they were', async () => {
  await import('../../extension/src/sidepanel/setup/permission');
  await settle();
  expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }));
  expect(remove).toHaveBeenCalledWith(42);
});

it('stays open and says how to fix it when the camera is blocked', async () => {
  getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
  await import('../../extension/src/sidepanel/setup/permission');
  await settle();
  expect(remove).not.toHaveBeenCalled();
  expect(document.getElementById('status')!.textContent).toMatch(/blocked/);
});
