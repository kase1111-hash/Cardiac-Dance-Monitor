/**
 * Pure point-mapping math for sparkline charts. No React Native imports so
 * it can be unit-tested in the node Jest environment.
 */

/** Fixed BPM axis — deliberately wide so rate changes look as small as they are. */
export const BPM_DOMAIN: readonly [number, number] = [40, 140];

/** Fixed spread axis — covers all five dance centroids (0.04 to 3.30). */
export const SPREAD_DOMAIN: readonly [number, number] = [0, 4];

/**
 * Map a value series onto an SVG polyline points string.
 * X spreads indices evenly across the width; Y maps [min, max] to
 * [height - pad, pad] (SVG y grows downward). Values are clamped to the
 * domain — fixed axes are the point, they must never auto-zoom.
 * Returns '' when there are fewer than 2 points to draw.
 */
export function sparklinePoints(
  values: number[],
  min: number,
  max: number,
  width: number,
  height: number,
  pad: number = 3,
): string {
  if (values.length < 2 || max <= min || width <= 2 * pad) return '';
  const usableW = width - 2 * pad;
  const usableH = height - 2 * pad;
  const step = usableW / (values.length - 1);
  return values
    .map((v, i) => {
      const clamped = Math.min(max, Math.max(min, v));
      const x = pad + i * step;
      const y = pad + (1 - (clamped - min) / (max - min)) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
