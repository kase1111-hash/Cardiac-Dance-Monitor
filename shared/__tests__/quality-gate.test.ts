/**
 * Quality gate unit tests — test vectors from SPEC.md Section 10.
 *
 * Updated for the two-tier gate: RANGE decides pipeline admission,
 * DEVIATION only drives the signal-quality badge. See quality-gate.ts for why
 * deviation must not exclude beats (an arrhythmia *is* deviation).
 */
import { QualityGate } from '../quality-gate';
import { QUALITY_GOOD, QUALITY_FAIR } from '../constants';

describe('QualityGate', () => {
  let gate: QualityGate;

  beforeEach(() => {
    gate = new QualityGate();
  });

  describe('range rejection (tier 1 — pipeline admission)', () => {
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
      for (let i = 0; i < 15; i++) gate.check(1400);
      expect(gate.check(1500)).toBe(true);
    });

    test('NaN → rejected (must not poison downstream metrics)', () => {
      expect(gate.check(NaN)).toBe(false);
    });

    test('Infinity → rejected', () => {
      expect(gate.check(Infinity)).toBe(false);
      expect(gate.check(-Infinity)).toBe(false);
    });
  });

  describe('deviation (tier 2 — quality signal only)', () => {
    test('PPI = 800 when median = 800 → admitted and clean', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.checkBeat(800)).toEqual({ valid: true, deviant: false });
    });

    test('PPI = 1200 when median = 800 → still ADMITTED, but flagged deviant', () => {
      // 1200 is 50% above 800 → exceeds the 40% threshold.
      // This is the PVC/ectopy case: real beat, must reach the pipeline.
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.checkBeat(1200)).toEqual({ valid: true, deviant: true });
    });

    test('PPI within 40% deviation is admitted and clean', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.checkBeat(1112)).toEqual({ valid: true, deviant: false });
    });

    test('sustained deviant beats degrade quality without blocking admission', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      for (let i = 0; i < 20; i++) {
        expect(gate.check(1300)).toBe(true); // every beat still admitted
      }
      expect(gate.getQualityLevel()).not.toBe('good'); // but quality reports poorly
    });
  });

  describe('acceptance rate', () => {
    test('all clean → quality GOOD', () => {
      for (let i = 0; i < 30; i++) gate.check(800);
      expect(gate.getAcceptanceRate()).toBeGreaterThanOrEqual(QUALITY_GOOD);
    });

    test('quality level tracks correctly', () => {
      for (let i = 0; i < 30; i++) gate.check(800);
      expect(gate.getQualityLevel()).toBe('good');
    });

    test('out-of-range artifacts drive quality down', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      for (let i = 0; i < 15; i++) gate.check(50);
      expect(gate.getAcceptanceRate()).toBeLessThan(QUALITY_FAIR);
    });
  });

  describe('running median (FIFO — must track real rate changes)', () => {
    test('median updates as new values arrive', () => {
      for (let i = 0; i < 15; i++) gate.check(800);
      expect(gate.getRunningMedian()).toBe(800);
    });

    test('first PPI is always accepted if in range (no median yet)', () => {
      expect(gate.check(800)).toBe(true);
    });

    test('median follows a sustained rate change (no ratchet)', () => {
      // REGRESSION: evicting the smallest value instead of the oldest made the
      // median monotonically non-decreasing, so it never tracked downward and
      // a user climbing stairs had their beats silently rejected forever.
      for (let i = 0; i < 15; i++) gate.check(1000);
      expect(gate.getRunningMedian()).toBe(1000);
      for (let i = 0; i < 15; i++) gate.check(900);
      expect(gate.getRunningMedian()).toBe(900);
    });

    test('a single outlier is evicted by age, not retained forever', () => {
      for (let i = 0; i < 15; i++) gate.check(1000);
      gate.check(1400); // one-off outlier, admitted
      for (let i = 0; i < 15; i++) gate.check(1000);
      expect(gate.getRunningMedian()).toBe(1000);
    });

    test('sustained heart-rate increase stays admitted end to end', () => {
      // Rest at 1000ms, ramp to 600ms (exercise), then hold.
      let admitted = 0;
      let total = 0;
      for (let i = 0; i < 100; i++) { if (gate.check(1000)) admitted++; total++; }
      for (let i = 0; i < 80; i++) { if (gate.check(Math.round(1000 - (400 * i) / 80))) admitted++; total++; }
      for (let i = 0; i < 100; i++) { if (gate.check(600)) admitted++; total++; }
      expect(admitted).toBe(total);
      expect(gate.getRunningMedian()).toBe(600);
    });
  });
});
