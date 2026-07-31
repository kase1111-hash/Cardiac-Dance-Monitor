/**
 * LONG-RUN AND MULTI-SESSION VALIDATION.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every other suite proves the pipeline works for ONE short session from a
 * cold start: a few hundred beats, a baseline it learned itself, and a
 * verdict at the end. Real use is neither short nor singular. A user wears
 * the sensor for hours, and comes back tomorrow, and the week after — and
 * the app's stated primary value (change detection against a PERSONAL
 * baseline) only exists across that span. Bugs that need hours or a second
 * launch to appear were invisible to the rest of the suite:
 *
 *   - state that grows without bound over 30,000 beats
 *   - a dance that holds for 5 minutes and drifts by hour six
 *   - a baseline that silently re-learns, or is rewritten, on session two
 *   - stale geometry, dance, or sustained-deviation state leaking from the
 *     previous session into the next
 *   - the change detector crying wolf on a rhythm that never changed
 *
 * Sessions here are driven through `replaySessions`, which persists the
 * baseline through storage and gives each session a cold PipelineCore —
 * exactly what closing and reopening the app does.
 *
 * All timing comes from recording timestamps, so an "8-hour" run costs
 * about a second of wall clock.
 */
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import {
  TORUS_WINDOW, CHANGE_ALERT_SIGMA, BASELINE_MIN_BEATS, BASELINE_DURATION,
} from '../../shared/constants';
import { PipelineCore } from '../pipeline/pipeline-core';
import { BaselineService } from '../baseline/baseline-service';
import { MemoryStorage, SessionStore } from '../session/session-store';
import type { Session } from '../session/session-types';
import {
  replaySession, replaySessions, formatMultiSessionReport,
  type ReplayBeat, type ReplayResult,
} from '../replay/session-replay';

/** Deterministic PRNG so hour-scale threshold assertions never flake. */
function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let randomSpy: jest.SpyInstance;
afterEach(() => randomSpy?.mockRestore());

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

/** A timestamped recording of `count` beats of one rhythm. */
function recording(
  scenario: RhythmScenario,
  count: number,
  startMs: number,
  seed = 42,
): ReplayBeat[] {
  randomSpy = jest.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
  const sim = new RhythmSimulator({ scenario });
  const beats: ReplayBeat[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    const ppi = sim.next();
    t += ppi;
    beats.push({ ppi, timestampMs: t });
  }
  return beats;
}

/** Windows that carry a change verdict (i.e. after the baseline froze). */
function gradedWindows(r: ReplayResult) {
  return r.windows.filter(w => w.changeLevel !== 'learning');
}

/** Most frequent dance across a slice of windows. */
function dominantDance(windows: ReplayResult['windows']): string | null {
  const counts: Record<string, number> = {};
  for (const w of windows) {
    if (w.dance) counts[w.dance] = (counts[w.dance] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const EXPECTED: Record<string, string> = {
  nsr: 'The Waltz',
  chf: 'The Lock-Step',
  af: 'The Mosh Pit',
  pvc: 'The Stumble',
};

// ---------------------------------------------------------------------------

describe('Endurance — one very long session', () => {
  test('8 hours of NSR is The Waltz from the first window to the last', async () => {
    // 36,000 beats at ~75 BPM = 8 hours of wear.
    const result = await replaySession(recording('nsr', 36_000, T0));

    expect(result.durationMs).toBeGreaterThan(7.5 * 3.6e6);
    expect(result.rejectedBeats).toBe(0);
    expect(result.gapCount).toBe(0);
    expect(result.acceptedBeats).toBe(36_000);

    const total = result.windows.length;
    const waltz = result.danceDistribution['The Waltz'] ?? 0;
    expect(waltz / total).toBeGreaterThan(0.95);

    // The identification must not drift with time-on-wrist: the last hour
    // has to agree with the first.
    const tenth = Math.floor(total / 10);
    expect(dominantDance(result.windows.slice(0, tenth))).toBe('The Waltz');
    expect(dominantDance(result.windows.slice(-tenth))).toBe('The Waltz');
  }, 120_000);

  test.each(Object.entries(EXPECTED))(
    'a multi-hour %s recording holds "%s" for its whole length',
    async (scenario, expected) => {
      const result = await replaySession(
        recording(scenario as RhythmScenario, 20_000, T0),
      );
      const total = result.windows.length;
      const tenth = Math.floor(total / 10);
      expect(dominantDance(result.windows.slice(0, tenth))).toBe(expected);
      expect(dominantDance(result.windows.slice(-tenth))).toBe(expected);
      expect((result.danceDistribution[expected] ?? 0) / total).toBeGreaterThan(0.95);
      // Continuous beats must never be mistaken for a sensor dropout.
      expect(result.gapCount).toBe(0);
    },
    120_000,
  );

  test('pipeline state stays bounded over 36,000 beats', async () => {
    // Ring buffers that leak show up as memory growth on an overnight
    // recording long before any assertion about dances would fail.
    const service = new BaselineService(new MemoryStorage());
    const core = new PipelineCore(service);
    const beats = recording('nsr', 36_000, T0);

    let t = T0;
    const sizesAt: number[] = [];
    for (let i = 0; i < beats.length; i++) {
      t = beats[i].timestampMs;
      const s = core.processBeat(beats[i].ppi, t);
      if (i === 1_000 || i === 20_000 || i === 35_999) {
        sizesAt.push(s.displayPoints.length + s.featureHistory.length);
      }
    }

    const final = core.getState();
    expect(final.totalBeats).toBe(36_000);
    expect(final.displayPoints.length).toBeLessThanOrEqual(TORUS_WINDOW);
    expect(final.featureHistory.length).toBeLessThanOrEqual(30);
    // Same footprint early, mid and late — no slow accumulation.
    expect(new Set(sizesAt).size).toBe(1);
  }, 120_000);

  test('the baseline is established once and frozen for the rest of the session', async () => {
    const result = await replaySession(recording('nsr', 20_000, T0));

    expect(result.baselineEstablished).toBe(true);
    const baseline = result.baseline!;
    // Frozen at the threshold, not re-derived from all 20,000 beats.
    expect(baseline.beatCount).toBeGreaterThanOrEqual(BASELINE_MIN_BEATS);
    expect(baseline.beatCount).toBeLessThan(600);
    // ...and established shortly after the 5-minute rule was satisfied.
    const elapsedSec = (baseline.recordedAt - T0) / 1000;
    expect(elapsedSec).toBeGreaterThanOrEqual(BASELINE_DURATION);
    expect(elapsedSec).toBeLessThan(BASELINE_DURATION + 120);
  }, 120_000);

  test('an overnight recording with repeated dropouts keeps its identity', async () => {
    // 12 blocks of ~30 minutes of wear separated by 10-minute dropouts —
    // a loose strap overnight.
    randomSpy = jest.spyOn(Math, 'random').mockImplementation(seededRandom(7));
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const beats: ReplayBeat[] = [];
    let t = T0;
    for (let block = 0; block < 12; block++) {
      for (let i = 0; i < 2_250; i++) {
        const ppi = sim.next();
        t += ppi;
        beats.push({ ppi, timestampMs: t });
      }
      t += 10 * 60_000;
    }

    const result = await replaySession(beats);

    expect(result.gapCount).toBe(11); // one per dropout, no more
    const total = result.windows.length;
    expect((result.danceDistribution['The Waltz'] ?? 0) / total).toBeGreaterThan(0.95);
    // Post-gap windows must not be dominated by warm-up misreads.
    expect(dominantDance(result.windows.slice(-Math.floor(total / 10)))).toBe('The Waltz');
  }, 120_000);

  test('hours of dead time cannot satisfy the 5-minute baseline rule', async () => {
    // 250 beats — over the 200-beat minimum — but only ~100 seconds of
    // observed rhythm, with a 30-minute dropout in the middle. Wall-clock
    // elapsed time is 30+ minutes; observed time is not, and only observed
    // time may establish a personal baseline.
    const beats: ReplayBeat[] = [];
    let t = T0;
    for (let i = 0; i < 100; i++) { t += 400; beats.push({ ppi: 400, timestampMs: t }); }
    t += 30 * 60_000;
    for (let i = 0; i < 150; i++) { t += 400; beats.push({ ppi: 400, timestampMs: t }); }

    const result = await replaySession(beats);

    expect(result.acceptedBeats).toBe(250);
    expect(result.gapCount).toBe(1);
    expect(result.baselineEstablished).toBe(false);
    expect(result.baseline).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('Continuity — a baseline across many sessions', () => {
  test('a baseline learned on day 1 is reused unchanged for a week', async () => {
    const week = Array.from({ length: 7 }, (_, day) =>
      recording('nsr', 500, T0 + day * DAY, day + 1),
    );
    const run = await replaySessions(week);

    expect(run.baselineEstablishedInSession).toBe(0);
    // Frozen means exactly one value was ever persisted.
    expect(run.baselineRevisions).toBe(1);
    expect(run.finalBaseline).not.toBeNull();

    const day1 = run.sessions[0].baseline!;
    for (const session of run.sessions.slice(1)) {
      // Every later session loaded the day-1 baseline from storage...
      expect(session.baselineEstablished).toBe(true);
      expect(session.baseline).toEqual(day1);
      // ...and re-learned nothing.
      expect(session.windows.some(w => w.changeLevel === 'learning')).toBe(false);
    }
    expect(run.finalBaseline).toEqual(day1);
  }, 120_000);

  test('later sessions are graded from their very first feature window', async () => {
    const run = await replaySessions([
      recording('nsr', 500, T0, 1),
      recording('nsr', 300, T0 + DAY, 2),
    ]);

    const followUp = run.sessions[1];
    expect(followUp.windows.length).toBeGreaterThan(0);
    expect(followUp.windows[0].changeLevel).not.toBe('learning');
    // "Learning your pattern..." must not reappear on a returning user.
    expect(followUp.windows.every(w => w.changeLevel !== 'learning')).toBe(true);
  });

  test('sessions shorter than the rule never accumulate a baseline', async () => {
    // GAP, DOCUMENTED: baseline progress (raw beats and learning start time)
    // lives only in the BaselineService instance, so it is discarded when the
    // app closes. Ten 2-minute sessions total 1,500 beats and 20 minutes of
    // rhythm — well past 200 beats and 5 minutes in aggregate — and still
    // establish nothing. A user who only ever monitors briefly therefore
    // never gets change detection at all, and nothing in the UI says so.
    const run = await replaySessions(
      Array.from({ length: 10 }, (_, i) => recording('nsr', 150, T0 + i * DAY, i + 1)),
    );

    expect(run.baselineEstablishedInSession).toBe(-1);
    expect(run.finalBaseline).toBeNull();
    for (const session of run.sessions) {
      expect(session.baselineEstablished).toBe(false);
      // Without a baseline every window is honestly reported as learning.
      expect(session.windows.every(w => w.changeLevel === 'learning')).toBe(true);
    }
  });

  test('a changed rhythm on a later day is flagged, and the day after recovers', async () => {
    const run = await replaySessions([
      recording('nsr', 500, T0, 1),           // day 1: learn
      recording('nsr', 500, T0 + DAY, 2),     // day 2: unchanged
      recording('af', 500, T0 + 2 * DAY, 3),  // day 3: rhythm changed
      recording('nsr', 500, T0 + 3 * DAY, 4), // day 4: back to normal
    ]);

    const [, unchanged, changed, recovered] = run.sessions;

    // Day 2 identifies the same dance and never escalates to alert.
    expect(unchanged.finalDance).toBe('The Waltz');
    expect(unchanged.windows.filter(w => w.changeLevel === 'alert')).toEqual([]);

    // Day 3 is flagged, loudly and quickly.
    expect(changed.finalDance).toBe('The Mosh Pit');
    const alerts = changed.windows.filter(w => w.changeLevel === 'alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(changed.maxMahalanobisDistance).toBeGreaterThan(CHANGE_ALERT_SIGMA * 3);

    // Day 4 is not stuck in alert: sustained-deviation state does not carry
    // across sessions.
    expect(recovered.finalDance).toBe('The Waltz');
    expect(recovered.windows.filter(w => w.changeLevel === 'alert')).toEqual([]);
    expect(recovered.windows[0].changeLevel).not.toBe('alert');
    expect(recovered.maxMahalanobisDistance).toBeLessThan(changed.maxMahalanobisDistance / 5);
  }, 120_000);

  test.each(['chf', 'af', 'pvc'] as RhythmScenario[])(
    'a %s session against an NSR baseline separates far beyond same-rhythm wander',
    async (scenario) => {
      const learn = recording('nsr', 500, T0, 1);
      const same = await replaySessions([learn, recording('nsr', 1_500, T0 + DAY, 9)]);
      const different = await replaySessions([learn, recording(scenario, 1_500, T0 + DAY, 9)]);

      const sameMax = same.sessions[1].maxMahalanobisDistance;
      const changedDistances = gradedWindows(different.sessions[1])
        .map(w => w.mahalanobisDistance)
        .sort((a, b) => a - b);
      const changedMedian = changedDistances[Math.floor(changedDistances.length / 2)];

      // This is the margin the whole feature rests on: a real rhythm change
      // must not merely exceed the threshold, it must be unmistakable next to
      // the worst day-to-day wander of an unchanged rhythm.
      expect(changedMedian).toBeGreaterThan(sameMax * 5);
    },
    120_000,
  );

  test('a session leaves no geometry, dance or sustained-deviation state behind', async () => {
    // The reverse order of the day-3 case: an abnormal session followed by a
    // normal one. If any post-gap/post-session geometry survived, the first
    // windows of the NSR session would still read Mosh Pit.
    const run = await replaySessions([
      recording('nsr', 500, T0, 1),
      recording('af', 800, T0 + DAY, 2),
      recording('nsr', 800, T0 + 2 * DAY, 3),
    ]);

    const after = run.sessions[2];
    expect(after.windows[0].dance).toBe('The Waltz');
    expect((after.danceDistribution['The Waltz'] ?? 0) / after.windows.length)
      .toBeGreaterThan(0.95);
    expect(after.danceDistribution['The Mosh Pit'] ?? 0).toBe(0);
    expect(after.gapCount).toBe(0); // a day between sessions is not a dropout
  }, 120_000);

  test('resetting the pipeline between sessions equals a cold app launch', async () => {
    // Source switches call PipelineCore.reset() instead of building a new
    // core. The two paths must be indistinguishable, or "switch source and
    // switch back" silently produces different readings than a restart.
    const recordings = [
      recording('nsr', 500, T0, 1),
      recording('af', 500, T0 + DAY, 2),
      recording('chf', 500, T0 + 2 * DAY, 3),
    ];
    const cold = await replaySessions(recordings);
    const reused = await replaySessions(recordings, { reusePipeline: true });

    cold.sessions.forEach((session, i) => {
      expect(JSON.stringify(reused.sessions[i].windows))
        .toBe(JSON.stringify(session.windows));
      expect(reused.sessions[i].finalDance).toBe(session.finalDance);
      expect(reused.sessions[i].gapCount).toBe(session.gapCount);
    });
  }, 120_000);

  test('formatMultiSessionReport summarizes the whole run', async () => {
    const run = await replaySessions([
      recording('nsr', 500, T0, 1),
      recording('af', 400, T0 + DAY, 2),
    ]);
    const report = formatMultiSessionReport(run, ['day1.csv', 'day2.csv']);

    expect(report).toContain('Multi-Session Replay Report');
    expect(report).toContain('Sessions: 2');
    expect(report).toContain('established in session 1, then reused');
    expect(report).toContain('Baseline revisions: 1');
    expect(report).toContain('day2.csv');
    expect(report).toContain('The Mosh Pit');
  });
});

// ---------------------------------------------------------------------------

describe('Change detection over hours of an unchanged rhythm', () => {
  /**
   * CHARACTERIZATION, NOT AN ENDORSEMENT.
   *
   * `session-replay.test.ts` shows a 300-beat follow-up session of the same
   * rhythm never escalating to alert. Run the same rhythm for hours and it
   * does: the baseline's SDs come from ~35 heavily overlapping 60-beat
   * windows inside one 5-minute stretch, so they describe minute-scale
   * jitter, not hour-scale wander. Measured on these seeded recordings,
   * roughly a third of windows sit at "notice" and ~1% reach "alert" while
   * the rhythm never changed.
   *
   * These bounds are a regression guard on today's numbers — they exist so
   * the rate cannot silently get worse, not to bless it. The separability
   * tests above are what justify the feature: a real change lands 10-50x
   * further out than any of this noise.
   */
  test.each(['nsr', 'chf', 'pvc'] as RhythmScenario[])(
    'hours of unchanged %s stay within the measured false-positive bounds',
    async (scenario) => {
      for (const seed of [42, 7]) {
        const result = await replaySession(recording(scenario, 20_000, T0, seed));
        const graded = gradedWindows(result);
        const alert = graded.filter(w => w.changeLevel === 'alert').length;
        const flagged = graded.filter(w => w.changeLevel !== 'normal').length;

        expect(alert / graded.length).toBeLessThan(0.02);
        expect(flagged / graded.length).toBeLessThan(0.5);
      }
    },
    180_000,
  );

  test('a persistently irregular rhythm is the worst case, and is bounded too', async () => {
    // AF is excluded from the sweep above because it fails those bounds: a
    // rhythm that is chaotic by definition cannot be summarized by 5 minutes
    // of it, so ~5% of windows alert against its OWN baseline — five times
    // the rate of any organized rhythm. Someone in permanent AF would be
    // alerted several times an hour about a rhythm that never changed.
    // Recorded here so the number is visible rather than omitted.
    for (const seed of [42, 7]) {
      const result = await replaySession(recording('af', 20_000, T0, seed));
      const graded = gradedWindows(result);
      const alert = graded.filter(w => w.changeLevel === 'alert').length;
      expect(alert / graded.length).toBeGreaterThan(0.02); // documents the gap
      expect(alert / graded.length).toBeLessThan(0.08);    // guards regression
    }
  }, 180_000);

  test('an unchanged rhythm never reaches the distances a changed one does', async () => {
    const learn = recording('nsr', 500, T0, 1);
    const longSame = await replaySessions([learn, recording('nsr', 10_000, T0 + DAY, 2)]);
    const changed = await replaySessions([learn, recording('af', 1_000, T0 + DAY, 2)]);

    // Even over hours, same-rhythm wander stays an order of magnitude below
    // the distance a genuine rhythm change produces in minutes.
    expect(longSame.sessions[1].maxMahalanobisDistance)
      .toBeLessThan(changed.sessions[1].maxMahalanobisDistance / 10);
  }, 180_000);
});

// ---------------------------------------------------------------------------

describe('Session records accumulated over months', () => {
  function fakeSession(i: number): Session {
    return {
      id: `session-${i}`,
      startTime: T0 + i * DAY,
      endTime: T0 + i * DAY + 600_000,
      dominantDance: 'The Waltz',
      beatCount: 500,
      changeEvents: [],
      danceTransitions: [],
      summaryStats: { bpmMean: 75, kappaMedian: 7.7, giniMean: 0.338 },
    };
  }

  test('the newest 100 sessions survive and the oldest fall off', async () => {
    const store = new SessionStore(new MemoryStorage());
    for (let i = 0; i < 120; i++) {
      await store.saveSession(fakeSession(i));
    }

    const sessions = await store.getSessions();
    expect(sessions.length).toBe(100);
    // Newest first, contiguous, with the 20 oldest evicted.
    expect(sessions[0].id).toBe('session-119');
    expect(sessions[99].id).toBe('session-20');
    expect(await store.getSession('session-119')).not.toBeNull();
    expect(await store.getSession('session-20')).not.toBeNull();
    expect(await store.getSession('session-19')).toBeNull();
    expect(await store.getSession('session-0')).toBeNull();
  });

  test('deleting from a full history keeps the rest readable', async () => {
    const store = new SessionStore(new MemoryStorage());
    for (let i = 0; i < 120; i++) await store.saveSession(fakeSession(i));

    await store.deleteSession('session-100');
    const sessions = await store.getSessions();
    expect(sessions.length).toBe(99);
    expect(sessions.every(s => s.id !== 'session-100')).toBe(true);
    expect(sessions[0].id).toBe('session-119');

    await store.saveSession(fakeSession(200));
    const after = await store.getSessions();
    expect(after.length).toBe(100);
    expect(after[0].id).toBe('session-200');
  });
});
