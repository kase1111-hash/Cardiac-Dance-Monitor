/**
 * Torus math engine — canonical implementations from Cardiac Torus research.
 * These functions are shared between the phone app (Tier 1) and ESP32 firmware (Tier 2).
 * DO NOT OPTIMIZE — these are validated against 9,917 ECG records (Papers I and IV).
 */

const TWO_PI = 2 * Math.PI;

/**
 * Maps a value from [min, max] to an angle in [0, 2π).
 * Clamps to [0, 1] before scaling.
 * Returns π if min ≈ max (degenerate range).
 *
 * Source: Cardiac Torus Paper I, Section 3.2
 */
export function toAngle(value: number, min: number, max: number): number {
  if (max - min < 0.001) return Math.PI;
  return TWO_PI * Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Computes geodesic distance between two points on the flat torus T².
 * Accounts for wrapping in both dimensions (shortest path on the torus).
 *
 * Source: Cardiac Torus Paper I, Section 3.3
 */
export function geodesicDistance(a: [number, number], b: [number, number]): number {
  let d1 = Math.abs(a[0] - b[0]);
  d1 = Math.min(d1, TWO_PI - d1);
  let d2 = Math.abs(a[1] - b[1]);
  d2 = Math.min(d2, TWO_PI - d2);
  return Math.sqrt(d1 * d1 + d2 * d2);
}

/**
 * Computes Menger curvature of three consecutive points on the torus.
 * κ = 4·Area(triangle) / (a·b·c) where a,b,c are geodesic side lengths.
 * Area computed via Heron's formula.
 * Returns 0 for degenerate triangles (collinear or coincident points).
 *
 * Source: Cardiac Torus Paper I, Section 4.1
 */
export function mengerCurvature(
  p1: [number, number], p2: [number, number], p3: [number, number]
): number {
  const a = geodesicDistance(p2, p3);
  const b = geodesicDistance(p1, p3);
  const c = geodesicDistance(p1, p2);
  if (a < 1e-8 || b < 1e-8 || c < 1e-8) return 0;
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c);
  if (area2 <= 0) return 0;
  return (4 * Math.sqrt(area2)) / (a * b * c);
}

/**
 * Computes the Gini coefficient of a set of positive values.
 * Filters out non-positive values before computation.
 * Returns 0 for fewer than 2 positive values.
 *
 * Source: Cardiac Torus Paper IV, Section 2.3
 */
export function giniCoefficient(values: number[]): number {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return 0;
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  let weighted = 0;
  v.forEach((val, i) => { weighted += (i + 1) * val; });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

/**
 * Computes the median of an array of numbers.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Computes the arithmetic mean of an array of numbers.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Computes the standard deviation of an array of numbers.
 */
export function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const sumSqDiff = values.reduce((acc, v) => acc + (v - m) * (v - m), 0);
  return Math.sqrt(sumSqDiff / values.length);
}
