import { describe, expect, it } from 'vitest';
import { addressedToIris } from '@iris/core';

describe('addressedToIris', () => {
  it('accepts requests that start with Iris, with or without a greeting', () => {
    for (const said of ['Iris, scroll down', 'iris scroll down', '  Iris.', 'Hey Iris, go back', 'OK, Iris open youtube']) {
      expect(addressedToIris(said), said).toBe(true);
    }
  });

  it('rejects requests that do not start with Iris', () => {
    for (const said of ['scroll down', 'tell Iris to scroll', 'Irish music', 'Irises are flowers', '']) {
      expect(addressedToIris(said), said).toBe(false);
    }
  });
});
