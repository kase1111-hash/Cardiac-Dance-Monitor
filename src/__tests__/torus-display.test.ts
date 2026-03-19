/**
 * Torus display mapping tests — verifies angle-to-pixel conversion logic.
 */

const TWO_PI = 2 * Math.PI;

function angleToPixel(angle: number, size: number, padding: number): number {
  const usable = size - 2 * padding;
  return padding + (angle / TWO_PI) * usable;
}

describe('TorusDisplay angle-to-pixel mapping', () => {
  const size = 260;
  const padding = 24;

  test('angle 0 maps to padding', () => {
    expect(angleToPixel(0, size, padding)).toBe(padding);
  });

  test('angle 2π maps to size - padding', () => {
    expect(angleToPixel(TWO_PI, size, padding)).toBeCloseTo(size - padding, 5);
  });

  test('angle π maps to center', () => {
    const center = padding + (size - 2 * padding) / 2;
    expect(angleToPixel(Math.PI, size, padding)).toBeCloseTo(center, 5);
  });

  test('mapping is monotonically increasing', () => {
    let prev = angleToPixel(0, size, padding);
    for (let a = 0.1; a <= TWO_PI; a += 0.1) {
      const curr = angleToPixel(a, size, padding);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });
});
