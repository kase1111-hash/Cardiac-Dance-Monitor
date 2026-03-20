/**
 * Equivalence analyzer — compares BLE vs Camera PPG streams.
 *
 * Per SPEC Section 8.5:
 * - Records both PPI streams simultaneously
 * - Computes correlation between paired PPIs
 * - Computes torus features from both and compares dance ID
 * - Viability: >80% dance agreement → viable standalone
 *              50-80% → screening only
 *              <50% → not viable
 */
import {
  toAngle, mengerCurvature, giniCoefficient, median, std,
} from '../../shared/torus-engine';
import { matchDance } from '../../shared/dance-matcher';
import { PPI_MIN, PPI_MAX } from '../../shared/constants';

const MIN_PPIS_FOR_ANALYSIS = 30;
const DANCE_WINDOW = 20; // PPIs per dance identification window

export type Viability = 'viable' | 'screening' | 'not_viable';

export interface EquivalenceResult {
  /** Pearson correlation of paired PPIs. */
  ppiCorrelation: number;
  /** Mean absolute PPI difference in ms. */
  meanPPIDiffMs: number;
  /** Percentage of windows where both sources identify the same dance. */
  danceAgreementPct: number;
  /** Overall viability assessment. */
  viability: Viability;
  /** Number of paired PPIs used. */
  pairedCount: number;
  /** BLE dance identifications per window. */
  bleDances: string[];
  /** Camera dance identifications per window. */
  cameraDances: string[];
}

interface TimestampedPPI {
  ppi: number;
  timestamp: number;
}

export class EquivalenceAnalyzer {
  private blePPIs: TimestampedPPI[] = [];
  private cameraPPIs: TimestampedPPI[] = [];

  addBlePPI(ppi: number, timestamp: number): void {
    this.blePPIs.push({ ppi, timestamp });
  }

  addCameraPPI(ppi: number, timestamp: number): void {
    this.cameraPPIs.push({ ppi, timestamp });
  }

  getBleCount(): number {
    return this.blePPIs.length;
  }

  getCameraCount(): number {
    return this.cameraPPIs.length;
  }

  canAnalyze(): boolean {
    return this.blePPIs.length >= MIN_PPIS_FOR_ANALYSIS &&
           this.cameraPPIs.length >= MIN_PPIS_FOR_ANALYSIS;
  }

  /**
   * Run equivalence analysis. Returns null if insufficient data.
   */
  analyze(): EquivalenceResult | null {
    if (!this.canAnalyze()) return null;

    // Use the shorter stream length for pairing
    const n = Math.min(this.blePPIs.length, this.cameraPPIs.length);
    const blePpis = this.blePPIs.slice(0, n).map(p => p.ppi);
    const camPpis = this.cameraPPIs.slice(0, n).map(p => p.ppi);

    // Pearson correlation
    const correlation = pearsonCorrelation(blePpis, camPpis);

    // Mean absolute PPI difference
    let diffSum = 0;
    for (let i = 0; i < n; i++) {
      diffSum += Math.abs(blePpis[i] - camPpis[i]);
    }
    const meanDiff = diffSum / n;

    // Dance identification per window
    const bleDances = identifyDances(blePpis, DANCE_WINDOW);
    const cameraDances = identifyDances(camPpis, DANCE_WINDOW);

    // Dance agreement
    const windowCount = Math.min(bleDances.length, cameraDances.length);
    let agreements = 0;
    for (let i = 0; i < windowCount; i++) {
      if (bleDances[i] === cameraDances[i]) agreements++;
    }
    const agreementPct = windowCount > 0 ? (agreements / windowCount) * 100 : 0;

    // Viability
    let viability: Viability;
    if (agreementPct >= 80) {
      viability = 'viable';
    } else if (agreementPct >= 50) {
      viability = 'screening';
    } else {
      viability = 'not_viable';
    }

    return {
      ppiCorrelation: correlation,
      meanPPIDiffMs: meanDiff,
      danceAgreementPct: agreementPct,
      viability,
      pairedCount: n,
      bleDances,
      cameraDances,
    };
  }

  reset(): void {
    this.blePPIs = [];
    this.cameraPPIs = [];
  }
}

/** Compute Pearson correlation coefficient between two arrays. */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Run dance identification on PPI windows.
 * Returns array of dance names, one per window.
 */
function identifyDances(ppis: number[], windowSize: number): string[] {
  const dances: string[] = [];
  const numWindows = Math.floor(ppis.length / windowSize);

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    const window = ppis.slice(start, start + windowSize);

    // Compute torus points with fixed normalization
    const points: { theta1: number; theta2: number }[] = [];
    for (let i = 1; i < window.length; i++) {
      points.push({
        theta1: toAngle(window[i - 1], PPI_MIN, PPI_MAX),
        theta2: toAngle(window[i], PPI_MIN, PPI_MAX),
      });
    }

    // Compute curvatures
    const kappas: number[] = [];
    for (let i = 1; i < points.length - 1; i++) {
      const p1: [number, number] = [points[i - 1].theta1, points[i - 1].theta2];
      const p2: [number, number] = [points[i].theta1, points[i].theta2];
      const p3: [number, number] = [points[i + 1].theta1, points[i + 1].theta2];
      kappas.push(mengerCurvature(p1, p2, p3));
    }

    const positiveKappas = kappas.filter(k => k > 0);
    if (positiveKappas.length < 2) {
      dances.push('unknown');
      continue;
    }

    const km = median(positiveKappas);
    const g = giniCoefficient(positiveKappas);
    const t1s = points.map(p => p.theta1);
    const t2s = points.map(p => p.theta2);
    const s = std(t1s) + std(t2s);

    const match = matchDance(km, g, s);
    dances.push(match.name);
  }

  return dances;
}
