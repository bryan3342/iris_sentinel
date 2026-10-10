import { type BlinkEvent, QUALITIES, type QualityStatus } from './face';
import type { Reading, VitalsSample } from './vitals';

/**
 * Messages between the extension and the Presage companion over Chrome native
 * messaging. The companion is a separate program, so each side validates every
 * message on arrival. Messages carry no timestamps: the receiver stamps them,
 * so the two programs' clocks never need to agree.
 */

/** Bumped whenever either side's messages change. The companion announces it in `hello`. */
export const COMPANION_PROTOCOL_VERSION = 1;

/**
 * Iris's fixed extension ID, pinned by the public `key` in
 * extension/public/manifest.json. The companion only answers this caller.
 */
export const IRIS_EXTENSION_ID = 'bohipliohnmknfglnkhglngbmpiahdcn';

/** Chrome's name for the companion: the extension connects with it, the installer registers it. */
export const NATIVE_HOST_NAME = 'com.iris.companion';

/** What the companion is doing. Anything but `running` means no body signals. */
export const COMPANION_STATES = [
  'starting',
  'running',
  'stopped',
  'key-missing',
  'key-invalid',
  'offline',
  'credits-exhausted',
  'camera-unavailable',
  'error',
] as const;
export type CompanionState = (typeof COMPANION_STATES)[number];

/** Extension to companion. */
export type ToCompanion = { type: 'start' } | { type: 'stop' };

/** Companion to extension. Event fields match the provider types, minus the receiver's `t`. */
export type FromCompanion =
  | { type: 'hello'; version: number }
  | { type: 'status'; state: CompanionState }
  | ({ type: 'quality' } & Omit<QualityStatus, 't'>)
  | ({ type: 'vitals' } & Omit<VitalsSample, 't'>)
  | ({ type: 'blink' } & Omit<BlinkEvent, 't'>);

// Sanity bounds that reject corrupt data, not physiology: a reading's own
// confidence and `stable` flag decide whether it is believable.
const MAX_HINT_CHARS = 200;
const MAX_BLINK_MS = 10_000;
const MAX_PULSE = 300;
const MAX_BREATHING = 100;
const MAX_HRV = 10_000;

/** Thrown for a message that breaks the protocol. Never repeats the message, which may hold vitals. */
export class CompanionMessageError extends Error {
  constructor() {
    super('Invalid companion message.');
  }
}

/** Checks a message from the extension. The companion calls this on each one. */
export function validateToCompanion(value: unknown): ToCompanion {
  const m = object(value, ['type']);
  if (m.type !== 'start' && m.type !== 'stop') throw new CompanionMessageError();
  return { type: m.type };
}

/** Checks a message from the companion. The extension calls this on each one. */
export function validateFromCompanion(value: unknown): FromCompanion {
  switch (typeOf(value)) {
    case 'hello': {
      const m = object(value, ['type', 'version']);
      if (!Number.isSafeInteger(m.version) || (m.version as number) < 1) throw new CompanionMessageError();
      return { type: 'hello', version: m.version as number };
    }
    case 'status': {
      const m = object(value, ['type', 'state']);
      return { type: 'status', state: oneOf(m.state, COMPANION_STATES) };
    }
    case 'quality': {
      const m = object(value, ['type', 'quality', 'hint']);
      return { type: 'quality', quality: oneOf(m.quality, QUALITIES), hint: text(m.hint, MAX_HINT_CHARS) };
    }
    case 'vitals': {
      const m = object(value, ['type', 'pulse', 'breathing', 'hrv']);
      return {
        type: 'vitals',
        pulse: reading(m.pulse, MAX_PULSE),
        breathing: reading(m.breathing, MAX_BREATHING),
        hrv: reading(m.hrv, MAX_HRV),
      };
    }
    case 'blink': {
      const m = object(value, ['type', 'durationMs']);
      return { type: 'blink', durationMs: number(m.durationMs, 0, MAX_BLINK_MS) };
    }
    default:
      throw new CompanionMessageError();
  }
}

function typeOf(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).type : undefined;
}

/** A plain object with exactly these keys, no more and no fewer. */
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CompanionMessageError();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length || keys.some((k) => !Object.hasOwn(obj, k))) {
    throw new CompanionMessageError();
  }
  return obj;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new CompanionMessageError();
  }
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new CompanionMessageError();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new CompanionMessageError();
  return value as T;
}

function reading(value: unknown, max: number): Reading | null {
  if (value === null) return null;
  const r = object(value, ['value', 'confidence', 'stable']);
  if (typeof r.stable !== 'boolean') throw new CompanionMessageError();
  return { value: number(r.value, 0, max), confidence: number(r.confidence, 0, 1), stable: r.stable };
}
