import type { FaceSample, Point2 } from '@iris/protocol';

// Pure conversion from Face Landmarker output to a neutral FaceSample. Kept
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

// Corners are listed image-left first. "Right" is the user's right eye.
const RIGHT_EYE = { iris: 468, cornerA: 33, cornerB: 133 };
const LEFT_EYE = { iris: 473, cornerA: 362, cornerB: 263 };

const BLINK_CLOSED = 0.5;
const TALKING_JAW_OPEN = 0.15;
const VERTICAL_SCALE = 5;

function eyeOffset(frame: FaceFrame, eye: typeof RIGHT_EYE): Point2 | null {
  const at = (i: number) => {
    const p = frame.landmarks[i];
    return p ? { x: p.x * frame.aspect, y: p.y } : null;
  };
  const iris = at(eye.iris);
  const a = at(eye.cornerA);
  const b = at(eye.cornerB);
  if (!iris || !a || !b) return null;
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const lengthSq = ax * ax + ay * ay;
  if (lengthSq === 0) return null;
  const dx = iris.x - a.x;
  const dy = iris.y - a.y;
  // Position along the corner line (0..1) and distance off it, both in eye widths.
  const along = (dx * ax + dy * ay) / lengthSq;
  const across = (ax * dy - ay * dx) / lengthSq;
  return { x: 2 * along - 1, y: across * VERTICAL_SCALE };
}

function headPose(m: number[]): FaceSample['head'] {
  const [r20 = 0, r21 = 0, r22 = 1] = [m[2], m[6], m[10]];
  return { yaw: Math.asin(Math.max(-1, Math.min(1, -r20))), pitch: Math.atan2(r21, r22) };
}

export function toFaceSample(frame: FaceFrame, t: number): FaceSample {
  const blink = {
    left: frame.blendshapes.eyeBlinkLeft ?? 0,
    right: frame.blendshapes.eyeBlinkRight ?? 0,
  };
  const closed = blink.left > BLINK_CLOSED && blink.right > BLINK_CLOSED;
  const right = eyeOffset(frame, RIGHT_EYE);
  const left = eyeOffset(frame, LEFT_EYE);
  // Image x grows toward the user's left, so flip it: positive x is the user's right.
  const eye =
    closed || !right || !left
      ? null
      : { x: -(right.x + left.x) / 2, y: (right.y + left.y) / 2 };
  return {
    t,
    eye,
    head: headPose(frame.matrix),
    blink,
    talking: (frame.blendshapes.jawOpen ?? 0) > TALKING_JAW_OPEN,
  };
}
