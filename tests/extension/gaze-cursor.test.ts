import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GazeCursor, ringPoint } from '../../extension/src/sidepanel/gaze-cursor';

type Port = { name: string; tabId: number; posted: unknown[]; postMessage: (m: unknown) => void; disconnect: ReturnType<typeof vi.fn>; drop: () => void;
  onDisconnect: { addListener: (l: () => void) => void } };
let ports: Port[], injections: number[], injectFails: boolean;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  ports = []; injections = []; injectFails = false;
  vi.stubGlobal('chrome', {
    scripting: { executeScript: vi.fn(async ({ target, args }: { target: { tabId: number }; args: [{ type: string }] }) => {
      expect(args[0]).toEqual({ type: 'listen' });
      injections.push(target.tabId);
      if (injectFails) throw new Error('Cannot access this page');
      return [{ frameId: 0, result: 'SHOWN' }];
    }) },
    tabs: { connect: vi.fn((tabId: number, info: { name: string; frameId: number }) => {
      const dropped: (() => void)[] = [];
      const port: Port = { name: info.name, tabId, posted: [], postMessage: (m) => port.posted.push(m), disconnect: vi.fn(),
        drop: () => dropped.forEach((l) => l()), onDisconnect: { addListener: (l) => dropped.push(l) } };
      ports.push(port);
      return port;
    }) },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('starts the page listener once, then streams moved points over one connection', async () => {
  const cursor = new GazeCursor();
  cursor.move(1, { x: 10, y: 10 }); // connecting: dropped
  await flush();
  cursor.move(1, { x: 20, y: 30 });
  cursor.move(1, { x: 20.2, y: 30.1 }); // under half a pixel: not sent
  cursor.move(1, null);
  cursor.move(1, null);
  expect(injections).toEqual([1]);
  expect(ports.map((p) => [p.name, p.tabId])).toEqual([['iris.gaze-cursor', 1]]);
  expect(ports[0]!.posted).toEqual([{ at: { x: 20, y: 30 } }, { at: null }]);
});

it('moves to a new tab, reconnects after the page navigates, and disconnects on stop', async () => {
  const cursor = new GazeCursor();
  cursor.move(1, { x: 1, y: 1 }); await flush();
  cursor.move(2, { x: 1, y: 1 }); await flush();
  expect(ports[0]!.disconnect).toHaveBeenCalled();
  ports[1]!.drop(); // tab 2 navigated
  cursor.move(2, { x: 5, y: 5 }); await flush();
  cursor.move(2, { x: 6, y: 6 });
  expect(injections).toEqual([1, 2, 2]);
  expect(ports[2]!.posted).toEqual([{ at: { x: 6, y: 6 } }]);
  cursor.stop();
  expect(ports[2]!.disconnect).toHaveBeenCalled();
});

it('retries a tab it cannot draw on at most once a second', async () => {
  injectFails = true;
  const cursor = new GazeCursor();
  for (let n = 0; n < 10; n++) { cursor.move(1, { x: n, y: n }); await flush(); }
  expect(injections).toEqual([1]);
  await vi.advanceTimersByTimeAsync(1000);
  cursor.move(1, { x: 1, y: 1 }); await flush();
  expect(injections).toEqual([1, 1]);
});

it('sits on the aimed target when it snaps, and follows the gaze otherwise', () => {
  const aimed = { rect: { x: 100, y: 200, width: 80, height: 20 } };
  const at = { x: 150, y: 190 };
  expect(ringPoint(at, aimed, true)).toEqual({ x: 140, y: 210 }); // the target's center
  expect(ringPoint(at, aimed, false)).toEqual(at);
  expect(ringPoint(at, null, true)).toEqual(at); // nothing aimed: the ring follows the gaze
  expect(ringPoint(null, aimed, true)).toBeNull(); // eyes closed or face lost: no ring
});
