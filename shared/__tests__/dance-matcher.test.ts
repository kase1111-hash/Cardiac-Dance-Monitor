/**
 * Dance matcher unit tests — uses the calibrated centroid values.
 * Each test feeds the centroid's own (κ, G, σ) and expects high confidence match.
 * Also tests with values from the actual pipeline (60-beat runs).
 */
import { matchDance } from '../dance-matcher';
import { DANCE_CENTROIDS, CONFIDENCE_UNCERTAIN } from '../constants';

describe('matchDance', () => {
  // At-centroid tests: feeding exact centroid values should match with >90% confidence
  test('exact Waltz centroid → "The Waltz" with high confidence', () => {
    const c = DANCE_CENTROIDS[0]; // Waltz
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.name).toBe('The Waltz');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('exact Lock-Step centroid → "The Lock-Step"', () => {
    const c = DANCE_CENTROIDS[1]; // Lock-Step
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.name).toBe('The Lock-Step');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('exact Sway centroid → "The Sway"', () => {
    const c = DANCE_CENTROIDS[2]; // Sway
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.name).toBe('The Sway');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('exact Mosh Pit centroid → "The Mosh Pit"', () => {
    const c = DANCE_CENTROIDS[3]; // Mosh Pit
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.name).toBe('The Mosh Pit');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('exact Stumble centroid → "The Stumble"', () => {
    const c = DANCE_CENTROIDS[4]; // Stumble
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.name).toBe('The Stumble');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  // Pipeline-realistic values: what the monitor actually computes at ~60 beats
  test('NSR at 60 beats (κ=9.0, G=0.366, σ=0.29) → "The Waltz" >50%', () => {
    const result = matchDance(9.0, 0.366, 0.29);
    expect(result.name).toBe('The Waltz');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('CHF at 60 beats (κ=35.1, G=0.328, σ=0.04) → "The Lock-Step" >50%', () => {
    const result = matchDance(35.1, 0.328, 0.04);
    expect(result.name).toBe('The Lock-Step');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('AF at 60 beats (κ=1.0, G=0.314, σ=1.90) → "The Mosh Pit" >40%', () => {
    const result = matchDance(1.0, 0.314, 1.90);
    expect(result.name).toBe('The Mosh Pit');
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  test('PVC at 60 beats (κ=0.5, G=0.772, σ=3.45) → "The Stumble" >50%', () => {
    const result = matchDance(0.5, 0.772, 3.45);
    expect(result.name).toBe('The Stumble');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  // Between-dance ambiguity: midpoint between Waltz and Sway should have low confidence
  test('midpoint between dances → low confidence', () => {
    const result = matchDance(5.8, 0.370, 0.65);
    expect(result.confidence).toBeLessThan(0.6);
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
    const c = DANCE_CENTROIDS[0];
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.runnerUpConfidence).toBeGreaterThanOrEqual(0);
    expect(result.runnerUpConfidence).toBeLessThanOrEqual(1);
  });

  test('runner-up is different from primary match', () => {
    const c = DANCE_CENTROIDS[0];
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.runnerUp).not.toBe(result.name);
  });

  test('runner-up confidence is less than or equal to primary confidence', () => {
    const c = DANCE_CENTROIDS[0];
    const result = matchDance(c.kappa, c.gini, c.spread);
    expect(result.runnerUpConfidence).toBeLessThanOrEqual(result.confidence);
  });
});
