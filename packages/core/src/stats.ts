/** Small statistics helpers for the fatigue clues. */

/**
 * The value below which a fraction `q` (0 to 1) of `values` falls,
 * interpolating linearly between neighbours: `q = 0.5` is the median,
 * `q = 0.25` the 25th percentile. Null when there are no values. The input is
 * not reordered.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(Math.max(q, 0), 1) * (sorted.length - 1);
  const below = sorted[Math.floor(position)]!;
  const above = sorted[Math.ceil(position)]!;
  return below + (above - below) * (position - Math.floor(position));
}
