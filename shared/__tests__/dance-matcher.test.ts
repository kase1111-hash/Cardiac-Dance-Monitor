/**
 * Dance matcher unit tests — test vectors from SPEC.md Section 10.
 * Written FIRST (TDD) before implementation.
 */
import { matchDance } from '../dance-matcher';
import { CONFIDENCE_UNCERTAIN } from '../constants';

describe('matchDance', () => {
  test('Input (κ=10.7, G=0.391, S=1.0) → "The Waltz" with high confidence', () => {
    const result = matchDance(10.7, 0.391, 1.0);
    expect(result.name).toBe('The Waltz');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('Input (κ=24.0, G=0.353, S=0.4) → "The Lock-Step"', () => {
    const result = matchDance(24.0, 0.353, 0.4);
    expect(result.name).toBe('The Lock-Step');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('Input (κ=3.3, G=0.512, S=2.0) → "The Mosh Pit"', () => {
    const result = matchDance(3.3, 0.512, 2.0);
    expect(result.name).toBe('The Mosh Pit');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('Input (κ=1.2, G=0.567, S=2.5) → "The Stumble"', () => {
    const result = matchDance(1.2, 0.567, 2.5);
    expect(result.name).toBe('The Stumble');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('Input (κ=7.6, G=0.510, S=1.2) → "The Sway"', () => {
    const result = matchDance(7.6, 0.510, 1.2);
    expect(result.name).toBe('The Sway');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('Input (κ=15, G=0.45, S=1.5) → some result with confidence < 0.5 (between dances)', () => {
    const result = matchDance(15, 0.45, 1.5);
    expect(result.confidence).toBeLessThan(0.5);
  });

  test('result always has required fields', () => {
    const result = matchDance(10, 0.4, 1.0);
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('runnerUp');
    expect(result).toHaveProperty('runnerUpConfidence');
    expect(result).toHaveProperty('kappaMedian');
    expect(result).toHaveProperty('gini');
    expect(result).toHaveProperty('spread');
    expect(result).toHaveProperty('bpm');
  });

  test('confidence values are between 0 and 1', () => {
    const result = matchDance(10.7, 0.391, 1.0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.runnerUpConfidence).toBeGreaterThanOrEqual(0);
    expect(result.runnerUpConfidence).toBeLessThanOrEqual(1);
  });

  test('runner-up is different from primary match', () => {
    const result = matchDance(10.7, 0.391, 1.0);
    expect(result.runnerUp).not.toBe(result.name);
  });

  test('runner-up confidence is less than or equal to primary confidence', () => {
    const result = matchDance(10.7, 0.391, 1.0);
    expect(result.runnerUpConfidence).toBeLessThanOrEqual(result.confidence);
  });
});
