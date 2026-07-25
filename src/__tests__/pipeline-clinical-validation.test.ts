/**
 * CLINICAL VALIDATION — every rhythm must be identified correctly through the
 * REAL shipping pipeline, quality gate included.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `shared/__tests__/simulator.test.ts` validates the torus math but explicitly
 * "skips quality gate for simulation". The simulated data source also applies
 * no gate. So for a long time every test and every demo exercised a path that
 * real hardware never takes — and on real hardware the deviation filter was
 * deleting exactly the beats that define an arrhythmia. Ventricular ectopy
 * (PVC) was reported as "The Waltz", the NORMAL rhythm dance.
 *
 * These tests run through `replaySession`, which applies the same QualityGate
 * that `use-innovo-pulse-ox` and `use-camera-ppg` apply to real sensor data.
 * If a change to gating, normalization, or the centroids breaks arrhythmia
 * identification on real hardware, these tests must fail.
 *
 * Do NOT "fix" a failure here by bypassing the gate.
 */
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { PPI_MIN, PPI_MAX } from '../../shared/constants';
import { replaySession, type ReplayBeat } from '../replay/session-replay';

/** Deterministic PRNG so threshold assertions never flake. */
function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let randomSpy: jest.SpyInstance;
afterEach(() => randomSpy?.mockRestore());

/**
 * Build a timestamped recording. When `withArtifacts` is set, inject
 * physiologically impossible intervals of the kind a real sensor produces
 * during motion — these MUST be rejected by the range check.
 */
function recording(
  scenario: RhythmScenario,
  count: number,
  seed: number,
  withArtifacts = false,
): ReplayBeat[] {
  randomSpy = jest.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
  const sim = new RhythmSimulator({ scenario });
  const beats: ReplayBeat[] = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const ppi = sim.next();
    t += ppi;
    if (withArtifacts && i % 37 === 36) {
      beats.push({ ppi: 150, timestampMs: t + 5 });   // far below PPI_MIN
      beats.push({ ppi: 2200, timestampMs: t + 10 }); // far above PPI_MAX
    }
    beats.push({ ppi, timestampMs: t });
  }
  return beats;
}

const SEEDS = [42, 101, 7, 2024, 5];

const EXPECTED: Record<string, string> = {
  nsr: 'The Waltz',
  chf: 'The Lock-Step',
  af: 'The Mosh Pit',
  pvc: 'The Stumble',
};

describe('Clinical validation through the real shipping pipeline', () => {
  for (const [scenario, expectedDance] of Object.entries(EXPECTED)) {
    test(`${scenario.toUpperCase()} is identified as "${expectedDance}" (gate applied)`, async () => {
      for (const seed of SEEDS) {
        const result = await replaySession(recording(scenario as RhythmScenario, 400, seed));
        expect(result.finalDance).toBe(expectedDance);
      }
    });

    test(`${scenario.toUpperCase()} survives motion artifacts`, async () => {
      for (const seed of SEEDS) {
        const beats = recording(scenario as RhythmScenario, 400, seed, true);
        const result = await replaySession(beats);
        // Impossible intervals are rejected...
        expect(result.rejectedBeats).toBeGreaterThan(0);
        // ...and the rhythm is still identified correctly.
        expect(result.finalDance).toBe(expectedDance);
      }
    });
  }

  test('ectopic beats reach the pipeline instead of being filtered out', async () => {
    // The regression that made PVC read as normal: every premature beat and
    // compensatory pause is in-range but far from the median, so a deviation
    // gate deleted all of them and left only the normal beats behind.
    const beats = recording('pvc', 400, 42);
    const inRange = beats.filter(b => b.ppi >= PPI_MIN && b.ppi <= PPI_MAX);
    expect(inRange.length).toBe(beats.length); // nothing is physiologically impossible

    const result = await replaySession(beats);
    expect(result.rejectedBeats).toBe(0);
    expect(result.acceptedBeats).toBe(beats.length);
  });

  test('a sustained heart-rate change is not silently rejected', async () => {
    // Exercise: resting 1000ms ramping to 600ms. A ratcheting median made the
    // accept floor climb until every faster beat was rejected forever.
    const beats: ReplayBeat[] = [];
    let t = 1_700_000_000_000;
    const push = (ppi: number) => { t += ppi; beats.push({ ppi, timestampMs: t }); };
    for (let i = 0; i < 150; i++) push(1000);
    for (let i = 0; i < 100; i++) push(Math.round(1000 - (400 * i) / 100));
    for (let i = 0; i < 150; i++) push(600);

    const result = await replaySession(beats);
    expect(result.rejectedBeats).toBe(0);
    expect(result.gapCount).toBe(0);
  });

  test('camera sampling does not fabricate variability in a metronomic rhythm', () => {
    // REGRESSION: peaks snapped to the nearest 30fps frame quantized intervals
    // to a 33.3ms grid, injecting ~13.6ms of artificial beat-to-beat variation
    // into a rhythm that has almost none — enough to flip a near-metronomic
    // CHF rhythm from "The Lock-Step" to "The Waltz" on the camera source.
    const { PPGProcessor } = require('../camera/ppg-processor');
    const fps = 30;
    const proc = new PPGProcessor(fps);
    const emitted: number[] = [];
    proc.onPPI = (p: number) => emitted.push(p);

    // Perfectly metronomic 750ms beats rendered as a PPG waveform at 30fps.
    const beatTimes: number[] = [];
    for (let i = 0; i < 60; i++) beatTimes.push(2000 + i * 750);
    const dt = 1000 / fps;
    for (let t = 0; t < beatTimes[beatTimes.length - 1] + 2000; t += dt) {
      let v = 0;
      for (const bt of beatTimes) {
        const d = (t - bt) / 120;
        if (Math.abs(d) < 4) v += Math.exp(-d * d);
      }
      proc.processFrame(200 + 12 * v, t);
    }

    expect(emitted.length).toBeGreaterThan(50);
    // Drop the final interval: this synthetic waveform stops abruptly, and the
    // bandpass rings on that artificial edge. A real signal keeps going.
    const interior = emitted.slice(0, -1);
    // Every recovered interval must be close to 750ms. Frame quantization
    // alone would scatter these across 733/766/800ms.
    for (const ppi of interior) {
      expect(Math.abs(ppi - 750)).toBeLessThan(10);
    }
    // And the spread must be far below the 33.3ms frame grid.
    const mean = interior.reduce((a, b) => a + b, 0) / interior.length;
    const sd = Math.sqrt(
      interior.reduce((a, b) => a + (b - mean) ** 2, 0) / interior.length,
    );
    expect(sd).toBeLessThan(5);
  });

  test('dropout gaps are not manufactured by beat rejection', async () => {
    // Mass rejection creates >5s holes between admitted beats, which the
    // signal watchdog then misreads as sensor dropouts and wipes the torus.
    for (const scenario of Object.keys(EXPECTED)) {
      const result = await replaySession(recording(scenario as RhythmScenario, 400, 42));
      expect(result.gapCount).toBe(0);
    }
  });
});
