/**
 * Torus math unit tests — test vectors from SPEC.md Section 10.
 * Written FIRST (TDD) before implementation.
 */
import {
  toAngle,
  geodesicDistance,
  mengerCurvature,
  giniCoefficient,
} from '../torus-engine';

const TWO_PI = 2 * Math.PI;

describe('toAngle', () => {
  test('toAngle(300, 300, 1500) → 0', () => {
    expect(toAngle(300, 300, 1500)).toBe(0);
  });

  test('toAngle(1500, 300, 1500) → ≈ 2π', () => {
    expect(toAngle(1500, 300, 1500)).toBeCloseTo(TWO_PI, 5);
  });

  test('toAngle(900, 300, 1500) → ≈ π', () => {
    expect(toAngle(900, 300, 1500)).toBeCloseTo(Math.PI, 5);
  });

  test('toAngle returns π when min ≈ max (degenerate range)', () => {
    expect(toAngle(500, 500, 500)).toBe(Math.PI);
    expect(toAngle(500, 500, 500.0005)).toBe(Math.PI);
  });

  test('toAngle clamps values below min to 0', () => {
    expect(toAngle(200, 300, 1500)).toBe(0);
  });

  test('toAngle clamps values above max to 2π', () => {
    expect(toAngle(2000, 300, 1500)).toBeCloseTo(TWO_PI, 5);
  });
});

describe('geodesicDistance', () => {
  test('geodesicDistance([0, 0], [π, π]) → ≈ π√2', () => {
    const result = geodesicDistance([0, 0], [Math.PI, Math.PI]);
    expect(result).toBeCloseTo(Math.PI * Math.SQRT2, 5);
  });

  test('geodesicDistance([0.01, 0], [2π - 0.01, 0]) → ≈ 0.02 (wraps correctly)', () => {
    const result = geodesicDistance([0.01, 0], [TWO_PI - 0.01, 0]);
    expect(result).toBeCloseTo(0.02, 5);
  });

  test('geodesicDistance of same point → 0', () => {
    expect(geodesicDistance([1, 2], [1, 2])).toBe(0);
  });

  test('geodesicDistance wraps in both dimensions', () => {
    const result = geodesicDistance([0.01, 0.01], [TWO_PI - 0.01, TWO_PI - 0.01]);
    expect(result).toBeCloseTo(Math.sqrt(0.02 * 0.02 + 0.02 * 0.02), 5);
  });
});

describe('mengerCurvature', () => {
  test('mengerCurvature of collinear points → 0', () => {
    // Three points along a straight line on the torus
    const p1: [number, number] = [1, 1];
    const p2: [number, number] = [2, 2];
    const p3: [number, number] = [3, 3];
    expect(mengerCurvature(p1, p2, p3)).toBe(0);
  });

  test('mengerCurvature of coincident points → 0', () => {
    const p: [number, number] = [1, 1];
    expect(mengerCurvature(p, p, p)).toBe(0);
  });

  test('mengerCurvature returns positive value for non-collinear points', () => {
    const p1: [number, number] = [0, 0];
    const p2: [number, number] = [1, 0];
    const p3: [number, number] = [0, 1];
    expect(mengerCurvature(p1, p2, p3)).toBeGreaterThan(0);
  });

  test('mengerCurvature of equilateral triangle has expected curvature', () => {
    // Equilateral triangle with side length s → curvature = 2/(s√3) * 4 * area / (s^3)
    // For equilateral triangle: area = (√3/4)*s², so κ = 4*(√3/4)*s² / s³ = √3/s
    // Wait — Menger curvature = 4*area / (a*b*c). For equilateral: κ = 4*(√3/4)*s² / s³ = √3/s
    const s = 1.0;
    const p1: [number, number] = [0, 0];
    const p2: [number, number] = [s, 0];
    const p3: [number, number] = [s / 2, s * Math.sqrt(3) / 2];
    const result = mengerCurvature(p1, p2, p3);
    // All sides = geodesicDistance = s (no wrapping needed at these coords)
    // Expected: √3 / s = √3 ≈ 1.7321
    // But Menger curvature formula: 4*sqrt(s*(s-a)*(s-b)*(s-c)) / (a*b*c) where s = semiperimeter
    // For equilateral: semi = 3s/2, area_heron = sqrt(3s/2 * s/2 * s/2 * s/2) = sqrt(3*s^4/16) = s²*sqrt(3)/4
    // κ = 4 * s²*sqrt(3)/4 / s³ = sqrt(3)/s
    expect(result).toBeCloseTo(Math.sqrt(3) / s, 4);
  });
});

describe('giniCoefficient', () => {
  test('giniCoefficient([1, 1, 1, 1]) → 0', () => {
    expect(giniCoefficient([1, 1, 1, 1])).toBe(0);
  });

  test('giniCoefficient([0.001, 0.001, 0.001, 100]) → ≈ 0.75', () => {
    const result = giniCoefficient([0.001, 0.001, 0.001, 100]);
    expect(result).toBeCloseTo(0.75, 1);
  });

  test('giniCoefficient of single value → 0', () => {
    expect(giniCoefficient([5])).toBe(0);
  });

  test('giniCoefficient of empty array → 0', () => {
    expect(giniCoefficient([])).toBe(0);
  });

  test('giniCoefficient filters out zeros', () => {
    // [0, 1, 1, 1, 1] should be same as [1, 1, 1, 1]
    expect(giniCoefficient([0, 1, 1, 1, 1])).toBe(0);
  });

  test('giniCoefficient is between 0 and 1', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = giniCoefficient(values);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
