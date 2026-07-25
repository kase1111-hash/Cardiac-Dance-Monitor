/**
 * Dropout semantics — what a signal gap must and must not do.
 *
 * A dropout is the most common real-world event for a fingertip pulse ox, and
 * it must never be mistaken for physiology. Silence is not deviation, silence
 * is not elapsed baseline time, and pre-gap readings are not post-gap data.
 */
import { PipelineCore } from '../pipeline/pipeline-core';
import { BaselineService } from '../baseline/baseline-service';
import { ChangeDetector } from '../baseline/change-detector';
import { MemoryStorage } from '../session/session-store';
import { toAngle } from '../../shared/torus-engine';
import {
  SIGNAL_GAP_MS, CHANGE_ALERT_SUSTAIN, BASELINE_MIN_BEATS,
} from '../../shared/constants';
import type { PersonalBaseline } from '../../shared/types';

const TIGHT_BASELINE: PersonalBaseline = {
  kappaMean: 8, kappaSd: 0.5,
  giniMean: 0.34, giniSd: 0.02,
  spreadMean: 0.33, spreadSd: 0.02,
  bpmMean: 75,
  recordedAt: 0,
  beatCount: 200,
};

function newCore() {
  const bs = new BaselineService(new MemoryStorage());
  return { core: new PipelineCore(bs), bs };
}

describe('ChangeDetector across dropouts', () => {
  test('silence does not count toward the sustained-alert timer', () => {
    const det = new ChangeDetector();
    const far = { kappa: 30, gini: 0.9, spread: 3 }; // far outside baseline

    const t0 = 1_000_000;
    expect(det.update(TIGHT_BASELINE, far, t0).level).toBe('notice');

    // A 10-minute dropout, then one more deviant window. Without notifyGap
    // this satisfies CHANGE_ALERT_SUSTAIN outright and fires an alert from
    // two observations with zero continuously-observed deviation.
    const afterGap = t0 + 10 * 60 * 1000;
    det.notifyGap();
    const status = det.update(TIGHT_BASELINE, far, afterGap);
    expect(status.level).toBe('notice');
  });

  test('genuinely sustained deviation still escalates to alert', () => {
    const det = new ChangeDetector();
    const far = { kappa: 30, gini: 0.9, spread: 3 };
    const t0 = 1_000_000;
    det.update(TIGHT_BASELINE, far, t0);
    const later = t0 + (CHANGE_ALERT_SUSTAIN + 1) * 1000;
    expect(det.update(TIGHT_BASELINE, far, later).level).toBe('alert');
  });
});

describe('BaselineService dead time', () => {
  test('a dropout cannot satisfy the 5-minute duration rule', () => {
    const bs = new BaselineService(new MemoryStorage());
    const t0 = 1_000_000;
    bs.countBeat(t0);

    // 10 minutes of silence, excluded explicitly.
    const gap = 10 * 60 * 1000;
    bs.skipDeadTime(gap);

    // Then 250 beats crammed into ~16 seconds of real observation.
    let t = t0 + gap;
    for (let i = 0; i < BASELINE_MIN_BEATS + 50; i++) {
      t += 65;
      bs.countBeat(t);
    }
    const established = bs.addSample(8, 0.34, 0.33, 75, t);
    expect(established).toBe(false);
    expect(bs.isLearning()).toBe(true);
  });

  test('forceEstablish refuses to freeze an all-zero baseline', () => {
    const bs = new BaselineService(new MemoryStorage());
    // Plenty of raw beats but no feature samples (e.g. curvature always zero).
    for (let i = 0; i < BASELINE_MIN_BEATS + 10; i++) bs.countBeat(i * 800);
    expect(bs.forceEstablish()).toBe(false);
    expect(bs.getBaseline()).toBeNull();
  });
});

describe('PipelineCore gap handling', () => {
  test('derived readings are cleared, not carried across a gap', () => {
    const { core } = newCore();
    let t = 1_000_000;
    for (let i = 0; i < 80; i++) {
      t += 800;
      core.processBeat(800 + (i % 5) * 12, t);
    }
    const before = core.getState();
    expect(before.danceMatch).not.toBeNull();
    expect(before.displayPoints.length).toBeGreaterThan(0);

    // First beat after a dropout must not report pre-gap geometry.
    t += SIGNAL_GAP_MS * 4;
    const after = core.processBeat(800, t);
    expect(after.danceMatch).toBeNull();
    expect(after.displayPoints).toEqual([]);
    expect(after.kappaMedian).toBe(0);
    expect(after.gini).toBe(0);
    expect(after.gapCount).toBe(1);
  });

  test('display points map to the correct interval pair', () => {
    // REGRESSION: the re-map index was uniformly +1 too high, so 57 of 60
    // points held the wrong pair and the newest two collapsed onto one dot.
    const { core } = newCore();
    // Distinct but NON-monotonic: a rising ramp would push the newest values
    // past the 98th percentile, where toAngle clamps them all to 2π and the
    // collapse would be adaptive-normalization clamping rather than a re-map
    // bug. This spreads values across the window instead.
    const ppis: number[] = [];
    for (let i = 0; i < 100; i++) ppis.push(700 + ((i * 37) % 61));
    let t = 1_000_000;
    let state = core.getState();
    for (const p of ppis) { t += p; state = core.processBeat(p, t); }

    const buf = ppis.slice(-60);
    const sorted = [...buf].sort((a, b) => a - b);
    const min = sorted[Math.max(0, Math.floor(sorted.length * 0.02))];
    const max = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];

    const pts = state.displayPoints;
    const newest = pts[pts.length - 1];
    expect(newest.theta2).toBeCloseTo(toAngle(buf[buf.length - 1], min, max), 9);
    expect(newest.theta1).toBeCloseTo(toAngle(buf[buf.length - 2], min, max), 9);

    // The two newest points must be distinct, not a doubled head dot.
    const prev = pts[pts.length - 2];
    expect(prev.theta2).not.toBeCloseTo(newest.theta2, 9);
  });
});

describe('Degenerate geometry (period-2 rhythms)', () => {
  test('bigeminy reports features unavailable instead of a stale dance', () => {
    // Strict alternation makes p1 and p3 coincide for every triplet, so all
    // curvatures are 0. Previously the feature block fell through silently
    // and the UI kept showing the last dance as if it were current.
    const { core } = newCore();
    let t = 1_000_000;

    // Establish a normal rhythm and a real dance first.
    for (let i = 0; i < 80; i++) { t += 800; core.processBeat(800 + (i % 5) * 12, t); }
    expect(core.getState().danceMatch).not.toBeNull();

    // Now switch to strict bigeminy (900/450 alternating).
    for (let i = 0; i < 80; i++) {
      const ppi = i % 2 === 0 ? 900 : 450;
      t += ppi;
      core.processBeat(ppi, t);
    }

    const state = core.getState();
    expect(state.featuresUnavailable).toBe(true);
    expect(state.danceMatch).toBeNull();
  });
});
