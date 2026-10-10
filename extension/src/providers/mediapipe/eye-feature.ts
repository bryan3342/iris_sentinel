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

// Corners are listed image-left first. "Right" is the user's right eye.
// Iris lists the center then its four contour points; averaging them steadies the center.
const RIGHT_EYE = { iris: [468, 469, 470, 471, 472], cornerA: 33, cornerB: 133 };
const LEFT_EYE = { iris: [473, 474, 475, 476, 477], cornerA: 362, cornerB: 263 };

const BLINK_CLOSED = 0.5;
const VERTICAL_SCALE = 5;

function eyeOffset(frame: FaceFrame, eye: typeof RIGHT_EYE): Point2 | null {
  const at = (i: number) => {
    const p = frame.landmarks[i];
    return p ? { x: p.x * frame.aspect, y: p.y } : null;
  };
  const irisPoints = eye.iris.map(at).filter((p): p is Point2 => p !== null);
  const a = at(eye.cornerA);
  const b = at(eye.cornerB);
  if (irisPoints.length === 0 || !a || !b) return null;
  const iris = {
    x: irisPoints.reduce((sum, p) => sum + p.x, 0) / irisPoints.length,
    y: irisPoints.reduce((sum, p) => sum + p.y, 0) / irisPoints.length,
  };
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

function headPose(m: number[]): HeadPose {
  const [r20 = 0, r21 = 0, r22 = 1] = [m[2], m[6], m[10]];
  return { yaw: Math.asin(Math.max(-1, Math.min(1, -r20))), pitch: Math.atan2(r21, r22) };
}

export function toGazeSample(frame: FaceFrame, t: number): GazeSample {
  // Closed eyes only suppress the gaze point so aiming holds still. This is not
  // a blink signal: blinks come from FaceProvider (Presage).
  const b = frame.blendshapes;
  const closed = (b.eyeBlinkLeft ?? 0) > BLINK_CLOSED && (b.eyeBlinkRight ?? 0) > BLINK_CLOSED;
  const right = eyeOffset(frame, RIGHT_EYE);
  const left = eyeOffset(frame, LEFT_EYE);
  // Up/down from landmarks is weak (the lids hide the iris), so blend in the
  // model's own look-down minus look-up scores, averaged over both eyes.
  const lookDown =
    ((b.eyeLookDownLeft ?? 0) + (b.eyeLookDownRight ?? 0) - (b.eyeLookUpLeft ?? 0) - (b.eyeLookUpRight ?? 0)) / 2;
  // Image x grows toward the user's left, so flip it: positive x is the user's right.
  const eye =
    closed || !right || !left
      ? null
      : { x: -(right.x + left.x) / 2, y: ((right.y + left.y) / 2 + lookDown) / 2 };
  return { t, eye, head: headPose(frame.matrix) };
}
