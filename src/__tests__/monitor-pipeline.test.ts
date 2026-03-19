/**
 * Monitor pipeline logic test — tests the core computation flow without React hooks.
 * Verifies that PPIs fed through the pipeline produce expected torus points and dance matches.
 */
import {
  toAngle, mengerCurvature, giniCoefficient,
  median, mean, std,
} from '../../shared/torus-engine';
import { matchDance } from '../../shared/dance-matcher';
import {
  PPI_MIN, PPI_MAX, TORUS_WINDOW, KAPPA_WINDOW,
  DANCE_UPDATE_INTERVAL,
} from '../../shared/constants';
import { RhythmSimulator } from '../../shared/simulator';
import type { TorusPoint } from '../../shared/types';

/**
 * Runs the pipeline computation (same logic as useMonitorPipeline but without React).
 */
function runPipelineComputation(ppis: number[]) {
  const ppiBuffer: number[] = [];
  const kappaBuffer: number[] = [];
  const displayPoints: TorusPoint[] = [];
  const featurePoints: TorusPoint[] = [];
  let totalBeats = 0;
  let adaptiveMin = PPI_MIN;
  let adaptiveMax = PPI_MAX;
  let beatsSinceUpdate = 0;
  let lastMatch = null;

  for (const ppi of ppis) {
    ppiBuffer.push(ppi);
    if (ppiBuffer.length > TORUS_WINDOW) ppiBuffer.shift();
    totalBeats++;
    beatsSinceUpdate++;

    if (ppiBuffer.length < 2) continue;

    // Adaptive normalization update
    if (beatsSinceUpdate >= 10) {
      const sorted = [...ppiBuffer].sort((a, b) => a - b);
      adaptiveMin = sorted[Math.floor(sorted.length * 0.02)];
      adaptiveMax = sorted[Math.floor(sorted.length * 0.98)];
      beatsSinceUpdate = 0;
    }

    const n = ppiBuffer.length;

    // Display points (adaptive)
    const dT1 = toAngle(ppiBuffer[n - 2], adaptiveMin, adaptiveMax);
    const dT2 = toAngle(ppiBuffer[n - 1], adaptiveMin, adaptiveMax);
    displayPoints.push({ theta1: dT1, theta2: dT2, kappa: 0, beatIndex: totalBeats });
    if (displayPoints.length > TORUS_WINDOW) displayPoints.shift();

    // Feature points (fixed)
    const fT1 = toAngle(ppiBuffer[n - 2], PPI_MIN, PPI_MAX);
    const fT2 = toAngle(ppiBuffer[n - 1], PPI_MIN, PPI_MAX);
    featurePoints.push({ theta1: fT1, theta2: fT2, kappa: 0, beatIndex: totalBeats });
    if (featurePoints.length > TORUS_WINDOW) featurePoints.shift();

    // Curvature from feature points
    const fLen = featurePoints.length;
    if (fLen >= 3) {
      const fp = featurePoints;
      const p1: [number, number] = [fp[fLen - 3].theta1, fp[fLen - 3].theta2];
      const p2: [number, number] = [fp[fLen - 2].theta1, fp[fLen - 2].theta2];
      const p3: [number, number] = [fp[fLen - 1].theta1, fp[fLen - 1].theta2];
      const kappa = mengerCurvature(p1, p2, p3);
      fp[fLen - 2].kappa = kappa;
      kappaBuffer.push(kappa);
      if (kappaBuffer.length > KAPPA_WINDOW) kappaBuffer.shift();
    }

    // Dance matching
    if (totalBeats % DANCE_UPDATE_INTERVAL === 0 && kappaBuffer.length >= 10) {
      const positiveKappas = kappaBuffer.filter(k => k > 0);
      if (positiveKappas.length < 2) continue;
      const km = median(positiveKappas);
      const g = giniCoefficient(positiveKappas);
      const t1s = featurePoints.map(p => p.theta1);
      const t2s = featurePoints.map(p => p.theta2);
      const s = std(t1s) + std(t2s);
      lastMatch = matchDance(km, g, s);
      lastMatch.bpm = Math.round(60000 / mean(ppiBuffer));
    }
  }

  return { displayPoints, featurePoints, lastMatch, totalBeats };
}

describe('Monitor pipeline computation', () => {
  test('produces display points with adaptive normalization', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const ppis = Array.from({ length: 100 }, () => sim.next());
    const result = runPipelineComputation(ppis);

    expect(result.displayPoints.length).toBeGreaterThan(0);
    expect(result.displayPoints.length).toBeLessThanOrEqual(TORUS_WINDOW);
    // Adaptive normalization should spread angles across more of the range
    const thetas = result.displayPoints.map(p => p.theta1);
    const range = Math.max(...thetas) - Math.min(...thetas);
    expect(range).toBeGreaterThan(1); // wide spread with adaptive normalization
  });

  test('produces feature points with fixed normalization', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const ppis = Array.from({ length: 100 }, () => sim.next());
    const result = runPipelineComputation(ppis);

    expect(result.featurePoints.length).toBeGreaterThan(0);
    // Fixed normalization should place NSR (~800ms) in a narrower band
    const thetas = result.featurePoints.map(p => p.theta1);
    const range = Math.max(...thetas) - Math.min(...thetas);
    expect(range).toBeLessThan(1.5); // narrow band for NSR
  });

  test('NSR pipeline produces Waltz dance match', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const ppis = Array.from({ length: 300 }, () => sim.next()).filter(p => p >= PPI_MIN && p <= PPI_MAX);
    const result = runPipelineComputation(ppis);

    expect(result.lastMatch).not.toBeNull();
    expect(result.lastMatch!.name).toBe('The Waltz');
  });

  test('CHF pipeline produces Lock-Step dance match', () => {
    const sim = new RhythmSimulator({ scenario: 'chf' });
    const ppis = Array.from({ length: 300 }, () => sim.next()).filter(p => p >= PPI_MIN && p <= PPI_MAX);
    const result = runPipelineComputation(ppis);

    expect(result.lastMatch).not.toBeNull();
    expect(result.lastMatch!.name).toBe('The Lock-Step');
  });

  test('pipeline produces valid BPM', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const ppis = Array.from({ length: 100 }, () => sim.next()).filter(p => p >= PPI_MIN && p <= PPI_MAX);
    const result = runPipelineComputation(ppis);

    expect(result.lastMatch).not.toBeNull();
    expect(result.lastMatch!.bpm).toBeGreaterThan(40);
    expect(result.lastMatch!.bpm).toBeLessThan(200);
  });

  test('dual normalization: display and feature points differ', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr' });
    const ppis = Array.from({ length: 100 }, () => sim.next());
    const result = runPipelineComputation(ppis);

    // Display and feature points should have different theta values
    // because they use different normalization
    const dp = result.displayPoints;
    const fp = result.featurePoints;
    if (dp.length > 0 && fp.length > 0) {
      const dpSpread = std(dp.map(p => p.theta1));
      const fpSpread = std(fp.map(p => p.theta1));
      // Adaptive normalization should produce larger spread than fixed
      expect(dpSpread).toBeGreaterThan(fpSpread);
    }
  });
});
