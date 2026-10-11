import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cameraAllowed, watchCamera } from '../../extension/src/sidepanel/setup/camera';

class FakeStatus extends EventTarget { constructor(public state: PermissionState) { super(); } }
let status: FakeStatus, query: ReturnType<typeof vi.fn>;
beforeEach(() => {
  status = new FakeStatus('prompt');
  query = vi.fn(async () => status);
  vi.stubGlobal('navigator', { permissions: { query } });
});
afterEach(() => vi.unstubAllGlobals());

it('reads whether the camera is allowed, and treats a state it cannot read as not allowed', async () => {
  expect(await cameraAllowed()).toBe(false);
  status.state = 'granted';
  expect(await cameraAllowed()).toBe(true);
  expect(query).toHaveBeenCalledWith({ name: 'camera' });
  query.mockRejectedValueOnce(new Error('unsupported'));
  expect(await cameraAllowed()).toBe(false);
});

it('tells the listener whenever camera access changes, until stopped', async () => {
  const listener = vi.fn();
  const stop = watchCamera(listener);
  await new Promise((resolve) => setTimeout(resolve, 0));
  status.dispatchEvent(new Event('change'));
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  status.dispatchEvent(new Event('change'));
  expect(listener).toHaveBeenCalledTimes(1);
});
