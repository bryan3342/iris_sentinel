import type { CalibrationFrame, CalibrationSample } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';
import { pageOverlay } from '../../content/overlay';
import type { TargetList } from '../target-list';
import { runCalibration, type DotPresenter } from './calibration';

// Calibration on the browsing tab, stored in screen positions: each dot is
// saved as its place on the page plus the window's position on the screen.
// Later, the window's current position is subtracted again, so moving the
// window or resizing the side panel (on its default right side) needs no new
// dots. The browser's toolbar height is the same in both directions and
// cancels out. A side panel on the left that gets resized, or page zoom other
// than 100%, shifts the page in ways the window position does not show;
// confirms absorb small errors and calibrating again fixes large ones.

/** The screen, with the page viewport's corner at the window's position on it. */
export function screenFrame(list: TargetList): CalibrationFrame {
  const display = screen as Screen & { availLeft?: number; availTop?: number };
  return {
    width: screen.width,
    height: screen.height,
    left: list.window.left - (display.availLeft ?? 0),
    top: list.window.top - (display.availTop ?? 0),
  };
}

/** Draws the calibration dots on the browsing tab through its overlay. */
function pagePresenter(tabId: number): DotPresenter {
  const send = (at: Point2 | null) => {
    void chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [{ type: 'dot', at }] }).catch(() => {});
  };
  return { show: (dot) => send(dot), hide: () => send(null) };
}

/** Runs the dots over the page in `list`'s tab; returns samples whose targets are screen positions. */
export async function calibrateOnPage(provider: GazeProvider, list: TargetList, dotCount: 5 | 9 = 9): Promise<CalibrationSample[]> {
  const frame = screenFrame(list);
  const samples = await runCalibration(provider, pagePresenter(list.tabId), dotCount);
  const onScreen = (dot: Point2): Point2 => ({
    x: (dot.x * list.viewport.width + frame.left) / frame.width,
    y: (dot.y * list.viewport.height + frame.top) / frame.height,
  });
  return samples.map((sample) => ({ ...sample, target: onScreen(sample.target) }));
}
