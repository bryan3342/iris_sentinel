import { describe, expect, it } from 'vitest';
import { presageOptions, stateForError } from '../../companion/src/presage/rules';

describe('presageOptions', () => {
  it('turns telemetry off and passes the key through', () => {
    const options = presageOptions('fake-presage-key-for-tests', [[0, 1]]);
    expect(options.enableTelemetry).toBe(false);
    expect(options.apiKey).toBe('fake-presage-key-for-tests');
  });

  it('requests each metric once across the groups', () => {
    expect(presageOptions('k', [[0, 1, 2], [15, 16], [2, 12]]).requestedMetrics).toEqual([0, 1, 2, 15, 16, 12]);
  });

  it('sets nothing beyond the key, the metrics and telemetry', () => {
    expect(Object.keys(presageOptions('k', [])).sort()).toEqual(['apiKey', 'enableTelemetry', 'requestedMetrics']);
  });
});

describe('stateForError', () => {
  it('maps the errors a user can fix to their own states', () => {
    expect(stateForError('kAuthenticationFailed')).toBe('key-invalid');
    expect(stateForError('kCreditExhausted')).toBe('credits-exhausted');
    expect(stateForError('kNetworkError')).toBe('offline');
    expect(stateForError('kServerError')).toBe('offline');
    expect(stateForError('kInputUnavailable')).toBe('camera-unavailable');
  });

  it('reports anything else as a general error', () => {
    expect(stateForError('kProcessingFailed')).toBe('error');
    expect(stateForError('kSomethingNew')).toBe('error');
    expect(stateForError('toString')).toBe('error');
  });
});
