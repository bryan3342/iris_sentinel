import { describe, expect, it } from 'vitest';
import { CompanionMessageError, validateFromCompanion, validateToCompanion } from '@iris/protocol';

const steady = { value: 72, confidence: 0.9, stable: true };

describe('validateToCompanion', () => {
  it('accepts start and stop', () => {
    expect(validateToCompanion({ type: 'start' })).toEqual({ type: 'start' });
    expect(validateToCompanion({ type: 'stop' })).toEqual({ type: 'stop' });
  });

  it.each([
    ['an unknown type', { type: 'restart' }],
    ['an extra field', { type: 'start', camera: 1 }],
    ['null', null],
    ['an array', [{ type: 'start' }]],
    ['a bare string', 'start'],
  ])('rejects %s', (_, message) => {
    expect(() => validateToCompanion(message)).toThrow(CompanionMessageError);
  });
});

describe('validateFromCompanion', () => {
  it('accepts every message type', () => {
    const messages = [
      { type: 'hello', version: 1 },
      { type: 'status', state: 'key-missing' },
      { type: 'quality', quality: 'too-dark', hint: 'Add more light in front of you' },
      { type: 'quality', quality: 'ok', hint: '' },
      { type: 'vitals', pulse: steady, breathing: { value: 14, confidence: 0.5, stable: false }, hrv: null },
      { type: 'blink', durationMs: 167 },
    ];
    for (const message of messages) expect(validateFromCompanion(message)).toEqual(message);
  });

  it.each([
    ['an unknown type', { type: 'confirm', source: 'blink' }],
    ['a talking message, which comes from the voice agent instead', { type: 'talking', on: true }],
    ['a missing field', { type: 'blink' }],
    ['an extra field', { type: 'blink', durationMs: 167, t: 5 }],
    ['a version below 1', { type: 'hello', version: 0 }],
    ['a fractional version', { type: 'hello', version: 1.5 }],
    ['an unknown state', { type: 'status', state: 'sleeping' }],
    ['an unknown quality', { type: 'quality', quality: 'blurry', hint: '' }],
    ['an overlong hint', { type: 'quality', quality: 'ok', hint: 'x'.repeat(201) }],
    ['a confidence above 1', { type: 'vitals', pulse: { ...steady, confidence: 1.5 }, breathing: null, hrv: null }],
    ['a negative reading', { type: 'vitals', pulse: { ...steady, value: -1 }, breathing: null, hrv: null }],
    ['a reading that is not a number', { type: 'vitals', pulse: { ...steady, value: Number.NaN }, breathing: null, hrv: null }],
    ['a missing stable flag', { type: 'vitals', pulse: { value: 72, confidence: 0.9 }, breathing: null, hrv: null }],
    ['a missing reading instead of null', { type: 'vitals', pulse: steady, breathing: null }],
    ['a negative blink', { type: 'blink', durationMs: -1 }],
    ['a blink longer than 10 seconds', { type: 'blink', durationMs: 10_001 }],
    ['null', null],
  ])('rejects %s', (_, message) => {
    expect(() => validateFromCompanion(message)).toThrow(CompanionMessageError);
  });

  it('never repeats the rejected message in the error', () => {
    const error = (() => {
      try {
        validateFromCompanion({ type: 'vitals', pulse: { value: 987654, confidence: 1, stable: true }, breathing: null, hrv: null });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(CompanionMessageError);
    expect(error?.message).not.toContain('987654');
  });
});
