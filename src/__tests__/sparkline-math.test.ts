/**
 * Sparkline point-mapping tests for the ComparisonStrip charts.
 */
import { sparklinePoints, BPM_DOMAIN, SPREAD_DOMAIN } from '../display/sparkline-math';

function parsePoints(str: string): Array<[number, number]> {
  if (str === '') return [];
  return str.split(' ').map(p => {
    const [x, y] = p.split(',').map(Number);
    return [x, y] as [number, number];
  });
}

describe('sparklinePoints', () => {
  const width = 240;
  const height = 44;
  const pad = 3;

  test('returns empty string for fewer than 2 values', () => {
    expect(sparklinePoints([], 0, 4, width, height)).toBe('');
    expect(sparklinePoints([1.5], 0, 4, width, height)).toBe('');
  });

  test('returns empty string for degenerate domain or width', () => {
    expect(sparklinePoints([1, 2], 4, 4, width, height)).toBe('');
    expect(sparklinePoints([1, 2], 4, 0, width, height)).toBe('');
    expect(sparklinePoints([1, 2], 0, 4, 4, height)).toBe('');
  });

  test('first and last x span the padded width', () => {
    const pts = parsePoints(sparklinePoints([60, 70, 80], 40, 140, width, height, pad));
    expect(pts[0][0]).toBeCloseTo(pad, 1);
    expect(pts[pts.length - 1][0]).toBeCloseTo(width - pad, 1);
  });

  test('x is monotonically increasing and evenly spaced', () => {
    const pts = parsePoints(sparklinePoints([1, 2, 3, 2, 1], 0, 4, width, height, pad));
    const step = pts[1][0] - pts[0][0];
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
      expect(pts[i][0] - pts[i - 1][0]).toBeCloseTo(step, 1);
    }
  });

  test('higher values map to smaller y (SVG y grows downward)', () => {
    const pts = parsePoints(sparklinePoints([40, 140], 40, 140, width, height, pad));
    expect(pts[0][1]).toBeCloseTo(height - pad, 1); // min value at bottom
    expect(pts[1][1]).toBeCloseTo(pad, 1);          // max value at top
  });

  test('values are clamped to the domain, never plotted outside', () => {
    const pts = parsePoints(sparklinePoints([-10, 999], 0, 4, width, height, pad));
    expect(pts[0][1]).toBeCloseTo(height - pad, 1);
    expect(pts[1][1]).toBeCloseTo(pad, 1);
  });

  test('domains cover the dance centroid ranges', () => {
    // Spread centroids run 0.04 (Lock-Step) to 3.30 (Stumble)
    expect(SPREAD_DOMAIN[0]).toBeLessThanOrEqual(0.04);
    expect(SPREAD_DOMAIN[1]).toBeGreaterThanOrEqual(3.3);
    // BPM domain covers the plausible resting-to-elevated range
    expect(BPM_DOMAIN[0]).toBeLessThanOrEqual(45);
    expect(BPM_DOMAIN[1]).toBeGreaterThanOrEqual(130);
  });
});
