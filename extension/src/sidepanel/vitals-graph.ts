import { GRAPH_BOX, type GraphSignal, type GraphView } from './vitals-graph-view';

// Draws the heart rate and breathing graph worked out in vitals-graph-view.ts
// as one SVG chart: heart rate in red above, breathing in teal below, each with
// its scale on the left. Hidden while there is nothing to draw. Screen readers
// get the chart's summary in place of the drawing.

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface VitalsGraph {
  element: HTMLElement;
  /** Redraws the chart, or hides it when there is nothing to draw. */
  draw(view: GraphView | null): void;
}

export function vitalsGraph(): VitalsGraph {
  const figure = document.createElement('figure');
  figure.className = 'vitals-graph';
  figure.setAttribute('role', 'img');
  figure.hidden = true;
  const caption = document.createElement('figcaption');
  const svg = svgElement('svg', { viewBox: `0 0 ${GRAPH_BOX.width} ${GRAPH_BOX.height}`, 'aria-hidden': 'true' });
  const labelX = GRAPH_BOX.plotLeft - 6;
  const axisX = GRAPH_BOX.plotLeft - 2;
  const parts = {} as Record<GraphSignal, { path: SVGElement; top: SVGElement; bottom: SVGElement }>;
  for (const signal of ['pulse', 'breathing'] as const) {
    const band = GRAPH_BOX.bands[signal];
    const axis = svgElement('line', { class: 'axis', x1: axisX, y1: band.top, x2: axisX, y2: band.bottom });
    const top = svgElement('text', { x: labelX, y: band.top + 4, 'text-anchor': 'end' });
    const bottom = svgElement('text', { x: labelX, y: band.bottom, 'text-anchor': 'end' });
    const path = svgElement('path', { class: signal });
    svg.append(axis, top, bottom, path);
    parts[signal] = { path, top, bottom };
  }
  figure.append(caption, svg);

  return {
    element: figure,
    draw(view) {
      figure.hidden = view === null;
      if (view === null) return;
      caption.textContent = view.caption;
      figure.setAttribute('aria-label', view.summary);
      for (const signal of ['pulse', 'breathing'] as const) {
        const line = view.lines.find((l) => l.signal === signal);
        const { path, top, bottom } = parts[signal];
        if (line) path.setAttribute('d', line.path);
        else path.removeAttribute('d');
        top.textContent = line ? String(Math.round(line.top)) : '';
        bottom.textContent = line ? String(Math.round(line.bottom)) : '';
      }
    },
  };
}

function svgElement(name: string, attributes: Record<string, string | number>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
