import { describe, expect, it } from 'vitest';
import type { VitalsSample } from '@iris/protocol';
import { emptyGraph, GRAPH_BOX, type GraphHistory, graphView, withGraphSample } from '../../extension/src/sidepanel/vitals-graph-view';

/** A companion sample at `t` ms; null leaves a signal out. */
const sample = (t: number, pulse: number | null, breathing: number | null, stable = true): VitalsSample => ({
  t,
  pulse: pulse === null ? null : { value: pulse, confidence: 0.9, stable },
  breathing: breathing === null ? null : { value: breathing, confidence: 0.9, stable },
  hrv: { value: 40, confidence: 0.9, stable: true },
});

/** One sample a second from t = 0, as the companion sends them. */
const feed = (values: [number | null, number | null][], history: GraphHistory = emptyGraph(), from = 0): GraphHistory =>
  values.reduce((h, [pulse, breathing], i) => withGraphSample(h, sample(from + i * 1000, pulse, breathing)), history);

const steady = (seconds: number, pulse: number | null, breathing: number | null): [number | null, number | null][] =>
  Array.from({ length: seconds }, () => [pulse, breathing]);

/** The points of each line segment in a path, as [x, y]. */
const segments = (path: string): number[][][] =>
  path
    .split('M')
    .filter(Boolean)
    .map((segment) => segment.split('L').map((point) => point.split(',').map(Number)));

const lineFor = (history: GraphHistory, signal: 'pulse' | 'breathing') => graphView(history)!.lines.find((l) => l.signal === signal)!;

describe('heart rate and breathing graph', () => {
  it('keeps only trusted heart rate and breathing readings, from the last five minutes', () => {
    let history = withGraphSample(emptyGraph(), sample(0, 70, 14, false));
    expect(history).toEqual({ pulse: [], breathing: [] }); // not yet trusted: never drawn as a spike
    history = withGraphSample(history, sample(1_000, 72, 15));
    expect(history).toEqual({ pulse: [{ t: 1_000, value: 72 }], breathing: [{ t: 1_000, value: 15 }] });
    history = withGraphSample(history, sample(302_000, 80, null));
    expect(history).toEqual({ pulse: [{ t: 302_000, value: 80 }], breathing: [] });
  });

  it('draws heart rate above breathing in one chart, oldest at the left and newest at the right edge', () => {
    const view = graphView(feed(steady(120, 70, 14)))!;
    const [pulse, breathing] = ['pulse', 'breathing'].map((s) => segments(view.lines.find((l) => l.signal === s)!.path));
    for (const [line, band] of [[pulse!, GRAPH_BOX.bands.pulse], [breathing!, GRAPH_BOX.bands.breathing]] as const) {
      expect(line).toHaveLength(1);
      expect(line[0]![0]![0]).toBe(GRAPH_BOX.plotLeft);
      expect(line[0]!.at(-1)![0]).toBe(GRAPH_BOX.plotRight);
      for (const [, y] of line[0]!) {
        expect(y).toBeGreaterThanOrEqual(band.top);
        expect(y).toBeLessThanOrEqual(band.bottom);
      }
    }
    expect(GRAPH_BOX.bands.pulse.bottom).toBeLessThan(GRAPH_BOX.bands.breathing.top);
  });

  it('breaks a line where readings paused for more than five seconds, such as when the face left the camera', () => {
    const history = feed(steady(10, 70, null), feed(steady(10, 70, null)), 20_000);
    expect(segments(lineFor(history, 'pulse').path)).toHaveLength(2);
  });

  it('keeps ordinary wobble flat, and lets a spike reach the top of its band', () => {
    const wobble = feed(Array.from({ length: 60 }, (_, i) => [i % 2 ? 71 : 70, null]));
    const band = GRAPH_BOX.bands.pulse;
    const flat = segments(lineFor(wobble, 'pulse').path)[0]!.map(([, y]) => y!);
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThanOrEqual((band.bottom - band.top) * 0.1);

    const spiked = segments(lineFor(withGraphSample(wobble, sample(60_000, 95, null)), 'pulse').path)[0]!;
    expect(spiked.at(-1)![1]).toBe(band.top);
    expect(Math.min(...spiked.slice(0, -1).map(([, y]) => y!))).toBeGreaterThan(band.top + (band.bottom - band.top) / 2);
  });

  it('labels each scale, names both lines and describes the ranges for screen readers', () => {
    const view = graphView(feed(Array.from({ length: 180 }, (_, i) => [64 + (i % 29), 11 + (i % 8)])))!;
    expect(view.lines.map(({ signal, top, bottom }) => ({ signal, top, bottom }))).toEqual([
      { signal: 'pulse', top: 92, bottom: 64 },
      { signal: 'breathing', top: 18, bottom: 11 },
    ]);
    expect(view.caption).toBe('Heart rate (red), breathing (teal), last 3 min');
    expect(view.summary).toBe('Heart rate 64 to 92 beats a minute and breathing 11 to 18 breaths a minute, over the last 3 min.');
  });

  it('has nothing to draw before the first trusted reading, then draws what has arrived', () => {
    expect(graphView(emptyGraph())).toBeNull();
    const view = graphView(feed(steady(31, 70, null)))!;
    expect(view.lines.map((l) => l.signal)).toEqual(['pulse']);
    expect(view.summary).toBe('Heart rate 70 beats a minute, over the last 30 s.');
  });
});
