import { describe, expect, it } from 'vitest';
import { ClickPace } from '@iris/core';

/** Three steady clicks: land on a new target every 5 s and hold it for the dwell. */
function steadyClicks(pace: ClickPace, dwellMs: number): void {
  for (const [i, target] of [1, 2, 3].entries()) {
    const land = i * 5_000;
    pace.aim(land, target);
    pace.click(land + dwellMs, dwellMs);
  }
}

describe('ClickPace', () => {
  it('reads a steady click as the reference dwell and one landing', () => {
    const pace = new ClickPace();
    steadyClicks(pace, 1_000);
    expect(pace.timeToClickMs).toBe(1_000);
    expect(pace.landingsPerClick).toBe(1);
  });

  it('is not changed by a longer dwell, so slowing the dwell never raises the score', () => {
    const normal = new ClickPace();
    steadyClicks(normal, 1_000);
    const slowed = new ClickPace();
    steadyClicks(slowed, 2_000);
    expect(slowed.timeToClickMs).toBe(normal.timeToClickMs);
    expect(slowed.landingsPerClick).toBe(normal.landingsPerClick);
  });

  it('counts quick slips off the target and back as extra landings and time', () => {
    const pace = new ClickPace({ minClicks: 1 });
    pace.aim(0, 7);
    pace.aim(400, 8); // slips to a neighbour
    pace.aim(700, 7);
    pace.aim(1_500, null); // slips off the page
    pace.aim(1_800, 7); // final landing, held for the dwell
    pace.click(2_800, 1_000);
    expect(pace.landingsPerClick).toBe(3);
    expect(pace.timeToClickMs).toBe(2_800); // 1.8 s settling plus the 1 s reference dwell
  });

  it('starts a new approach when the aim comes back after more than 2 seconds, so reading does not count', () => {
    const pace = new ClickPace({ minClicks: 1 });
    pace.aim(0, 7); // passed over while reading
    pace.aim(500, 9);
    pace.aim(5_000, 7); // came back much later to click
    pace.click(6_000, 1_000);
    expect(pace.landingsPerClick).toBe(1);
    expect(pace.timeToClickMs).toBe(1_000);
  });

  it('reports nothing before 3 clicks', () => {
    const pace = new ClickPace();
    pace.aim(0, 1);
    pace.click(1_000, 1_000);
    pace.aim(5_000, 2);
    pace.click(6_000, 1_000);
    expect(pace.timeToClickMs).toBeNull();
    expect(pace.landingsPerClick).toBeNull();
  });

  it('takes the median time and mean landings over the last 5 clicks', () => {
    const pace = new ClickPace();
    const settle = [5_000, 0, 0, 0, 3_000, 0]; // the first click falls out of the last 5
    settle.forEach((ms, i) => {
      const land = i * 20_000;
      if (ms > 0) {
        pace.aim(land, 100 + i);
        pace.aim(land + ms / 2, null); // one slip
      }
      pace.aim(land + ms, 100 + i);
      pace.click(land + ms + 1_000, 1_000);
    });
    expect(pace.timeToClickMs).toBe(1_000); // median of 1, 1, 1, 4 and 1 seconds
    expect(pace.landingsPerClick).toBeCloseTo(1.2); // one click of the five landed twice
  });

  it('ignores a click with nothing aimed', () => {
    const pace = new ClickPace({ minClicks: 1 });
    pace.aim(0, 1);
    pace.aim(500, null);
    pace.click(1_500, 1_000);
    expect(pace.timeToClickMs).toBeNull();
  });

  it('forgets everything on reset', () => {
    const pace = new ClickPace();
    steadyClicks(pace, 1_000);
    pace.reset();
    expect(pace.timeToClickMs).toBeNull();
  });
});
