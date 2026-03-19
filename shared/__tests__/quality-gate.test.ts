/**
 * Quality gate unit tests — test vectors from SPEC.md Section 10.
 * Written FIRST (TDD) before implementation.
 */
import { QualityGate } from '../quality-gate';
import { PPI_MIN, PPI_MAX, QUALITY_GOOD, QUALITY_FAIR } from '../constants';

describe('QualityGate', () => {
  let gate: QualityGate;

  beforeEach(() => {
    gate = new QualityGate();
  });

  describe('range rejection', () => {
    test('PPI = 299 → rejected', () => {
      expect(gate.check(299)).toBe(false);
    });

    test('PPI = 1501 → rejected', () => {
      expect(gate.check(1501)).toBe(false);
    });

    test('PPI = 300 → accepted', () => {
      expect(gate.check(300)).toBe(true);
    });

    test('PPI = 1500 → accepted', () => {
      // Seed the median first so deviation check doesn't reject
      for (let i = 0; i < 15; i++) gate.check(1400);
      expect(gate.check(1500)).toBe(true);
    });
  });

  describe('deviation rejection', () => {
    test('PPI = 800 when median = 800 → accepted', () => {
      // Seed the median with 800ms PPIs
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.check(800)).toBe(true);
    });

    test('PPI = 1200 when median = 800 → rejected (>40% deviation)', () => {
      // Seed the median with 800ms PPIs
      for (let i = 0; i < 15; i++) gate.check(800);
      // 1200 is 50% above 800 → exceeds 40% threshold
      expect(gate.check(1200)).toBe(false);
    });

    test('PPI within 40% deviation is accepted', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      // 800 * 1.39 = 1112 → within 40%
      expect(gate.check(1112)).toBe(true);
    });
  });

  describe('acceptance rate', () => {
    test('all accepted → quality GOOD', () => {
      for (let i = 0; i < 30; i++) gate.check(800);
      expect(gate.getAcceptanceRate()).toBeGreaterThanOrEqual(QUALITY_GOOD);
    });

    test('quality level tracks correctly', () => {
      for (let i = 0; i < 30; i++) gate.check(800);
      expect(gate.getQualityLevel()).toBe('good');
    });
  });

  describe('running median', () => {
    test('median updates as new values arrive', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.getRunningMedian()).toBe(800);
    });

    test('first PPI is always accepted if in range (no median yet)', () => {
      expect(gate.check(800)).toBe(true);
    });
  });
});
