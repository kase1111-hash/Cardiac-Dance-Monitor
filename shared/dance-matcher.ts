/**
 * Dance matcher — identifies which of five validated rhythm dances best matches
 * the current torus features using weighted centroid distance.
 *
 * Source: Cardiac Torus Paper IV, Section 5
 */
import { DANCE_CENTROIDS, KAPPA_SCALE, GINI_SCALE, SPREAD_SCALE } from './constants';
import type { DanceMatch } from './types';

/**
 * Matches current torus features (κ median, Gini, spread) against the five
 * empirical dance centroids. Returns the best match with confidence and runner-up.
 * Confidence is computed as inverse-distance weighting.
 *
 * Source: Cardiac Torus Paper IV, Section 5.2
 */
export function matchDance(kappaMedian: number, giniVal: number, spread: number): DanceMatch {
  const distances = DANCE_CENTROIDS.map(d => ({
    dance: d,
    dist: Math.sqrt(
      Math.pow((kappaMedian - d.kappa) / KAPPA_SCALE, 2) +
      Math.pow((giniVal - d.gini) / GINI_SCALE, 2) +
      Math.pow((spread - d.spread) / SPREAD_SCALE, 2)
    ),
  }));
  distances.sort((a, b) => a.dist - b.dist);
  const totalInvDist = distances.reduce((s, d) => s + 1 / (d.dist + 0.01), 0);
  const confidence = (1 / (distances[0].dist + 0.01)) / totalInvDist;
  return {
    name: distances[0].dance.name,
    confidence,
    runnerUp: distances[1].dance.name,
    runnerUpConfidence: (1 / (distances[1].dist + 0.01)) / totalInvDist,
    kappaMedian, gini: giniVal, spread, bpm: 0,
  };
}
