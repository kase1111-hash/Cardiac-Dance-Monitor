/**
 * Mahalanobis change detection tests — SPEC Section 10 (Baseline & Change).
 */
import { mahalanobisDistance, ChangeDetector } from '../baseline/change-detector';
import type { PersonalBaseline } from '../../shared/types';

const baseline: PersonalBaseline = {
  kappaMean: 10.0,
  kappaSd: 2.0,
  giniMean: 0.4,
  giniSd: 0.05,
  spreadMean: 1.0,
  spreadSd: 0.3,
  bpmMean: 75,
  recordedAt: Date.now(),
  beatCount: 200,
};

describe('mahalanobisDistance', () => {
  test('distance = 0 when current equals baseline', () => {
    const d = mahalanobisDistance({ kappa: 10.0, gini: 0.4, spread: 1.0 }, baseline);
    expect(d).toBe(0);
  });

  test('distance increases with deviation', () => {
    const d1 = mahalanobisDistance({ kappa: 11.0, gini: 0.4, spread: 1.0 }, baseline);
    const d2 = mahalanobisDistance({ kappa: 15.0, gini: 0.4, spread: 1.0 }, baseline);
    expect(d2).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(0);
  });

  test('uses minimum sd floor to prevent division by near-zero', () => {
    const zeroSdBaseline: PersonalBaseline = {
      ...baseline,
      kappaSd: 0,
      giniSd: 0,
      spreadSd: 0,
    };
    const d = mahalanobisDistance({ kappa: 10.1, gini: 0.401, spread: 1.01 }, zeroSdBaseline);
    expect(isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });
});

describe('ChangeDetector', () => {
  let detector: ChangeDetector;

  beforeEach(() => {
    detector = new ChangeDetector();
  });

  test('learning state when no baseline', () => {
    const status = detector.update(null, null);
    expect(status.level).toBe('learning');
    expect(status.mahalanobisDistance).toBe(0);
  });

  test('distance = 0 when current = baseline → normal', () => {
    const status = detector.update(baseline, { kappa: 10.0, gini: 0.4, spread: 1.0 });
    expect(status.level).toBe('normal');
    expect(status.mahalanobisDistance).toBe(0);
  });

  test('distance = 2.5 → notice', () => {
    // Create a current that produces distance ~2.5
    // dk = (kappa - 10) / 2 = 2.5 when kappa = 15, dg=0, ds=0 → distance = 2.5
    const status = detector.update(baseline, { kappa: 15.0, gini: 0.4, spread: 1.0 });
    expect(status.level).toBe('notice');
    expect(status.mahalanobisDistance).toBeCloseTo(2.5, 1);
    expect(status.sustainedSince).not.toBeNull();
  });

  test('distance = 3.5 sustained < 60s → notice (not yet sustained)', () => {
    // dk = (kappa - 10) / 2 = 3.5 when kappa = 17
    const now = 1000000;
    detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now);
    // 30 seconds later — still not enough
    const status = detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now + 30000);
    expect(status.level).toBe('notice');
  });

  test('distance = 3.5 sustained ≥ 60s → alert', () => {
    const now = 1000000;
    detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now);
    // 61 seconds later
    const status = detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now + 61000);
    expect(status.level).toBe('alert');
    expect(status.sustainedSince).toBe(now);
  });

  test('distance drops back below 2 → normal, sustainedSince resets', () => {
    const now = 1000000;
    // First: above notice threshold
    detector.update(baseline, { kappa: 15.0, gini: 0.4, spread: 1.0 }, now);
    expect(detector.getLevel()).toBe('notice');

    // Then: back to normal
    const status = detector.update(baseline, { kappa: 10.0, gini: 0.4, spread: 1.0 }, now + 5000);
    expect(status.level).toBe('normal');
    expect(status.sustainedSince).toBeNull();
  });

  test('sustained timer starts at first crossing, not reset by intermediate updates', () => {
    const now = 1000000;
    detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now);
    detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now + 20000);
    detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now + 40000);
    const status = detector.update(baseline, { kappa: 17.0, gini: 0.4, spread: 1.0 }, now + 61000);
    expect(status.level).toBe('alert');
    expect(status.sustainedSince).toBe(now);
  });

  test('reset returns to learning state', () => {
    detector.update(baseline, { kappa: 15.0, gini: 0.4, spread: 1.0 });
    expect(detector.getLevel()).toBe('notice');

    detector.reset();
    expect(detector.getLevel()).toBe('learning');
  });
});
