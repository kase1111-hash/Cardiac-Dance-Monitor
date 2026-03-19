/**
 * Baseline learning module tests — SPEC Section 10 (Baseline & Change).
 */
import { BaselineService } from '../baseline/baseline-service';
import { MemoryStorage } from '../session/session-store';
import { BASELINE_MIN_BEATS } from '../../shared/constants';

describe('BaselineService', () => {
  let storage: MemoryStorage;
  let service: BaselineService;

  beforeEach(() => {
    storage = new MemoryStorage();
    service = new BaselineService(storage);
  });

  test('baseline not established with < 200 beats', () => {
    for (let i = 0; i < 199; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    expect(service.getBaseline()).toBeNull();
    expect(service.isLearning()).toBe(true);
  });

  test('baseline established after 200+ beats with correct mean/sd', () => {
    // Feed samples with known values
    for (let i = 0; i < BASELINE_MIN_BEATS; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    // Duration check won't pass in test (only ms elapsed), so force-establish
    service.forceEstablish();

    const baseline = service.getBaseline();
    expect(baseline).not.toBeNull();
    expect(baseline!.kappaMean).toBeCloseTo(10.0, 1);
    expect(baseline!.giniMean).toBeCloseTo(0.4, 2);
    expect(baseline!.spreadMean).toBeCloseTo(1.0, 1);
    expect(baseline!.bpmMean).toBe(75);
    expect(baseline!.beatCount).toBe(BASELINE_MIN_BEATS);
    // Std should be 0 for constant input
    expect(baseline!.kappaSd).toBeCloseTo(0, 5);
  });

  test('baseline established with variable data has nonzero sd', () => {
    for (let i = 0; i < BASELINE_MIN_BEATS; i++) {
      const kappa = 10.0 + (i % 2 === 0 ? 1 : -1);
      service.addSample(kappa, 0.4, 1.0, 75);
    }
    service.forceEstablish();

    const baseline = service.getBaseline();
    expect(baseline!.kappaMean).toBeCloseTo(10.0, 1);
    expect(baseline!.kappaSd).toBeGreaterThan(0);
  });

  test('baseline persists after simulated app restart', async () => {
    for (let i = 0; i < BASELINE_MIN_BEATS; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    service.forceEstablish();
    await service.save();

    // Simulate app restart — new service instance, same storage
    const service2 = new BaselineService(storage);
    const loaded = await service2.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.kappaMean).toBeCloseTo(10.0, 1);
    expect(loaded!.giniMean).toBeCloseTo(0.4, 2);
    expect(service2.isLearning()).toBe(false);
  });

  test('reset clears baseline and re-enters learning mode', async () => {
    for (let i = 0; i < BASELINE_MIN_BEATS; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    service.forceEstablish();
    expect(service.isLearning()).toBe(false);

    await service.reset();

    expect(service.getBaseline()).toBeNull();
    expect(service.isLearning()).toBe(true);
    expect(service.getLearningProgress()).toBe(0);
  });

  test('baseline is frozen — new data after establishment does NOT change stored values', () => {
    for (let i = 0; i < BASELINE_MIN_BEATS; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    service.forceEstablish();

    const baselineBefore = { ...service.getBaseline()! };

    // Feed very different data
    for (let i = 0; i < 100; i++) {
      service.addSample(50.0, 0.9, 5.0, 120);
    }

    const baselineAfter = service.getBaseline()!;
    expect(baselineAfter.kappaMean).toBe(baselineBefore.kappaMean);
    expect(baselineAfter.giniMean).toBe(baselineBefore.giniMean);
    expect(baselineAfter.spreadMean).toBe(baselineBefore.spreadMean);
  });

  test('learning progress tracks correctly', () => {
    expect(service.getLearningProgress()).toBe(0);

    for (let i = 0; i < 100; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    expect(service.getLearningProgress()).toBeCloseTo(0.5, 1);

    for (let i = 0; i < 100; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    expect(service.getLearningProgress()).toBe(1);
  });

  test('forceEstablish fails with < BASELINE_MIN_BEATS samples', () => {
    for (let i = 0; i < 10; i++) {
      service.addSample(10.0, 0.4, 1.0, 75);
    }
    expect(service.forceEstablish()).toBe(false);
    expect(service.getBaseline()).toBeNull();
  });
});
