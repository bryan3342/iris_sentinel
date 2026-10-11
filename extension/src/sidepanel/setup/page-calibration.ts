import type { CalibrationFrame, CalibrationSample } from '@iris/core';
import type { GazeProvider, Point2 } from '@iris/protocol';
import { pageOverlay } from '../../content/overlay';
import type { TargetList } from '../target-list';
import { CHECK_DOTS, collectAtDots, DOT_LAYOUTS, type DotPresenter } from './calibration';

// Calibration on the browsing tab, stored in screen positions: each dot is
// saved as its place on the page plus the window's position on the screen.
// Later, the window's current position is subtracted again, so moving the
// window or resizing the side panel (on its default right side) needs no new
// dots. The browser's toolbar height is the same in both directions and
// cancels out. A side panel on the left that gets resized, or page zoom other
// than 100%, shifts the page in ways the window position does not show;
// confirms absorb small errors and calibrating again fixes large ones. Page
// zoom is read from Chrome and divided out, so a calibration made at one zoom
// level aims correctly on pages at another.

/** The screen, in the page's own CSS pixels (divided by its zoom), with the page viewport's corner at the window's position on it. */
export function screenFrame(list: TargetList): CalibrationFrame {
  const display = screen as Screen & { availLeft?: number; availTop?: number };
  const zoom = list.zoom > 0 ? list.zoom : 1;
  return {
    width: screen.width / zoom,
    height: screen.height / zoom,
    left: (list.window.left - (display.availLeft ?? 0)) / zoom,
    top: (list.window.top - (display.availTop ?? 0)) / zoom,
  };
}

/** Draws the calibration dots on the browsing tab through its overlay. */
function pagePresenter(tabId: number): DotPresenter {
  const send = (at: Point2 | null) => {
    void chrome.scripting.executeScript({ target: { tabId }, func: pageOverlay, args: [{ type: 'dot', at }] }).catch(() => {});
  };
  return { show: (dot) => send(dot), hide: () => send(null) };
}

/** Runs the calibration dots over the page in `list`'s tab; returns samples whose targets are screen positions. */
export function calibrateOnPage(provider: GazeProvider, list: TargetList, dotCount: 5 | 9 | 16 = 16): Promise<CalibrationSample[]> {
  return dotsOnPage(provider, list, DOT_LAYOUTS[dotCount]);
}

/** Runs the accuracy check dots over the page; samples are in screen positions, like calibration's. */
export function checkOnPage(provider: GazeProvider, list: TargetList): Promise<CalibrationSample[]> {
  return dotsOnPage(provider, list, CHECK_DOTS);
}

async function dotsOnPage(provider: GazeProvider, list: TargetList, dots: Point2[]): Promise<CalibrationSample[]> {
  const frame = screenFrame(list);
  const samples = await collectAtDots(provider, pagePresenter(list.tabId), dots);
  const onScreen = (dot: Point2): Point2 => ({
    x: (dot.x * list.viewport.width + frame.left) / frame.width,
    y: (dot.y * list.viewport.height + frame.top) / frame.height,
  });
  return samples.map((sample) => ({ ...sample, target: onScreen(sample.target) }));
}
