/**
 * Camera vs Pulse Ox equivalence logic tests — SPEC Section 8.5.
 *
 * Tests the correlation and comparison computation, not the live camera/BLE
 * integration (which requires device hardware).
 */
import {
  EquivalenceAnalyzer,
  type EquivalenceResult,
} from '../camera/equivalence-analyzer';

describe('EquivalenceAnalyzer', () => {
  let analyzer: EquivalenceAnalyzer;

  beforeEach(() => {
    analyzer = new EquivalenceAnalyzer();
  });

  test('starts with no data', () => {
    expect(analyzer.getBleCount()).toBe(0);
    expect(analyzer.getCameraCount()).toBe(0);
    expect(analyzer.canAnalyze()).toBe(false);
  });

  test('records BLE and camera PPIs', () => {
    analyzer.addBlePPI(800, 1000);
    analyzer.addBlePPI(810, 2000);
    analyzer.addCameraPPI(805, 1050);
    analyzer.addCameraPPI(815, 2050);

    expect(analyzer.getBleCount()).toBe(2);
    expect(analyzer.getCameraCount()).toBe(2);
  });

  test('needs minimum 30 PPIs from each source to analyze', () => {
    for (let i = 0; i < 29; i++) {
      analyzer.addBlePPI(800 + Math.random() * 50, i * 1000);
      analyzer.addCameraPPI(800 + Math.random() * 50, i * 1000 + 50);
    }
    expect(analyzer.canAnalyze()).toBe(false);

    analyzer.addBlePPI(810, 29000);
    analyzer.addCameraPPI(815, 29050);
    expect(analyzer.canAnalyze()).toBe(true);
  });

  test('identical PPIs produce high correlation', () => {
    // Feed identical PPIs to both sources
    for (let i = 0; i < 60; i++) {
      const ppi = 800 + 50 * Math.sin(2 * Math.PI * i / 20); // varying PPIs
      analyzer.addBlePPI(ppi, i * 1000);
      analyzer.addCameraPPI(ppi, i * 1000 + 30);
    }

    const result = analyzer.analyze();
    expect(result).not.toBeNull();
    expect(result!.ppiCorrelation).toBeGreaterThan(0.9);
    expect(result!.viability).toBe('viable');
  });

  test('uncorrelated PPIs produce low correlation', () => {
    // Feed independent random PPIs
    const rng1 = seedRandom(42);
    const rng2 = seedRandom(99);

    for (let i = 0; i < 60; i++) {
      analyzer.addBlePPI(600 + rng1() * 400, i * 1000);
      analyzer.addCameraPPI(600 + rng2() * 400, i * 1000 + 30);
    }

    const result = analyzer.analyze();
    expect(result).not.toBeNull();
    // Uncorrelated should have low correlation
    expect(Math.abs(result!.ppiCorrelation)).toBeLessThan(0.5);
  });

  test('viability assessment: viable (>80% dance agreement)', () => {
    // Same PPIs = same dances = viable
    for (let i = 0; i < 60; i++) {
      const ppi = 800 + 50 * Math.sin(2 * Math.PI * i / 20);
      analyzer.addBlePPI(ppi, i * 1000);
      analyzer.addCameraPPI(ppi, i * 1000 + 30);
    }

    const result = analyzer.analyze()!;
    expect(result.viability).toBe('viable');
    expect(result.danceAgreementPct).toBeGreaterThanOrEqual(80);
  });

  test('analyze returns mean PPI difference', () => {
    for (let i = 0; i < 60; i++) {
      const ppi = 800;
      analyzer.addBlePPI(ppi, i * 1000);
      analyzer.addCameraPPI(ppi + 10, i * 1000 + 30); // systematic 10ms offset
    }

    const result = analyzer.analyze()!;
    expect(result.meanPPIDiffMs).toBeCloseTo(10, 0);
  });

  test('reset clears all data', () => {
    for (let i = 0; i < 40; i++) {
      analyzer.addBlePPI(800, i * 1000);
      analyzer.addCameraPPI(800, i * 1000);
    }
    expect(analyzer.canAnalyze()).toBe(true);

    analyzer.reset();
    expect(analyzer.getBleCount()).toBe(0);
    expect(analyzer.getCameraCount()).toBe(0);
    expect(analyzer.canAnalyze()).toBe(false);
  });
});

/** Simple seeded PRNG for deterministic tests. */
function seedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}
