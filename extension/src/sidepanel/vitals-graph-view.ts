import type { VitalsSample } from '@iris/protocol';
import { STALE_MS } from './body-signals';

// The heart rate and breathing graph in the body signals section, as pure
// functions: a short history of trusted readings, and one chart drawn from it,
// heart rate above breathing, each on its own scale over a shared time axis.
// No DOM here, so it is tested directly; vitals-graph.ts draws it. The history
// lives in memory only.

export type GraphSignal = 'pulse' | 'breathing';
const SIGNALS: GraphSignal[] = ['pulse', 'breathing'];

/** How far back the graph reaches, in milliseconds. */
export const GRAPH_WINDOW_MS = 5 * 60_000;

/** The least time the chart spreads across, so the first readings are not stretched over the whole width. */
const MIN_SPAN_MS = 60_000;

/** The least range each scale covers, so ordinary wobble stays flat and a real spike stands out. */
const MIN_RANGE: Record<GraphSignal, number> = { pulse: 20, breathing: 6 };

/** The chart's drawing box, in SVG units: scale labels on the left, heart rate above breathing. */
export const GRAPH_BOX = {
  width: 300,
  height: 132,
  plotLeft: 30,
  plotRight: 296,
  bands: { pulse: { top: 8, bottom: 58 }, breathing: { top: 74, bottom: 124 } },
} as const;

interface Point {
  t: number;
  value: number;
}

export type GraphHistory = Record<GraphSignal, Point[]>;

export const emptyGraph = (): GraphHistory => ({ pulse: [], breathing: [] });

/**
 * Adds the sample's heart rate and breathing once Presage trusts them (the
 * same bar as the numbers above the graph), and forgets readings older than
 * the window.
 */
export function withGraphSample(history: GraphHistory, sample: VitalsSample): GraphHistory {
  const next = (signal: GraphSignal): Point[] => {
    const reading = sample[signal];
    const points = reading?.stable ? [...history[signal], { t: sample.t, value: reading.value }] : history[signal];
    return points.filter((point) => sample.t - point.t <= GRAPH_WINDOW_MS);
  };
  return { pulse: next('pulse'), breathing: next('breathing') };
}

export interface GraphLine {
  signal: GraphSignal;
  /** SVG path data in GRAPH_BOX units; a new segment starts wherever readings paused. */
  path: string;
  /** The values at the top and bottom of the line's band, for its scale labels. */
  top: number;
  bottom: number;
}

export interface GraphView {
  /** One line per signal with readings, heart rate first. */
  lines: GraphLine[];
  /** Shown above the chart. */
  caption: string;
  /** The chart in words, for screen readers. */
  summary: string;
}

const NAME: Record<GraphSignal, string> = { pulse: 'heart rate', breathing: 'breathing' };
const UNIT: Record<GraphSignal, string> = { pulse: 'beats a minute', breathing: 'breaths a minute' };

/** The chart for a history, or null before the first trusted reading. The newest reading sits at the right edge. */
export function graphView(history: GraphHistory): GraphView | null {
  const times = SIGNALS.flatMap((signal) => history[signal].map((point) => point.t));
  if (times.length === 0) return null;
  const end = Math.max(...times);
  const covered = end - Math.min(...times);
  const span = Math.min(GRAPH_WINDOW_MS, Math.max(MIN_SPAN_MS, covered));
  const { plotLeft, plotRight } = GRAPH_BOX;
  const x = (t: number) => plotRight - ((end - t) / span) * (plotRight - plotLeft);
  const lines = SIGNALS.filter((signal) => history[signal].length > 0).map((signal) => lineFor(signal, history[signal], x));
  const duration = covered < 60_000 ? `${Math.max(1, Math.round(covered / 1000))} s` : `${Math.round(covered / 60_000)} min`;
  const ranges = lines.map(({ signal }, i) => {
    const values = history[signal].map((point) => point.value);
    const [low, high] = [Math.round(Math.min(...values)), Math.round(Math.max(...values))];
    const name = i === 0 ? NAME[signal][0]!.toUpperCase() + NAME[signal].slice(1) : NAME[signal];
    return `${name} ${low === high ? low : `${low} to ${high}`} ${UNIT[signal]}`;
  });
  return {
    lines,
    caption: `Heart rate (red), breathing (teal), last ${duration}`,
    summary: `${ranges.join(' and ')}, over the last ${duration}.`,
  };
}

/** One signal's line in its band, scaled to its own readings but never to less than its least range. */
function lineFor(signal: GraphSignal, points: Point[], x: (t: number) => number): GraphLine {
  const values = points.map((point) => point.value);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const range = Math.max(high - low, MIN_RANGE[signal]);
  const bottom = (low + high) / 2 - range / 2;
  const band = GRAPH_BOX.bands[signal];
  const y = (value: number) => band.bottom - ((value - bottom) / range) * (band.bottom - band.top);
  const path = points
    .map((point, i) => {
      const move = i === 0 || point.t - points[i - 1]!.t > STALE_MS ? 'M' : 'L';
      return `${move}${round(x(point.t))},${round(y(point.value))}`;
    })
    .join('');
  return { signal, path, top: bottom + range, bottom };
}

const round = (n: number) => Math.round(n * 10) / 10;
