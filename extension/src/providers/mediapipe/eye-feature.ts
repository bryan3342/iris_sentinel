import type { GazeSample, HeadPose, Point2 } from '@iris/protocol';

// Pure conversion from Face Landmarker output to a neutral GazeSample. Kept
// free of MediaPipe imports so it can be unit tested with plain fixtures.

export interface FaceFrame {
  /** 478 landmarks, normalized 0..1 to image width and height. */
  landmarks: Point2[];
  /** Blendshape scores keyed by name, e.g. eyeBlinkLeft. */
  blendshapes: Record<string, number>;
  /** Column-major 4x4 face transform. */
  matrix: number[];
  /** Image width divided by height. */
  aspect: number;
}

interface EyeLandmarks {
  iris: number[];
  cornerA: number;
  cornerB: number;
  /** Suffix of this eye's blendshape names (MediaPipe uses the user's own left and right). */
  side: 'Left' | 'Right';
}

// Corners are listed image-left first. "Right" is the user's right eye.
// Iris lists the center then its four contour points; averaging them steadies the center.
const RIGHT_EYE: EyeLandmarks = { iris: [468, 469, 470, 471, 472], cornerA: 33, cornerB: 133, side: 'Right' };
const LEFT_EYE: EyeLandmarks = { iris: [473, 474, 475, 476, 477], cornerA: 362, cornerB: 263, side: 'Left' };
const EYE_CLOSED = 0.5;
const BLINK_MS = 400; // a blink shuts the lids for well under this; longer means the eye is closed

const isClosed = (blendshapes: Record<string, number>, eye: EyeLandmarks) =>
  (blendshapes[`eyeBlink${eye.side}`] ?? 0) > EYE_CLOSED;

/**
 * Tells a blink from a closed eye by how long each lid has been shut. While
 * either eye's closure is still short enough to be a blink, the caller holds
 * its last output, since the iris points under a closing lid are not worth
 * reading. Each eye is timed on its own, so an eye that has been closed for a
 * while does not stop the other eye's blinks from being recognised. Holding
 * through blinks also means a published sample with a closed eye has already
 * outlasted a blink, which is what the long-blink confirm reads.
 */
export class ClosureTimer {
  private readonly closedSince: Record<EyeLandmarks['side'], number | null> = { Left: null, Right: null };

  /** True while either eye is in a closure shorter than a blink. */
  blinking(blendshapes: Record<string, number>, now: number): boolean {
    const states = [RIGHT_EYE, LEFT_EYE].map((eye) => {
      if (!isClosed(blendshapes, eye)) {
        this.closedSince[eye.side] = null;
        return false;
      }
      const since = (this.closedSince[eye.side] ??= now);
      return now - since < BLINK_MS;
    });
    return states.some(Boolean);
  }
}

/**
 * Iris center and contour points (0..1 image coordinates) for the user's right
 * eye, then left, for drawing on the preview. An eye that is closed or not
 * found gets an empty list, so its marker disappears while it is not tracked.
 */
export function irisPoints(frame: FaceFrame): [Point2[], Point2[]] {
  const of = (eye: EyeLandmarks): Point2[] =>
    isClosed(frame.blendshapes, eye) ? [] : eye.iris.flatMap((i) => (frame.landmarks[i] ? [frame.landmarks[i]!] : []));
  return [of(RIGHT_EYE), of(LEFT_EYE)];
}
const VERTICAL_SCALE = 5;

interface EyeReading {
  /** Iris position along the corner line (-1..1) and off it, in eye widths. */
  offset: Point2;
  /** Look-down minus look-up score for this eye. */
  lookDown: number;
  /**
   * Trust in this eye. Landmark noise is roughly constant in pixels and the
   * offset is divided by eye width, so its variance falls with width squared:
   * the eye turned away from the camera (foreshortened, and tracked by the
   * coarser face mesh once occluded) counts less. Zero while the lid is closed,
   * since the iris points then only describe the visible sliver.
   */
  weight: number;
}

function readEye(frame: FaceFrame, eye: EyeLandmarks): EyeReading | null {
  const b = frame.blendshapes;
  if (isClosed(b, eye)) return null;
  const at = (i: number) => {
    const p = frame.landmarks[i];
    return p ? { x: p.x * frame.aspect, y: p.y } : null;
  };
  const irisPoints = eye.iris.map(at).filter((p): p is Point2 => p !== null);
  const a = at(eye.cornerA);
  const c = at(eye.cornerB);
  if (irisPoints.length === 0 || !a || !c) return null;
  const iris = {
    x: irisPoints.reduce((sum, p) => sum + p.x, 0) / irisPoints.length,
    y: irisPoints.reduce((sum, p) => sum + p.y, 0) / irisPoints.length,
  };
  const ax = c.x - a.x;
  const ay = c.y - a.y;
  const lengthSq = ax * ax + ay * ay;
  if (lengthSq === 0) return null;
  const dx = iris.x - a.x;
  const dy = iris.y - a.y;
  // Position along the corner line (0..1) and distance off it, both in eye widths.
  const along = (dx * ax + dy * ay) / lengthSq;
  const across = (ax * dy - ay * dx) / lengthSq;
  return {
    offset: { x: 2 * along - 1, y: across * VERTICAL_SCALE },
    lookDown: (b[`eyeLookDown${eye.side}`] ?? 0) - (b[`eyeLookUp${eye.side}`] ?? 0),
    weight: lengthSq,
  };
}

/**
 * Yaw and pitch from the face transform's rotation. The transform maps the
 * canonical face, which looks toward the camera, onto the detected face, so a
 * rotation about the vertical axis reads as a turn toward the user's left and a
 * rotation about the horizontal axis as a tilt downward. The matrix layout is
 * undocumented, so it is detected from where the depth sits: index 14 when
 * column-major, index 11 when row-major.
 */
function headRotation(m: number[]): Pick<HeadPose, 'yaw' | 'pitch'> {
  const rowMajor = m[14] === 0 && m[11] !== 0 && m[11] !== undefined;
  const at = (row: number, col: number) => m[rowMajor ? row * 4 + col : col * 4 + row] ?? (row === col ? 1 : 0);
  const r20 = Math.max(-1, Math.min(1, at(2, 0)));
  return { yaw: Math.asin(-r20), pitch: Math.atan2(at(2, 1), at(2, 2)) };
}

/** Where the head sits in the image: outer eye corners, which gaze itself never moves. */
function headPosition(frame: FaceFrame): Pick<HeadPose, 'eyes' | 'eyeSpan'> {
  const a = frame.landmarks[RIGHT_EYE.cornerA];
  const b = frame.landmarks[LEFT_EYE.cornerB];
  if (!a || !b) return { eyes: { x: 0, y: 0 }, eyeSpan: 0 };
  const [ax, bx] = [a.x * frame.aspect, b.x * frame.aspect];
  return { eyes: { x: (ax + bx) / 2, y: (a.y + b.y) / 2 }, eyeSpan: Math.hypot(bx - ax, b.y - a.y) };
}

function headPose(frame: FaceFrame): HeadPose {
  return { ...headRotation(frame.matrix), ...headPosition(frame) };
}

export function toGazeSample(frame: FaceFrame, t: number): GazeSample {
  // A closed eye drops out of the estimate so the other eye aims alone; with
  // both closed the sample carries no eye position and aiming holds still. The
  // missing position is not a blink signal: `blink` carries each eye's closure.
  const eyes = [RIGHT_EYE, LEFT_EYE].map((eye) => readEye(frame, eye)).filter((r): r is EyeReading => r !== null);
  const total = eyes.reduce((sum, r) => sum + r.weight, 0);
  const head = headPose(frame);
  const closure = (eye: EyeLandmarks) => frame.blendshapes[`eyeBlink${eye.side}`] ?? 0;
  const blink = { left: closure(LEFT_EYE), right: closure(RIGHT_EYE) };
  if (total === 0) return { t, eye: null, head, blink };
  const mean = (pick: (r: EyeReading) => number) => eyes.reduce((sum, r) => sum + r.weight * pick(r), 0) / total;
  // Up/down from landmarks is weak (the lids hide the iris), so blend in the
  // model's own look-down minus look-up scores.
  // Image x grows toward the user's left, so flip it: positive x is the user's right.
  const eye = { x: -mean((r) => r.offset.x), y: (mean((r) => r.offset.y) + mean((r) => r.lookDown)) / 2 };
  return { t, eye, head, blink };
}
