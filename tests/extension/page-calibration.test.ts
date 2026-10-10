import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CalibrationStore, GazeAim, GazePointer } from '@iris/core';
import type { Point2 } from '@iris/protocol';
import type { OverlayCommand } from '../../extension/src/content/overlay';
import { SimulatedGazeProvider } from '../../extension/src/providers/simulated/gaze';
import { GazeSession } from '../../extension/src/sidepanel/gaze-session';
import { PageMarks } from '../../extension/src/sidepanel/page-marks';
import { calibrateOnPage, screenFrame } from '../../extension/src/sidepanel/setup/page-calibration';
import { LiveTargetList } from '../../extension/src/sidepanel/target-list';

// A 1920 x 1080 screen. The page is 1200 x 800 and its corner sits at the window's position.
const SCREEN = { width: 1920, height: 1080, availLeft: 0, availTop: 0 };
const VIEWPORT = { width: 1200, height: 800, offsetLeft: 0, offsetTop: 0, scale: 1, scrollX: 0, scrollY: 0 };
const TARGETS = [1, 2, 3].map((id) => ({ id, role: 'link', rect: { x: 100 + (id - 1) * 400, y: 300, width: 200, height: 40 } }));
let windowAt: Point2, dot: Point2 | null, lookAt: Point2 | null, sent: OverlayCommand[];

// Where on the screen a page point is, as a fraction of the screen: what the simulated user's eyes point at.
const onScreen = (px: number, py: number): Point2 => ({ x: (windowAt.x + px) / SCREEN.width, y: (windowAt.y + py) / SCREEN.height });
const targetCenter = (id: number) => onScreen(200 + (id - 1) * 400, 320);

beforeEach(() => {
  vi.useFakeTimers();
  windowAt = { x: 300, y: 120 };
  dot = lookAt = null;
  sent = [];
  vi.stubGlobal('screen', SCREEN);
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn(async () => [{ id: 1, windowId: 1, url: 'https://example.com' }]) },
    windows: { get: vi.fn(async () => ({ left: windowAt.x, top: windowAt.y })) },
    scripting: {
      executeScript: vi.fn(async ({ func, args }: { func: { name: string }; args?: [OverlayCommand] }) => {
        if (func.name === 'pageOverlay') {
          const command = args![0];
          sent.push(command);
          if (command.type === 'dot') dot = command.at;
          return [{ frameId: 0, result: 'SHOWN' }];
        }
        const documentToken = 'document_token_abcdefgh';
        if (func.name === 'pageRevision') return [{ frameId: 0, result: { documentToken, revision: 0 } }];
        return [{ frameId: 0, result: { documentToken, revision: 0, viewport: VIEWPORT, targets: TARGETS, targetsTruncated: false } }];
      }),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('calibrates with dots on the page, then aims in screen positions that follow the window', async () => {
  // The simulated user looks at the calibration dot while one is shown, otherwise wherever the test says.
  const provider = new SimulatedGazeProvider(() => (dot ? onScreen(dot.x * VIEWPORT.width, dot.y * VIEWPORT.height) : lookAt), { noise: 0.02, seed: 9 });
  await provider.start();
  const targets = new LiveTargetList();
  const calibrating = calibrateOnPage(provider, (await targets.read())!);
  await vi.advanceTimersByTimeAsync(9 * 1800);
  const samples = await calibrating;
  expect(sent.filter((c) => c.type === 'dot')).toHaveLength(10); // nine dots, then hidden
  expect(dot).toBeNull();

  const store = new CalibrationStore();
  store.setDots(samples, SCREEN);
  const highlights = () => sent.filter((c) => c.type === 'show').map((c) => (c as { highlight: number | null }).highlight);
  const gaze = new GazeSession(provider, new GazeAim(new GazePointer(store)), new PageMarks(targets), screenFrame);
  lookAt = targetCenter(3);
  gaze.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(highlights().at(-1)).toBe(3);

  // The window moves 300 px left; the user keeps looking at the same link, now elsewhere on the screen.
  windowAt = { x: 0, y: 120 };
  lookAt = targetCenter(3);
  await vi.advanceTimersByTimeAsync(1000);
  expect(highlights().at(-1)).toBe(3);
  lookAt = targetCenter(2);
  await vi.advanceTimersByTimeAsync(1000);
  expect(highlights().at(-1)).toBe(2);
  gaze.stop();
  provider.stop();
});
