import { describe, expect, it } from 'vitest';
import { quantile } from '@iris/core';

describe('quantile', () => {
  it('gives the median at 0.5', () => {
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
  });

  it('interpolates between neighbours', () => {
    expect(quantile([10, 20], 0.25)).toBe(12.5);
  });

  it('gives the smallest and largest values at 0 and 1, and clamps beyond them', () => {
    const values = [4, 9, 1];
    expect(quantile(values, 0)).toBe(1);
    expect(quantile(values, 1)).toBe(9);
    expect(quantile(values, -1)).toBe(1);
    expect(quantile(values, 2)).toBe(9);
  });

  it('is null with no values, and leaves the input order alone', () => {
    expect(quantile([], 0.5)).toBeNull();
    const values = [3, 1, 2];
    quantile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });
});
