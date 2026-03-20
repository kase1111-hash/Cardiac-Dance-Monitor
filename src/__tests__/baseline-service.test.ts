/**
 * Baseline learning module tests — SPEC Section 10 (Baseline & Change).
 *
 * countBeat() is called every raw PPI (every beat).
 * addSample() is called every DANCE_UPDATE_INTERVAL beats with computed features.
 * Baseline establishes after BASELINE_MIN_BEATS raw beats (not feature samples).
 */
import { BaselineService } from '../baseline/baseline-service';
import { MemoryStorage } from '../session/session-store';
import { BASELINE_MIN_BEATS, DANCE_UPDATE_INTERVAL } from '../../shared/constants';

/** Simulate N raw beats, calling addSample every DANCE_UPDATE_INTERVAL beats. */
function feedBeats(
  service: BaselineService,
  count: number,
  kappa = 10.0, gini = 0.4, spread = 1.0, bpm = 75,
) {
  for (let i = 1; i <= count; i++) {
    service.countBeat();
    if (i % DANCE_UPDATE_INTERVAL === 0) {
      service.addSample(kappa, gini, spread, bpm);
    }
  }
}

describe('BaselineService', () => {
  let storage: MemoryStorage;
  let service: BaselineService;

  beforeEach(() => {
    storage = new MemoryStorage();
    service = new BaselineService(storage);
  });

  test('baseline not established with < 200 raw beats', () => {
    feedBeats(service, 199);
    expect(service.getBaseline()).toBeNull();
    expect(service.isLearning()).toBe(true);
  });

  test('baseline established after 200+ raw beats with correct mean/sd', () => {
    feedBeats(service, BASELINE_MIN_BEATS);
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
    let sampleIdx = 0;
    for (let i = 1; i <= BASELINE_MIN_BEATS; i++) {
      service.countBeat();
      if (i % DANCE_UPDATE_INTERVAL === 0) {
        // Alternate +1/-1 by sample index to get mean ~10 with nonzero sd
        const kappa = 10.0 + (sampleIdx % 2 === 0 ? 1 : -1);
        service.addSample(kappa, 0.4, 1.0, 75);
        sampleIdx++;
      }
    }
    service.forceEstablish();

    const baseline = service.getBaseline();
    expect(baseline!.kappaMean).toBeCloseTo(10.0, 1);
    expect(baseline!.kappaSd).toBeGreaterThan(0);
  });

  test('baseline persists after simulated app restart', async () => {
    feedBeats(service, BASELINE_MIN_BEATS);
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
    feedBeats(service, BASELINE_MIN_BEATS);
    service.forceEstablish();
    expect(service.isLearning()).toBe(false);

    await service.reset();

    expect(service.getBaseline()).toBeNull();
    expect(service.isLearning()).toBe(true);
    expect(service.getLearningProgress()).toBe(0);
  });

  test('baseline is frozen — new data after establishment does NOT change stored values', () => {
    feedBeats(service, BASELINE_MIN_BEATS);
    service.forceEstablish();

    const baselineBefore = { ...service.getBaseline()! };

    // Feed very different data (these are ignored because frozen)
    for (let i = 0; i < 100; i++) {
      service.countBeat();
      service.addSample(50.0, 0.9, 5.0, 120);
    }

    const baselineAfter = service.getBaseline()!;
    expect(baselineAfter.kappaMean).toBe(baselineBefore.kappaMean);
    expect(baselineAfter.giniMean).toBe(baselineBefore.giniMean);
    expect(baselineAfter.spreadMean).toBe(baselineBefore.spreadMean);
  });

  test('learning progress tracks raw beats correctly', () => {
    expect(service.getLearningProgress()).toBe(0);

    feedBeats(service, 100);
    expect(service.getLearningProgress()).toBeCloseTo(0.5, 1);

    feedBeats(service, 100);
    expect(service.getLearningProgress()).toBe(1);
  });

  test('forceEstablish fails with < BASELINE_MIN_BEATS raw beats', () => {
    // Only 10 raw beats (1 feature sample)
    feedBeats(service, 10);
    expect(service.forceEstablish()).toBe(false);
    expect(service.getBaseline()).toBeNull();
  });
});
