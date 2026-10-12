import { describe, expect, it } from 'vitest';
import { addressedToIris } from '@iris/core';

describe('addressedToIris', () => {
  it('accepts requests that start with Iris, or greet Iris anywhere after other people\'s talk', () => {
    for (const said of ['Iris, scroll down', 'iris scroll down', '  Iris.', 'Hey Iris, go back', 'OK, Iris open youtube',
      'What\'s your name? Gino. All right. Hi, Iris. Scroll down.']) {
      expect(addressedToIris(said), said).toBe(true);
    }
  });

  it('rejects talk that does not call on Iris, including talk about Iris', () => {
    for (const said of ['scroll down', 'tell Iris to scroll', 'Irish music', 'Irises are flowers', '',
      'it starts the Iris voice assistant and does voice commands for you']) {
      expect(addressedToIris(said), said).toBe(false);
    }
  });
});
