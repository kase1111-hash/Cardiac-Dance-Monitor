/**
 * Baseline learning module tests — SPEC Section 10 (Baseline & Change).
 *
 * countBeat() is called every raw PPI (every beat).
 * addSample() is called every DANCE_UPDATE_INTERVAL beats with computed features.
 * Baseline establishes after BASELINE_MIN_BEATS raw beats (not feature samples).
 */
import { BaselineService } from '../baseline/baseline-service';
import { MemoryStorage } from '../session/session-store';
import {
  BASELINE_MIN_BEATS, BASELINE_DURATION, DANCE_UPDATE_INTERVAL,
} from '../../shared/constants';

/**
 * Simulate N raw beats, calling addSample every DANCE_UPDATE_INTERVAL beats.
 *
 * Beats are 800ms apart by default (~75 BPM), and time is passed explicitly:
 * the 5-minute rule counts OBSERVED rhythm, summed beat to beat, so beats
 * with no time between them advance the beat count and nothing else.
 * Returns the timestamp after the last beat so callers can chain sessions.
 */
function feedBeats(
  service: BaselineService,
  count: number,
  opts: { kappa?: number; gini?: number; spread?: number; bpm?: number; startMs?: number; ppiMs?: number } = {},
): number {
  const { kappa = 10.0, gini = 0.4, spread = 1.0, bpm = 75, startMs = 1_700_000_000_000, ppiMs = 800 } = opts;
  let t = startMs;
  for (let i = 1; i <= count; i++) {
    service.countBeat(t);
    if (i % DANCE_UPDATE_INTERVAL === 0) {
      service.addSample(kappa, gini, spread, bpm, t);
    }
    t += ppiMs;
  }
  return t;
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
    // 200 beats is only ~160s of rhythm, short of the 5-minute rule, so
    // force-establish to exercise the statistics on their own.
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
    let t = 1_700_000_000_000;
    for (let i = 1; i <= BASELINE_MIN_BEATS; i++) {
      service.countBeat(t);
      if (i % DANCE_UPDATE_INTERVAL === 0) {
        // Alternate +1/-1 by sample index to get mean ~10 with nonzero sd
        const kappa = 10.0 + (sampleIdx % 2 === 0 ? 1 : -1);
        service.addSample(kappa, 0.4, 1.0, 75, t);
        sampleIdx++;
      }
      t += 800;
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
    feedBeats(service, 100, { kappa: 50.0, gini: 0.9, spread: 5.0, bpm: 120 });

    const baselineAfter = service.getBaseline()!;
    expect(baselineAfter.kappaMean).toBe(baselineBefore.kappaMean);
    expect(baselineAfter.giniMean).toBe(baselineBefore.giniMean);
    expect(baselineAfter.spreadMean).toBe(baselineBefore.spreadMean);
  });

  test('learning progress reports whichever rule is furthest from being met', () => {
    expect(service.getLearningProgress()).toBe(0);

    // 100 beats = 50% of the beat rule, but only 80s = 27% of the 5-minute
    // rule. The bar must show the rule the user is actually waiting on.
    const t = feedBeats(service, 100);
    expect(service.getLearningProgress()).toBeCloseTo(80 / BASELINE_DURATION, 2);

    // Enough further rhythm to satisfy both.
    feedBeats(service, 300, { startMs: t });
    expect(service.getLearningProgress()).toBe(1);
  });

  test('forceEstablish fails with < BASELINE_MIN_BEATS raw beats', () => {
    // Only 10 raw beats (1 feature sample)
    feedBeats(service, 10);
    expect(service.forceEstablish()).toBe(false);
    expect(service.getBaseline()).toBeNull();
  });
});

describe('Learning that survives app restarts', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  /** One session: fresh service (a cold launch), N beats, then flush. */
  async function session(beats: number, startMs: number, ppiMs = 800): Promise<number> {
    const service = new BaselineService(storage);
    await service.load();
    const end = feedBeats(service, beats, { startMs, ppiMs });
    if (service.isLearning()) await service.saveProgress();
    else await service.save();
    return end;
  }

  test('short sessions accumulate toward the baseline instead of starting over', async () => {
    // Ten 2-minute sessions, a day apart. None is long enough on its own;
    // together they are 1,500 beats and 20 minutes of observed rhythm.
    // Before progress was persisted, this established nothing, ever.
    let established: BaselineService | null = null;
    for (let day = 0; day < 10; day++) {
      const service = new BaselineService(storage);
      await service.load();
      if (!service.isLearning()) { established = service; break; }
      feedBeats(service, 150, { startMs: 1_700_000_000_000 + day * 86_400_000 });
      if (service.isLearning()) await service.saveProgress();
      else { await service.save(); established = service; break; }
    }

    expect(established).not.toBeNull();
    const baseline = established!.getBaseline()!;
    expect(baseline.beatCount).toBeGreaterThanOrEqual(BASELINE_MIN_BEATS);
    // Established on the session that crossed 5 minutes of observed rhythm:
    // 300s / (150 beats x 0.8s) = the third session.
    expect(baseline.beatCount).toBeLessThanOrEqual(3 * 150);
  });

  test('progress resumes at the right point after a restart', async () => {
    await session(150, 1_700_000_000_000);

    const next = new BaselineService(storage);
    await next.load();
    expect(next.getSampleCount()).toBe(150);
    // 149 intervals of 800ms — the gap between sessions is not rhythm.
    expect(next.getObservedMs()).toBeCloseTo(149 * 800, -2);
    expect(next.getLearningProgress()).toBeCloseTo((149 * 0.8) / BASELINE_DURATION, 2);
  });

  test('time between sessions is not credited as observed rhythm', async () => {
    // Two sessions a day apart. If the wall clock counted, the second
    // session would establish a baseline immediately off 24 hours "elapsed".
    await session(150, 1_700_000_000_000);
    await session(60, 1_700_000_000_000 + 86_400_000);

    const third = new BaselineService(storage);
    await third.load();
    expect(third.isLearning()).toBe(true);
    expect(third.getSampleCount()).toBe(210);          // past the beat rule
    expect(third.getObservedMs()).toBeLessThan(BASELINE_DURATION * 1000); // not the time rule
  });

  test('an established baseline retires the progress record', async () => {
    const service = new BaselineService(storage);
    await service.load();
    feedBeats(service, 400); // 400 beats, ~5.3 minutes — satisfies both rules
    expect(service.isLearning()).toBe(false);
    await service.save();

    // A later launch loads the baseline and does not resurrect learning state.
    const next = new BaselineService(storage);
    const loaded = await next.load();
    expect(loaded).not.toBeNull();
    expect(next.isLearning()).toBe(false);
    expect(next.getLearningProgress()).toBe(1);
  });

  test('resetting the baseline also discards accumulated progress', async () => {
    await session(150, 1_700_000_000_000);

    const service = new BaselineService(storage);
    await service.load();
    expect(service.getSampleCount()).toBe(150);
    await service.reset();

    const after = new BaselineService(storage);
    await after.load();
    expect(after.getSampleCount()).toBe(0);
    expect(after.getObservedMs()).toBe(0);
    expect(after.getLearningProgress()).toBe(0);
  });

  test('a dropout inside a session is not credited either', async () => {
    const service = new BaselineService(storage);
    await service.load();
    const end = feedBeats(service, 100, { startMs: 1_700_000_000_000 });
    // 30 minutes of silence, then more beats.
    feedBeats(service, 100, { startMs: end + 30 * 60_000 });

    expect(service.isLearning()).toBe(true);
    expect(service.getSampleCount()).toBe(200);
    // ~160s of rhythm observed, not 30+ minutes.
    expect(service.getObservedMs()).toBeLessThan(170_000);
  });

  test('corrupt progress is discarded rather than crashing a launch', async () => {
    await storage.setItem('personal_baseline_progress', '{not json');
    const service = new BaselineService(storage);
    await expect(service.load()).resolves.toBeNull();
    expect(service.getSampleCount()).toBe(0);
    expect(service.isLearning()).toBe(true);
  });
});
