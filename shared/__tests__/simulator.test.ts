/**
 * Simulation mode integration tests — verifies that simulated rhythm scenarios
 * produce the expected dance identifications through the full pipeline.
 *
 * Test vectors from SPEC.md Section 10 (Simulation).
 */
import { RhythmSimulator, generateSimulatedPPIs } from '../simulator';
import { QualityGate } from '../quality-gate';
import { toAngle, mengerCurvature, giniCoefficient, median, mean, std } from '../torus-engine';
import { matchDance } from '../dance-matcher';
import { TORUS_WINDOW, DANCE_UPDATE_INTERVAL, PPI_MIN, PPI_MAX } from '../constants';
import type { TorusPoint, DanceMatch } from '../types';

/**
 * Runs a full pipeline simulation for a given scenario and returns the last dance match.
 * Uses fixed normalization bounds (PPI_MIN, PPI_MAX) for angle mapping.
 * Skips quality gate for simulation (synthetic PPIs are intentionally generated).
 */
function runPipeline(scenario: 'nsr' | 'chf' | 'af' | 'pvc', beatCount: number = 300): DanceMatch | null {
  const sim = new RhythmSimulator({ scenario });

  const ppiBuffer: number[] = [];
  const torusPoints: TorusPoint[] = [];
  const kappaBuffer: number[] = [];
  let totalBeats = 0;
  let lastMatch: DanceMatch | null = null;

  for (let i = 0; i < beatCount; i++) {
    const ppi = sim.next();
    // Basic range check only — no deviation filter for simulation
    if (ppi < PPI_MIN || ppi > PPI_MAX) continue;

    ppiBuffer.push(ppi);
    if (ppiBuffer.length > TORUS_WINDOW) ppiBuffer.shift();
    totalBeats++;

    if (ppiBuffer.length < 2) continue;

    // Fixed normalization using PPI range bounds
    const n = ppiBuffer.length;
    const theta1 = toAngle(ppiBuffer[n - 2], PPI_MIN, PPI_MAX);
    const theta2 = toAngle(ppiBuffer[n - 1], PPI_MIN, PPI_MAX);
    torusPoints.push({ theta1, theta2, kappa: 0, beatIndex: totalBeats });
    if (torusPoints.length > TORUS_WINDOW) torusPoints.shift();

    // Curvature
    const tLen = torusPoints.length;
    if (tLen >= 3) {
      const p1: [number, number] = [torusPoints[tLen - 3].theta1, torusPoints[tLen - 3].theta2];
      const p2: [number, number] = [torusPoints[tLen - 2].theta1, torusPoints[tLen - 2].theta2];
      const p3: [number, number] = [torusPoints[tLen - 1].theta1, torusPoints[tLen - 1].theta2];
      torusPoints[tLen - 2].kappa = mengerCurvature(p1, p2, p3);
      kappaBuffer.push(torusPoints[tLen - 2].kappa);
      if (kappaBuffer.length > TORUS_WINDOW) kappaBuffer.shift();
    }

    // Feature computation + dance matching every DANCE_UPDATE_INTERVAL beats
    if (totalBeats % DANCE_UPDATE_INTERVAL === 0 && kappaBuffer.length >= 10) {
      const positiveKappas = kappaBuffer.filter(k => k > 0);
      if (positiveKappas.length < 2) continue;

      const kappaMedian = median(positiveKappas);
      const gini = giniCoefficient(positiveKappas);
      const thetas1 = torusPoints.map(p => p.theta1);
      const thetas2 = torusPoints.map(p => p.theta2);
      const spread = std(thetas1) + std(thetas2);
      const bpm = Math.round(60000 / mean(ppiBuffer));

      lastMatch = matchDance(kappaMedian, gini, spread);
      lastMatch.bpm = bpm;
    }
  }

  return lastMatch;
}

describe('Simulation scenarios', () => {
  // Use multiple runs to account for randomness in the simulator
  function testScenario(scenario: 'nsr' | 'chf' | 'af' | 'pvc', expectedDance: string, runs: number = 10) {
    let matchCount = 0;
    for (let r = 0; r < runs; r++) {
      const match = runPipeline(scenario, 400);
      if (match && match.name === expectedDance) matchCount++;
    }
    // At least 5 out of 10 runs should match (majority)
    return matchCount >= Math.ceil(runs * 0.5);
  }

  test('NSR simulation → dominant dance "The Waltz"', () => {
    expect(testScenario('nsr', 'The Waltz')).toBe(true);
  });

  test('CHF simulation → dominant dance "The Lock-Step"', () => {
    expect(testScenario('chf', 'The Lock-Step')).toBe(true);
  });

  test('AF simulation → dominant dance "The Mosh Pit"', () => {
    expect(testScenario('af', 'The Mosh Pit')).toBe(true);
  });

  test('PVC simulation → dominant dance "The Stumble"', () => {
    expect(testScenario('pvc', 'The Stumble')).toBe(true);
  });
});

describe('RhythmSimulator', () => {
  test('generates PPIs within valid range', () => {
    const scenarios: Array<'nsr' | 'chf' | 'af' | 'pvc'> = ['nsr', 'chf', 'af', 'pvc'];
    for (const scenario of scenarios) {
      const ppis = generateSimulatedPPIs(scenario, 100);
      expect(ppis.length).toBe(100);
      for (const ppi of ppis) {
        expect(ppi).toBeGreaterThan(200);
        expect(ppi).toBeLessThan(1800);
      }
    }
  });

  test('transition scenario starts NSR and switches to AF', () => {
    const sim = new RhythmSimulator({ scenario: 'transition' });
    const earlyPpis: number[] = [];
    for (let i = 0; i < 99; i++) earlyPpis.push(sim.next());
    const latePpis: number[] = [];
    for (let i = 0; i < 100; i++) latePpis.push(sim.next());

    const earlyStd = std(earlyPpis);
    const lateStd = std(latePpis);
    expect(lateStd).toBeGreaterThan(earlyStd);
  });

  test('custom BPM overrides default', () => {
    const sim = new RhythmSimulator({ scenario: 'nsr', bpm: 60 });
    const ppis: number[] = [];
    for (let i = 0; i < 50; i++) ppis.push(sim.next());
    const avgPpi = mean(ppis);
    expect(avgPpi).toBeGreaterThan(900);
    expect(avgPpi).toBeLessThan(1100);
  });
});

describe('Dance transition scenario', () => {
  test('transition scenario produces logged transition event', () => {
    const sim = new RhythmSimulator({ scenario: 'transition' });

    const ppiBuffer: number[] = [];
    const torusPoints: TorusPoint[] = [];
    const kappaBuffer: number[] = [];
    let totalBeats = 0;
    const danceHistory: string[] = [];

    for (let i = 0; i < 300; i++) {
      const ppi = sim.next();
      if (ppi < PPI_MIN || ppi > PPI_MAX) continue;

      ppiBuffer.push(ppi);
      if (ppiBuffer.length > TORUS_WINDOW) ppiBuffer.shift();
      totalBeats++;

      if (ppiBuffer.length < 2) continue;

      const n = ppiBuffer.length;
      const theta1 = toAngle(ppiBuffer[n - 2], PPI_MIN, PPI_MAX);
      const theta2 = toAngle(ppiBuffer[n - 1], PPI_MIN, PPI_MAX);
      torusPoints.push({ theta1, theta2, kappa: 0, beatIndex: totalBeats });
      if (torusPoints.length > TORUS_WINDOW) torusPoints.shift();

      const tLen = torusPoints.length;
      if (tLen >= 3) {
        const p1: [number, number] = [torusPoints[tLen - 3].theta1, torusPoints[tLen - 3].theta2];
        const p2: [number, number] = [torusPoints[tLen - 2].theta1, torusPoints[tLen - 2].theta2];
        const p3: [number, number] = [torusPoints[tLen - 1].theta1, torusPoints[tLen - 1].theta2];
        torusPoints[tLen - 2].kappa = mengerCurvature(p1, p2, p3);
        kappaBuffer.push(torusPoints[tLen - 2].kappa);
        if (kappaBuffer.length > TORUS_WINDOW) kappaBuffer.shift();
      }

      if (totalBeats % DANCE_UPDATE_INTERVAL === 0 && kappaBuffer.length >= 10) {
        const positiveKappas = kappaBuffer.filter(k => k > 0);
        if (positiveKappas.length < 2) continue;

        const kappaMedian = median(positiveKappas);
        const gini = giniCoefficient(positiveKappas);
        const thetas1 = torusPoints.map(p => p.theta1);
        const thetas2 = torusPoints.map(p => p.theta2);
        const spread = std(thetas1) + std(thetas2);

        const match = matchDance(kappaMedian, gini, spread);
        danceHistory.push(match.name);
      }
    }

    const uniqueDances = new Set(danceHistory);
    expect(uniqueDances.size).toBeGreaterThanOrEqual(2);
  });
});
