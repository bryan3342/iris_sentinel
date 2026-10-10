import type { Point2 } from '@iris/protocol';

/**
 * Turns a gaze point into the page target the user is aiming at. Distance is
 * measured to each target's rectangle, not its center, so a wide link is as easy
 * to hit at its ends as in the middle. Inside several rectangles at once (a
 * button inside a card link), the smallest wins, since it is the more specific
 * aim. The current aim is kept until another target is closer by more than
 * `hysteresis`, so webcam jitter between two neighbors does not flicker. Units
 * are whatever the caller passes (CSS pixels of the page viewport).
 */

export interface SnapTarget {
  id: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface SnapOptions {
  /** Farthest a target can be from the gaze point and still be aimed. */
  maxDistance: number;
  /** How much closer another target must be before the aim moves to it. */
  hysteresis: number;
}

/** Distance from `p` to the nearest edge of `rect`, or 0 inside it. */
export function distanceToRect(p: Point2, rect: SnapTarget['rect']): number {
  const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

const area = (t: SnapTarget) => t.rect.width * t.rect.height;

/** Whether `inner` lies entirely within `outer`. */
const contains = (outer: SnapTarget['rect'], inner: SnapTarget['rect']) =>
  inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The aimed target's ID, or null when nothing is within `maxDistance`. `previous` is the last aim. */
export function snapToTarget(
  point: Point2,
  targets: readonly SnapTarget[],
  previous: number | null,
  { maxDistance, hysteresis }: SnapOptions,
): number | null {
  let best: { target: SnapTarget; distance: number } | null = null;
  let held: { target: SnapTarget; distance: number } | null = null;
  for (const target of targets) {
    const distance = distanceToRect(point, target.rect);
    if (target.id === previous) held = { target, distance };
    if (distance > maxDistance) continue;
    const closer = !best || distance < best.distance || (distance === best.distance && area(target) < area(best.target));
    if (closer) best = { target, distance };
  }
  if (!best) return null;
  if (held && held.distance <= maxDistance && held.distance <= best.distance + hysteresis) {
    // Nested targets both read as distance 0, so hysteresis alone would never let
    // the aim move inward from a card to the button inside it. Targets that only
    // overlap or touch are held like any other neighbor.
    const nestedInside = held.distance === 0 && best.distance === 0 && contains(held.target.rect, best.target.rect);
    if (!nestedInside) return previous;
  }
  return best.target.id;
}
