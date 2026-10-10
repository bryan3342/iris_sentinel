import { VITALS_LIMITS, type Quality, type Reading } from '@iris/protocol';

// Translates Presage's raw output into Iris's neutral messages. Pure and free of
// the SDK: the types below copy only the fields Iris reads from a decoded
// metrics packet, so this runs in tests and CI without the SDK installed.

/** A protobuf int64 timestamp, which the SDK may deliver as a Long object. */
type Int64 = number | { toNumber(): number };

/** One Presage measurement. Confidence is a percentage, 0 to 100. */
export interface PresageMeasurement {
  value?: number | null;
  confidence?: number | null;
  stable?: boolean | null;
  timestamp?: Int64 | null;
}

/** One Presage heart rate variability entry. Iris reads RMSSD. */
export interface PresageHrv {
  rmssd?: number | null;
  confidence?: number | null;
  stable?: boolean | null;
  timestamp?: Int64 | null;
}

/** The parts of a decoded Presage metrics packet that Iris reads. */
export interface PresageMetrics {
  breathing?: { rate?: PresageMeasurement[] | null } | null;
  cardio?: { pulseRate?: PresageMeasurement[] | null; hrv?: PresageHrv[] | null } | null;
}

/** Presage validation codes by name (never by number), mapped to Iris's camera qualities. */
const QUALITY_BY_CODE: Record<string, Quality> = {
  kOk: 'ok',
  kNoFaceFound: 'no-face',
  kMultipleFacesFound: 'multiple-faces',
  kFaceNotCentered: 'reposition',
  kFaceSizeOutOfRange: 'reposition',
  kFaceTooClose: 'reposition',
  kFaceTooFar: 'reposition',
  kFaceTooHigh: 'reposition',
  kFaceTooLow: 'reposition',
  kFaceNotForward: 'reposition',
  kTooDark: 'too-dark',
  kTooBright: 'too-bright',
  kChestNotVisible: 'chest-not-visible',
  kCameraTuning: 'camera-adjusting',
  kFrameRateTooLow: 'low-frame-rate',
  kExcessiveMotion: 'motion',
};

/** Iris's quality for a Presage validation code name, or null for a code Iris does not know. */
export function qualityFor(codeName: string): Quality | null {
  return Object.hasOwn(QUALITY_BY_CODE, codeName) ? QUALITY_BY_CODE[codeName]! : null;
}

/**
 * Presage reports camera quality on every frame. The FaceProvider contract
 * reports it only when it changes, so this passes on a status only when the
 * quality or its hint differs from the last one passed on.
 */
export class QualityChanges {
  private last: { quality: Quality; hint: string } | null = null;

  next(codeName: string, hint: string): { quality: Quality; hint: string } | null {
    const quality = qualityFor(codeName);
    if (quality === null) return null;
    if (this.last?.quality === quality && this.last.hint === hint) return null;
    this.last = { quality, hint };
    return this.last;
  }
}

/**
 * A Presage sample as an Iris reading: confidence 0 to 1, and null without a
 * usable value. A value above `max` is dropped, since the extension rejects the
 * whole message that carries it.
 */
export function toReading(
  sample: { value: number | null | undefined; confidence?: number | null; stable?: boolean | null },
  max = Infinity,
): Reading | null {
  const { value, confidence } = sample;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null;
  const percent = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  return { value, confidence: Math.min(1, Math.max(0, percent / 100)), stable: sample.stable === true };
}

/**
 * Collects the newest pulse, breathing rate and HRV from Presage's packets
 * (about 30 a second) between sends (about one a second). `take` hands over
 * only readings that arrived since the last `take`, so a reading is never sent
 * twice and a lost face cannot keep showing an old heart rate.
 */
export class VitalsWindow {
  private pulse: Timed | null = null;
  private breathing: Timed | null = null;
  private hrv: Timed | null = null;

  add(metrics: PresageMetrics): void {
    this.pulse = newer(this.pulse, newest(metrics.cardio?.pulseRate, (s) => s.value, VITALS_LIMITS.pulse));
    this.breathing = newer(this.breathing, newest(metrics.breathing?.rate, (s) => s.value, VITALS_LIMITS.breathing));
    this.hrv = newer(this.hrv, newest(metrics.cardio?.hrv, (s) => s.rmssd, VITALS_LIMITS.hrv));
  }

  take(): { pulse: Reading | null; breathing: Reading | null; hrv: Reading | null } {
    const taken = { pulse: this.pulse?.reading ?? null, breathing: this.breathing?.reading ?? null, hrv: this.hrv?.reading ?? null };
    this.pulse = this.breathing = this.hrv = null;
    return taken;
  }
}

interface Timed {
  at: number;
  reading: Reading;
}

/** The latest usable sample in a batch, by timestamp. */
function newest<S extends { confidence?: number | null; stable?: boolean | null; timestamp?: Int64 | null }>(
  samples: S[] | null | undefined,
  valueOf: (sample: S) => number | null | undefined,
  max: number,
): Timed | null {
  let best: Timed | null = null;
  for (const sample of samples ?? []) {
    const reading = toReading({ value: valueOf(sample), confidence: sample.confidence, stable: sample.stable }, max);
    const at = microseconds(sample.timestamp);
    if (reading && (best === null || at >= best.at)) best = { at, reading };
  }
  return best;
}

function newer(current: Timed | null, candidate: Timed | null): Timed | null {
  return candidate && (current === null || candidate.at >= current.at) ? candidate : current;
}

function microseconds(timestamp: Int64 | null | undefined): number {
  if (timestamp === null || timestamp === undefined) return 0;
  return typeof timestamp === 'number' ? timestamp : timestamp.toNumber();
}
