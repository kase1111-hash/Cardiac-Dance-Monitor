/**
 * Regression tests for the demo-readiness fixes:
 *  - session storage split (index + per-session raw rows, upsert, read safety)
 *  - baseline namespaces, validation on load, force-establish floor
 *  - pipeline: first beat counted, dance hysteresis, history kept on reset
 */
import { SessionStore, MemoryStorage, StorageReadError } from '../session/session-store';
import type { Session, RawBeat } from '../session/session-types';
import { RAW_BEAT_CAP } from '../session/session-types';
import {
  BaselineService, BASELINE_KEY, BASELINE_PROGRESS_KEY, FORCE_ESTABLISH_MIN_SAMPLES,
} from '../baseline/baseline-service';
import { PipelineCore } from '../pipeline/pipeline-core';
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { BASELINE_MIN_BEATS, DANCE_UPDATE_INTERVAL } from '../../shared/constants';
import { AlertService } from '../alerts/alert-service';

function makeSession(id: string, overrides?: Partial<Session>): Session {
  return {
    id,
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_060_000,
    dominantDance: 'The Waltz',
    beatCount: 100,
    changeEvents: [],
    danceTransitions: [],
    summaryStats: { bpmMean: 75, kappaMedian: 10.5, giniMean: 0.39 },
    ...overrides,
  };
}

function makeRawBeats(n: number): RawBeat[] {
  const out: RawBeat[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      timestamp_ms: 1_700_000_000_000 + i * 800,
      ppi_ms: 800 + Math.sin(i) * 37.123456,
      source: 'simulated',
      raw_ppg: null,
      spo2: null,
      device_bpm: null,
      kappa: 7.7123456,
      gini: 0.3381234,
      spread: 0.3312345,
      dance: 'The Waltz',
      confidence: 0.6123456,
      baseline_distance: i > 40 ? 1.2345678 : null,
      trail_length: 20,
    });
  }
  return out;
}

describe('SessionStore: index + per-session raw rows', () => {
  let storage: MemoryStorage;
  let store: SessionStore;
  beforeEach(() => {
    storage = new MemoryStorage();
    store = new SessionStore(storage);
  });

  test('saveSession upserts by id instead of duplicating', async () => {
    await store.saveSession(makeSession('a', { beatCount: 10 }));
    await store.saveSession(makeSession('b'));
    await store.saveSession(makeSession('a', { beatCount: 250 }));
    const sessions = await store.getSessions();
    expect(sessions.map(s => s.id)).toEqual(['b', 'a']);
    expect(sessions.find(s => s.id === 'a')!.beatCount).toBe(250);
  });

  test('getSessions omits raw beats; getSession returns them from their own row', async () => {
    await store.saveSession(makeSession('a', { rawBeats: makeRawBeats(50) }));
    const [summary] = await store.getSessions();
    expect(summary.rawBeats).toBeUndefined();
    expect(summary.rawBeatCount).toBe(50);
    const full = await store.getSession('a');
    expect(full!.rawBeats!.length).toBe(50);
    expect(storage.keys()).toContain('cardiac_dance_raw:a');
  });

  test('raw row is removed with the session', async () => {
    await store.saveSession(makeSession('a', { rawBeats: makeRawBeats(5) }));
    await store.deleteSession('a');
    expect(storage.keys()).not.toContain('cardiac_dance_raw:a');
    expect(await store.getSession('a')).toBeNull();
  });

  test('legacy rows with inline raw beats are still readable', async () => {
    await storage.setItem('cardiac_dance_sessions', JSON.stringify([
      makeSession('old', { rawBeats: makeRawBeats(3) }),
    ]));
    const [summary] = await store.getSessions();
    expect(summary.rawBeats).toBeUndefined();
    expect(summary.rawBeatCount).toBe(3);
    const full = await store.getSession('old');
    expect(full!.rawBeats!.length).toBe(3);
  });

  test('a failed index read never lets a save overwrite history', async () => {
    await store.saveSession(makeSession('a'));
    const broken: MemoryStorage = Object.create(storage);
    broken.getItem = async (key: string) => {
      if (key === 'cardiac_dance_sessions') throw new StorageReadError(key, 'row too large');
      return storage.getItem(key);
    };
    const flaky = new SessionStore(broken);
    await expect(flaky.saveSession(makeSession('b'))).rejects.toBeInstanceOf(StorageReadError);
    expect((await store.getSessions()).map(s => s.id)).toEqual(['a']);
    expect(await flaky.getSessions()).toEqual([]); // listing degrades, does not throw
  });

  test('a capped session raw row stays under 1.5 MB', async () => {
    await store.saveSession(makeSession('big', { rawBeats: makeRawBeats(RAW_BEAT_CAP) }));
    const raw = await storage.getItem('cardiac_dance_raw:big');
    expect(Buffer.byteLength(raw!, 'utf8')).toBeLessThan(1.5 * 1024 * 1024);
    const index = await storage.getItem('cardiac_dance_sessions');
    expect(Buffer.byteLength(index!, 'utf8')).toBeLessThan(2000);
  });
});

function feedBeats(service: BaselineService, count: number, startMs = 1_700_000_000_000): number {
  let t = startMs;
  for (let i = 1; i <= count; i++) {
    service.countBeat(t);
    if (i % DANCE_UPDATE_INTERVAL === 0) service.addSample(8 + (i % 3), 0.33, 0.32, 75, t);
    t += 800;
  }
  return t;
}

describe('BaselineService: namespaces and safety', () => {
  test('simulated and sensor baselines live under different keys', async () => {
    const storage = new MemoryStorage();
    const sim = new BaselineService(storage, { namespace: 'simulated' });
    feedBeats(sim, BASELINE_MIN_BEATS + 10);
    expect(sim.forceEstablish()).toBe(true);
    expect(await sim.save()).toBe(true);
    expect(storage.keys()).toContain(`${BASELINE_KEY}:simulated`);
    expect(storage.keys()).not.toContain(BASELINE_KEY);

    const sensor = new BaselineService(storage); // legacy keys
    expect(await sensor.load()).toBeNull();
    expect(sensor.isLearning()).toBe(true);
  });

  test('activateNamespace checkpoints learning and reloads the other baseline', async () => {
    const storage = new MemoryStorage();
    const svc = new BaselineService(storage, { namespace: 'simulated' });
    await svc.load();
    feedBeats(svc, 120);
    expect(svc.getSampleCount()).toBe(120);

    expect(await svc.activateNamespace('sensor')).toBeNull();
    expect(svc.getSampleCount()).toBe(0);
    expect(storage.keys()).toContain(`${BASELINE_PROGRESS_KEY}:simulated`);

    const back = await svc.activateNamespace('simulated');
    expect(back).toBeNull();
    expect(svc.getSampleCount()).toBe(120); // progress restored
  });

  test('a restored baseline reports the beats it was built from', async () => {
    const storage = new MemoryStorage();
    const a = new BaselineService(storage);
    feedBeats(a, 230);
    expect(a.forceEstablish()).toBe(true);
    await a.save();
    const b = new BaselineService(storage);
    const loaded = await b.load();
    expect(loaded!.beatCount).toBe(230);
    expect(b.getSampleCount()).toBe(230);
  });

  test('a malformed stored baseline is discarded instead of frozen as NaN', async () => {
    const storage = new MemoryStorage();
    await storage.setItem(BASELINE_KEY, '{}');
    const svc = new BaselineService(storage);
    expect(await svc.load()).toBeNull();
    expect(svc.isLearning()).toBe(true);
  });

  test('forceEstablish needs the feature-window floor, not just raw beats', () => {
    const svc = new BaselineService(new MemoryStorage());
    for (let i = 0; i < BASELINE_MIN_BEATS + 5; i++) svc.countBeat(1_700_000_000_000 + i * 800);
    for (let i = 0; i < FORCE_ESTABLISH_MIN_SAMPLES - 1; i++) svc.addSample(8, 0.33, 0.32, 75);
    expect(svc.forceEstablish()).toBe(false);
    svc.addSample(8, 0.33, 0.32, 75);
    expect(svc.forceEstablish()).toBe(true);
  });
});

function runScenario(core: PipelineCore, scenario: RhythmScenario, beats: number, t0: number): number {
  const sim = new RhythmSimulator({ scenario });
  let t = t0;
  for (let i = 0; i < beats; i++) {
    const ppi = sim.next();
    t += ppi;
    core.processBeat(ppi, t);
  }
  return t;
}

describe('PipelineCore: demo-flow behaviours', () => {
  test('every raw beat counts toward the baseline, including the first', () => {
    const bs = new BaselineService(new MemoryStorage(), { namespace: 'simulated' });
    const core = new PipelineCore(bs);
    runScenario(core, 'nsr', BASELINE_MIN_BEATS, 1_700_000_000_000);
    expect(bs.getSampleCount()).toBe(BASELINE_MIN_BEATS);
    expect(bs.getFeatureSampleCount()).toBeGreaterThanOrEqual(FORCE_ESTABLISH_MIN_SAMPLES);
    expect(bs.forceEstablish()).toBe(true);
  });

  test('reset({ keepHistory }) preserves the rate-vs-geometry trend', () => {
    const core = new PipelineCore(new BaselineService(new MemoryStorage()));
    runScenario(core, 'nsr', 120, 1_700_000_000_000);
    const before = core.getState().featureHistory.length;
    expect(before).toBeGreaterThanOrEqual(5);
    core.reset({ keepHistory: true });
    expect(core.getState().featureHistory.length).toBe(before);
    expect(core.getState().totalBeats).toBe(0);
    core.reset();
    expect(core.getState().featureHistory.length).toBe(0);
  });

  test('the displayed dance never flips on a single disagreeing window', () => {
    // Drive many seeds through NSR and count single-window flips: with
    // two-window hysteresis a name must hold for at least two windows.
    let singleWindowFlips = 0;
    for (let seed = 0; seed < 12; seed++) {
      const core = new PipelineCore(new BaselineService(new MemoryStorage()));
      const sim = new RhythmSimulator({ scenario: 'nsr' });
      let t = 1_700_000_000_000 + seed;
      const names: string[] = [];
      for (let i = 0; i < 400; i++) {
        const ppi = sim.next();
        t += ppi;
        const s = core.processBeat(ppi, t);
        if (s.totalBeats % DANCE_UPDATE_INTERVAL === 0 && s.danceMatch) names.push(s.danceMatch.name);
      }
      for (let i = 1; i < names.length - 1; i++) {
        if (names[i] !== names[i - 1] && names[i] !== names[i + 1]) singleWindowFlips++;
      }
    }
    expect(singleWindowFlips).toBe(0);
  });

  test('Mosh Pit after a forced Waltz baseline reaches notice then alert', () => {
    const bs = new BaselineService(new MemoryStorage(), { namespace: 'simulated' });
    const core = new PipelineCore(bs);
    let t = runScenario(core, 'nsr', 210, 1_700_000_000_000);
    expect(bs.forceEstablish()).toBe(true);
    core.reset({ keepHistory: true });
    const sim = new RhythmSimulator({ scenario: 'af' });
    let firstNotice: number | null = null;
    let firstAlert: number | null = null;
    for (let i = 0; i < 200; i++) {
      const ppi = sim.next();
      t += ppi;
      const s = core.processBeat(ppi, t);
      if (firstNotice === null && (s.changeLevel === 'notice' || s.changeLevel === 'alert')) firstNotice = s.totalBeats;
      if (firstAlert === null && s.changeLevel === 'alert') firstAlert = s.totalBeats;
    }
    expect(firstNotice).not.toBeNull();
    expect(firstNotice!).toBeLessThanOrEqual(60);
    expect(firstAlert).not.toBeNull();
  });
});

describe('AlertService.clearSuppression', () => {
  test('a scenario switch can alert again yet still reports recovery', () => {
    const svc = new AlertService();
    const t0 = 1_700_000_000_000;
    svc.processLevelChange('normal', 1, 'The Waltz', t0);
    expect(svc.processLevelChange('alert', 40, 'The Mosh Pit', t0 + 1000).map(e => e.type)).toEqual(['alert']);
    // Second run of the demo two minutes later: suppressed without the clear...
    svc.processLevelChange('normal', 1, 'The Waltz', t0 + 60_000);
    expect(svc.processLevelChange('alert', 40, 'The Mosh Pit', t0 + 120_000)).toEqual([]);
    // ...but after clearSuppression the alert fires and recovery still works.
    svc.clearSuppression();
    svc.processLevelChange('normal', 1, 'The Waltz', t0 + 130_000);
    expect(svc.processLevelChange('alert', 40, 'The Mosh Pit', t0 + 140_000).map(e => e.type)).toEqual(['alert']);
    svc.clearSuppression();
    expect(svc.processLevelChange('normal', 1, 'The Waltz', t0 + 150_000).map(e => e.type)).toEqual(['recovery']);
  });
});
