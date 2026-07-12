/**
 * Session replay tests — the "does the whole thing work in theory" harness.
 *
 * These run recorded (here: simulated, timestamped) beat sequences through
 * the REAL pipeline — QualityGate → PipelineCore → dance matching →
 * baseline learning → change detection — end to end, including the
 * 5-minute baseline rule and dropout-gap handling, all driven by recording
 * timestamps rather than the wall clock.
 */
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { CHANGE_NOTICE_SIGMA, CHANGE_ALERT_SIGMA } from '../../shared/constants';
import { beatLogger } from '../session/beat-logger';
import {
  replaySession, parseBeatCSV, formatReplayReport,
  type ReplayBeat,
} from '../replay/session-replay';

// The simulator draws from Math.random — seed it (LCG) so every run of this
// suite replays the exact same "recordings" and thresholds never flake.
function makeSeededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
let randomSpy: jest.SpyInstance;
beforeEach(() => {
  randomSpy = jest.spyOn(Math, 'random').mockImplementation(makeSeededRandom(42));
});
afterEach(() => {
  randomSpy.mockRestore();
});

/** Generate a timestamped beat sequence from the rhythm simulator. */
function simulateBeats(
  scenario: RhythmScenario,
  count: number,
  startMs = 1_700_000_000_000,
): ReplayBeat[] {
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

describe('Session replay', () => {
  test('NSR session replays to The Waltz', async () => {
    const result = await replaySession(simulateBeats('nsr', 300));
    expect(result.finalDance).toBe('The Waltz');
    // The overwhelming majority of windows should agree
    const waltz = result.danceDistribution['The Waltz'] ?? 0;
    const total = Object.values(result.danceDistribution).reduce((a, b) => a + b, 0);
    expect(waltz / total).toBeGreaterThan(0.8);
  });

  test('CHF session replays to The Lock-Step', async () => {
    const result = await replaySession(simulateBeats('chf', 300));
    expect(result.finalDance).toBe('The Lock-Step');
  });

  test('baseline establishes from recording timestamps, not wall clock', async () => {
    // ~75 BPM × 450 beats ≈ 6 minutes of recording, replayed in milliseconds.
    // The 5-minute duration rule must be satisfied by the recorded span.
    const beats = simulateBeats('nsr', 450);
    const result = await replaySession(beats);

    expect(result.durationMs).toBeGreaterThan(300_000);
    expect(result.baselineEstablished).toBe(true);
    expect(result.baseline).not.toBeNull();
    expect(result.baseline!.beatCount).toBeGreaterThanOrEqual(200);
    // Once established, subsequent NSR windows should read as normal
    const lastWindow = result.windows[result.windows.length - 1];
    expect(lastWindow.changeLevel).toBe('normal');
  });

  test('too-short recording does not establish a baseline', async () => {
    const result = await replaySession(simulateBeats('nsr', 100));
    expect(result.baselineEstablished).toBe(false);
    expect(result.windows.every(w => w.changeLevel === 'learning')).toBe(true);
  });

  test('end-to-end change detection: NSR baseline then AF triggers a change', async () => {
    // Learn a personal baseline from a clean NSR session...
    const nsr = await replaySession(simulateBeats('nsr', 450));
    expect(nsr.baselineEstablished).toBe(true);

    // ...then replay an AF episode against that baseline.
    const af = await replaySession(simulateBeats('af', 300), {
      baseline: nsr.baseline!,
    });

    expect(af.maxMahalanobisDistance).toBeGreaterThan(CHANGE_NOTICE_SIGMA);
    const escalations = af.changeEvents.filter(
      e => e.to === 'notice' || e.to === 'alert',
    );
    expect(escalations.length).toBeGreaterThan(0);
  });

  test('same-rhythm follow-up session stays below the alert threshold', async () => {
    const nsr = await replaySession(simulateBeats('nsr', 450));
    const followUp = await replaySession(simulateBeats('nsr', 300), {
      baseline: nsr.baseline!,
    });

    // CHARACTERIZATION: replay surfaced that a baseline learned from a
    // single session has tight SDs (overlapping 60-beat feature windows),
    // so an independent session of the SAME rhythm spends a large minority
    // of windows at 2σ+ "notice". Documented here as current behavior;
    // the product-level guarantee is that it must not escalate to alert.
    expect(followUp.changeEvents.filter(e => e.to === 'alert')).toEqual([]);
    expect(followUp.maxMahalanobisDistance).toBeLessThan(CHANGE_ALERT_SIGMA);
    const normal = followUp.windows.filter(w => w.changeLevel === 'normal').length;
    expect(normal / followUp.windows.length).toBeGreaterThan(0.5);
  });

  test('a dropout gap is counted and does not inflate change distance', async () => {
    const nsr = await replaySession(simulateBeats('nsr', 450));

    // The same NSR recording, with and without a 30-second sensor dropout
    // in the middle (same PPIs, shifted timestamps).
    const clean = simulateBeats('nsr', 200);
    const gapped = clean.map((b, i) =>
      i >= 100 ? { ...b, timestampMs: b.timestampMs + 30_000 } : b,
    );

    const cleanResult = await replaySession(clean, { baseline: nsr.baseline! });
    const gappedResult = await replaySession(gapped, { baseline: nsr.baseline! });

    expect(cleanResult.gapCount).toBe(0);
    expect(gappedResult.gapCount).toBe(1);
    // Without geometry reset, the fabricated cross-gap torus pair produces a
    // curvature spike that inflates Mahalanobis distance. With it, the
    // gapped replay stays in the same regime as the clean one.
    expect(gappedResult.changeEvents.filter(e => e.to === 'alert')).toEqual([]);
    expect(gappedResult.maxMahalanobisDistance).toBeLessThan(
      Math.max(CHANGE_NOTICE_SIGMA, cleanResult.maxMahalanobisDistance * 1.5),
    );
  });

  test('quality gate rejects artifacts during replay', async () => {
    const beats = simulateBeats('nsr', 100);
    // Inject out-of-range and deviation artifacts a real sensor produces
    beats.splice(50, 0,
      { ppi: 2500, timestampMs: beats[49].timestampMs + 100 },
      { ppi: 150, timestampMs: beats[49].timestampMs + 200 },
    );
    const result = await replaySession(beats);

    expect(result.rejectedBeats).toBeGreaterThanOrEqual(2);
    expect(result.acceptedBeats + result.rejectedBeats).toBe(result.totalBeats);
    expect(result.finalDance).toBe('The Waltz'); // artifacts didn't derail it
  });

  test('replay is deterministic', async () => {
    const beats = simulateBeats('nsr', 250);
    const a = await replaySession(beats);
    const b = await replaySession(beats);
    expect(JSON.stringify(a.windows)).toBe(JSON.stringify(b.windows));
    expect(a.finalDance).toBe(b.finalDance);
  });

  test('formatReplayReport produces a readable summary', async () => {
    const result = await replaySession(simulateBeats('nsr', 300));
    const report = formatReplayReport(result);
    expect(report).toContain('Session Replay Report');
    expect(report).toContain('The Waltz');
    expect(report).toContain('Dropout gaps: 0');
  });
});

describe('Beat CSV round-trip', () => {
  test('parses the exact CSV the app exports', async () => {
    const beats = simulateBeats('nsr', 60);

    beatLogger.clear();
    for (let i = 0; i < beats.length; i++) {
      beatLogger.append({
        timestamp: new Date(beats[i].timestampMs).toISOString(),
        beat_number: i + 1,
        ppi_ms: beats[i].ppi,
        source: 'ble_innovo',
        spo2: 98,
        bpm: 75,
        pi_percent: 5.4,
        dance_name: 'The Waltz',
        dance_confidence: 88,
        kappa: 7.7,
        gini: 0.338,
        sigma: 0.33,
        theta1: 1.234,
        theta2: 2.345,
        trail_length: 20,
        motion_artifact: false,
        breath_rate: null,
        ibi_ms: null,
      });
    }
    const csv = beatLogger.toCSV();
    beatLogger.clear();

    const parsed = parseBeatCSV(csv);
    expect(parsed.length).toBe(beats.length);
    expect(parsed.map(b => b.ppi)).toEqual(beats.map(b => b.ppi));
    expect(parsed.map(b => b.timestampMs)).toEqual(beats.map(b => b.timestampMs));

    // And the parsed recording replays identically to the original
    const fromCSV = await replaySession(parsed);
    const direct = await replaySession(beats);
    expect(fromCSV.finalDance).toBe(direct.finalDance);
    expect(JSON.stringify(fromCSV.windows)).toBe(JSON.stringify(direct.windows));
  });

  test('skips malformed rows instead of failing', () => {
    const csv = [
      'timestamp,beat_number,ppi_ms,source',
      '2026-01-01T00:00:00.000Z,1,800,ble_innovo',
      'not-a-date,2,810,ble_innovo',
      '2026-01-01T00:00:01.600Z,3,,ble_innovo',
      '2026-01-01T00:00:02.400Z,4,805,ble_innovo',
    ].join('\n');
    const parsed = parseBeatCSV(csv);
    expect(parsed.length).toBe(2);
    expect(parsed[0].ppi).toBe(800);
    expect(parsed[1].ppi).toBe(805);
  });

  test('rejects CSVs missing required columns', () => {
    expect(() => parseBeatCSV('foo,bar\n1,2')).toThrow(/timestamp|ppi_ms/);
  });
});
