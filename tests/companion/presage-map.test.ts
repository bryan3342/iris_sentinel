import { describe, expect, it } from 'vitest';
import { validateFromCompanion } from '@iris/protocol';
import { QualityChanges, qualityFor, toReading, VitalsWindow } from '../../companion/src/presage/map';

/** Every validation code name in the Presage Node SDK 3.4.0. */
const PRESAGE_CODES = [
  'kOk', 'kNoFaceFound', 'kMultipleFacesFound', 'kFaceNotCentered', 'kFaceSizeOutOfRange',
  'kTooDark', 'kTooBright', 'kChestNotVisible', 'kCameraTuning', 'kFrameRateTooLow',
  'kExcessiveMotion', 'kFaceTooClose', 'kFaceTooFar', 'kFaceTooHigh', 'kFaceTooLow', 'kFaceNotForward',
];

/** A protobuf int64 timestamp as the SDK can deliver it. */
const long = (n: number) => ({ toNumber: () => n });

describe('qualityFor', () => {
  it('maps every Presage validation code to an Iris quality', () => {
    for (const code of PRESAGE_CODES) expect(qualityFor(code)).not.toBeNull();
    expect(qualityFor('kOk')).toBe('ok');
    expect(qualityFor('kTooDark')).toBe('too-dark');
    expect(qualityFor('kExcessiveMotion')).toBe('motion');
    expect(qualityFor('kChestNotVisible')).toBe('chest-not-visible');
    expect(qualityFor('kFaceTooClose')).toBe('reposition');
  });

  it('returns null for codes it does not know', () => {
    expect(qualityFor('kSomethingNew')).toBeNull();
    expect(qualityFor('toString')).toBeNull();
  });
});

describe('QualityChanges', () => {
  it('passes a status on only when the quality or hint changes', () => {
    const changes = new QualityChanges();
    expect(changes.next('kTooDark', 'Add more light')).toEqual({ quality: 'too-dark', hint: 'Add more light' });
    expect(changes.next('kTooDark', 'Add more light')).toBeNull();
    expect(changes.next('kTooDark', 'Turn on a lamp')).toEqual({ quality: 'too-dark', hint: 'Turn on a lamp' });
    expect(changes.next('kOk', '')).toEqual({ quality: 'ok', hint: '' });
  });

  it('skips unknown codes without forgetting the last status', () => {
    const changes = new QualityChanges();
    changes.next('kOk', '');
    expect(changes.next('kSomethingNew', 'hint')).toBeNull();
    expect(changes.next('kOk', '')).toBeNull();
  });
});

describe('toReading', () => {
  it('turns a percentage confidence into 0 to 1, within bounds', () => {
    expect(toReading({ value: 72, confidence: 90, stable: true })).toEqual({ value: 72, confidence: 0.9, stable: true });
    expect(toReading({ value: 72, confidence: 140 })?.confidence).toBe(1);
    expect(toReading({ value: 72, confidence: -5 })?.confidence).toBe(0);
    expect(toReading({ value: 72 })).toEqual({ value: 72, confidence: 0, stable: false });
  });

  it('drops samples without a usable value', () => {
    expect(toReading({ value: undefined, confidence: 90 })).toBeNull();
    expect(toReading({ value: Number.NaN, confidence: 90 })).toBeNull();
    expect(toReading({ value: -1, confidence: 90 })).toBeNull();
    expect(toReading({ value: 301, confidence: 90 }, 300)).toBeNull();
  });
});

describe('VitalsWindow', () => {
  it('keeps the newest reading of each signal by timestamp, including Long timestamps', () => {
    const window = new VitalsWindow();
    window.add({
      cardio: {
        pulseRate: [
          { value: 75, confidence: 80, stable: true, timestamp: long(2_000) },
          { value: 70, confidence: 80, stable: true, timestamp: long(1_000) },
        ],
        hrv: [{ rmssd: 42, confidence: 60, stable: true, timestamp: 1_500 }],
      },
      breathing: { rate: [{ value: 14, confidence: 50, stable: false, timestamp: 1_000 }] },
    });
    window.add({ cardio: { pulseRate: [{ value: 78, confidence: 85, stable: true, timestamp: long(3_000) }] } });
    expect(window.take()).toEqual({
      pulse: { value: 78, confidence: 0.85, stable: true },
      breathing: { value: 14, confidence: 0.5, stable: false },
      hrv: { value: 42, confidence: 0.6, stable: true },
    });
  });

  it('hands over each reading only once', () => {
    const window = new VitalsWindow();
    window.add({ breathing: { rate: [{ value: 14, confidence: 50, stable: true, timestamp: 1 }] } });
    expect(window.take().breathing).not.toBeNull();
    expect(window.take()).toEqual({ pulse: null, breathing: null, hrv: null });
  });

  it('skips samples without a usable value and packets without a signal', () => {
    const window = new VitalsWindow();
    window.add({ cardio: { pulseRate: [{ value: null, confidence: 90, timestamp: 1 }] } });
    window.add({});
    expect(window.take()).toEqual({ pulse: null, breathing: null, hrv: null });
  });

  it('drops readings above the protocol bounds so the message stays valid', () => {
    const window = new VitalsWindow();
    window.add({
      cardio: { pulseRate: [{ value: 500, confidence: 90, timestamp: 1 }], hrv: [{ rmssd: 20_000, confidence: 90, timestamp: 1 }] },
      breathing: { rate: [{ value: 14, confidence: 90, timestamp: 1 }, { value: 250, confidence: 90, timestamp: 2 }] },
    });
    const taken = window.take();
    expect(taken.pulse).toBeNull();
    expect(taken.hrv).toBeNull();
    expect(taken.breathing?.value).toBe(14);
    expect(() => validateFromCompanion({ type: 'vitals', ...taken })).not.toThrow();
  });

  it('produces vitals the extension accepts', () => {
    const window = new VitalsWindow();
    window.add({
      cardio: { pulseRate: [{ value: 72, confidence: 100, stable: true, timestamp: 1 }], hrv: [{ rmssd: 40, confidence: 0, timestamp: 1 }] },
    });
    expect(() => validateFromCompanion({ type: 'vitals', ...window.take() })).not.toThrow();
  });
});
