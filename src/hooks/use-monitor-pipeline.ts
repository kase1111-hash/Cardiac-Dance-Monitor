/**
 * Monitor pipeline hook — owns ring buffers, torus computation, dance matching,
 * baseline learning, and change detection.
 *
 * Uses FIXED normalization (PPI_MIN/PPI_MAX) for dance matching features.
 * Uses ADAPTIVE normalization (2nd/98th percentile) for torus display points.
 */
import { useState, useRef, useCallback } from 'react';
import {
  toAngle, mengerCurvature, giniCoefficient,
  median, mean, std,
} from '../../shared/torus-engine';
import { matchDance } from '../../shared/dance-matcher';
import {
  PPI_MIN, PPI_MAX, TORUS_WINDOW, KAPPA_WINDOW,
  DANCE_UPDATE_INTERVAL,
} from '../../shared/constants';
import type { TorusPoint, DanceMatch, ChangeStatus } from '../../shared/types';
import { BaselineService } from '../baseline/baseline-service';
import { ChangeDetector, type ChangeLevel } from '../baseline/change-detector';
import { MemoryStorage, type StorageAdapter } from '../session/session-store';

export interface PipelineState {
  /** Torus points for display (adaptive normalization) */
  displayPoints: TorusPoint[];
  /** Current dance match result */
  danceMatch: DanceMatch | null;
  /** Current BPM (running mean) */
  bpm: number | null;
  /** Kappa median */
  kappaMedian: number;
  /** Gini coefficient */
  gini: number;
  /** Spread value */
  spread: number;
  /** Total valid beats received */
  totalBeats: number;
  /** Whether we have enough data to be "dancing" */
  isDancing: boolean;
  /** Change detection status */
  changeStatus: ChangeStatus;
  /** Change level (convenience) */
  changeLevel: ChangeLevel;
  /** Baseline learning progress (0-1) */
  baselineLearningProgress: number;
  /** Whether baseline is currently being learned */
  isLearningBaseline: boolean;
  /** Baseline beat count (for display) */
  baselineBeatCount: number;
  /** 15-beat rolling average BPM */
  bpm15: number | null;
  /** Dynamic trail length from autocorrelation (respiratory cycle) */
  trailLength: number;
}

const DEFAULT_TRAIL_LENGTH = 20;

/**
 * Find the dominant oscillation period of a PPI series via autocorrelation.
 * Returns the lag (in beats) of the first autocorrelation peak after lag 0,
 * typically 12-25 beats for respiratory sinus arrhythmia.
 * Returns DEFAULT_TRAIL_LENGTH if no clear peak is found.
 */
function computeRespiratoryPeriod(ppis: number[]): number {
  if (ppis.length < 20) return DEFAULT_TRAIL_LENGTH;

  const n = ppis.length;
  const m = mean(ppis);
  const variance = ppis.reduce((s, v) => s + (v - m) ** 2, 0);
  if (variance < 1) return DEFAULT_TRAIL_LENGTH;

  // Compute normalized autocorrelation for lags 4..30
  const minLag = 4;   // ignore very short cycles
  const maxLag = Math.min(30, Math.floor(n / 2));
  const acf: number[] = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (ppis[i] - m) * (ppis[i + lag] - m);
    }
    acf.push(sum / variance);
  }

  // Find first peak: acf[i] > acf[i-1] && acf[i] > acf[i+1] && acf[i] > 0.1
  for (let i = 1; i < acf.length - 1; i++) {
    if (acf[i] > acf[i - 1] && acf[i] > acf[i + 1] && acf[i] > 0.1) {
      return minLag + i;
    }
  }

  return DEFAULT_TRAIL_LENGTH;
}

const DEFAULT_CHANGE_STATUS: ChangeStatus = {
  mahalanobisDistance: 0,
  level: 'learning',
  sustainedSince: null,
};

export function useMonitorPipeline(storage?: StorageAdapter) {
  const baselineService = useRef(new BaselineService(storage ?? new MemoryStorage()));
  const changeDetector = useRef(new ChangeDetector());

  const [state, setState] = useState<PipelineState>({
    displayPoints: [],
    danceMatch: null,
    bpm: null,
    bpm15: null,
    kappaMedian: 0,
    gini: 0,
    spread: 0,
    totalBeats: 0,
    isDancing: false,
    changeStatus: DEFAULT_CHANGE_STATUS,
    changeLevel: 'learning',
    baselineLearningProgress: 0,
    isLearningBaseline: true,
    baselineBeatCount: 0,
    trailLength: DEFAULT_TRAIL_LENGTH,
  });

  // Ring buffers (mutable refs — no re-render on push)
  const ppiBuffer = useRef<number[]>([]);
  const kappaBuffer = useRef<number[]>([]);
  const displayPoints = useRef<TorusPoint[]>([]);
  const featurePoints = useRef<TorusPoint[]>([]);
  const totalBeats = useRef(0);

  // Adaptive normalization bounds
  const adaptiveMin = useRef(PPI_MIN);
  const adaptiveMax = useRef(PPI_MAX);

  const processPPI = useCallback((ppi: number) => {
    console.log('PIPELINE_BEAT', totalBeats.current + 1, 'ppi=', ppi);
    ppiBuffer.current.push(ppi);
    if (ppiBuffer.current.length > TORUS_WINDOW) ppiBuffer.current.shift();
    totalBeats.current++;

    const buf = ppiBuffer.current;
    if (buf.length < 2) return;

    // Update adaptive normalization EVERY beat for smooth visual transitions.
    // Without per-beat updates, NSR integer PPIs (780 vs 781) map to positions
    // only ~2px apart, making 60 dots look like ~15 blobs.
    {
      const sorted = [...buf].sort((a, b) => a - b);
      const newMin = sorted[Math.max(0, Math.floor(sorted.length * 0.02))];
      const newMax = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
      adaptiveMin.current = newMin;
      adaptiveMax.current = newMax;
    }

    const n = buf.length;

    // Re-map ALL existing display points with current adaptive bounds.
    // This prevents stale normalization from the first few beats causing
    // permanent clustering. All points stay in sync with the latest bounds.
    for (let i = 0; i < displayPoints.current.length; i++) {
      const dp = displayPoints.current[i];
      const ppiIdx = buf.length - displayPoints.current.length + i;
      if (ppiIdx >= 0 && ppiIdx < buf.length) {
        const prevIdx = Math.max(0, ppiIdx - 1);
        dp.theta1 = toAngle(buf[prevIdx], adaptiveMin.current, adaptiveMax.current);
        dp.theta2 = toAngle(buf[ppiIdx], adaptiveMin.current, adaptiveMax.current);
      }
    }

    const prevPPI = buf[n - 2];
    const currPPI = buf[n - 1];

    // DISPLAY points (adaptive normalization) — new point for this beat
    const dTheta1 = toAngle(prevPPI, adaptiveMin.current, adaptiveMax.current);
    const dTheta2 = toAngle(currPPI, adaptiveMin.current, adaptiveMax.current);
    displayPoints.current.push({
      theta1: dTheta1, theta2: dTheta2, kappa: 0, beatIndex: totalBeats.current,
    });
    if (displayPoints.current.length > TORUS_WINDOW) displayPoints.current.shift();

    // FEATURE points (fixed normalization)
    const fTheta1 = toAngle(prevPPI, PPI_MIN, PPI_MAX);
    const fTheta2 = toAngle(currPPI, PPI_MIN, PPI_MAX);
    featurePoints.current.push({
      theta1: fTheta1, theta2: fTheta2, kappa: 0, beatIndex: totalBeats.current,
    });
    if (featurePoints.current.length > TORUS_WINDOW) featurePoints.current.shift();

    // Curvature (from FEATURE points)
    const fLen = featurePoints.current.length;
    if (fLen >= 3) {
      const fp = featurePoints.current;
      const p1: [number, number] = [fp[fLen - 3].theta1, fp[fLen - 3].theta2];
      const p2: [number, number] = [fp[fLen - 2].theta1, fp[fLen - 2].theta2];
      const p3: [number, number] = [fp[fLen - 1].theta1, fp[fLen - 1].theta2];
      const kappa = mengerCurvature(p1, p2, p3);
      fp[fLen - 2].kappa = kappa;
      kappaBuffer.current.push(kappa);
      if (kappaBuffer.current.length > KAPPA_WINDOW) kappaBuffer.current.shift();

      if (displayPoints.current.length >= 2) {
        displayPoints.current[displayPoints.current.length - 2].kappa = kappa;
      }
    }

    // Count every raw beat for baseline learning
    const bs = baselineService.current;
    bs.countBeat();

    // BPM + torus display update on EVERY beat
    const currentBpm = buf.length >= 2 ? Math.round(60000 / mean(buf)) : null;
    const last15 = buf.slice(-15);
    const bpm15 = last15.length >= 2 ? Math.round(60000 / mean(last15)) : null;

    // Respiratory cycle trail length — recompute every 10 beats (cheap enough)
    let trailUpdate: Partial<PipelineState> = {};
    if (totalBeats.current % DANCE_UPDATE_INTERVAL === 0 && buf.length >= 20) {
      const period = computeRespiratoryPeriod(buf);
      trailUpdate = { trailLength: period };
    }

    let perBeatUpdate: Partial<PipelineState> = {
      displayPoints: [...displayPoints.current],
      bpm: currentBpm,
      bpm15,
      totalBeats: totalBeats.current,
      isDancing: totalBeats.current >= 10,
      baselineLearningProgress: bs.getLearningProgress(),
      isLearningBaseline: bs.isLearning(),
      baselineBeatCount: bs.getSampleCount(),
      ...trailUpdate,
    };

    // Dance identification + features every DANCE_UPDATE_INTERVAL beats
    const shouldMatchDance = totalBeats.current % DANCE_UPDATE_INTERVAL === 0;
    const hasEnoughData = kappaBuffer.current.length >= 10;

    if (shouldMatchDance && hasEnoughData) {
      const positiveKappas = kappaBuffer.current.filter(k => k > 0);
      if (positiveKappas.length >= 2) {
        const km = median(positiveKappas);
        const g = giniCoefficient(positiveKappas);
        const fPoints = featurePoints.current;
        const t1s = fPoints.map(p => p.theta1);
        const t2s = fPoints.map(p => p.theta2);
        const s = std(t1s) + std(t2s);

        const match = matchDance(km, g, s);
        match.bpm = currentBpm ?? 0;

        // Diagnostic: verify features match expected dance centroids
        console.log(
          `[Dance] beat=${totalBeats.current} κ=${km.toFixed(1)} G=${g.toFixed(3)} σ=${s.toFixed(2)} → ${match.name} (${(match.confidence * 100).toFixed(0)}%) BPM=${currentBpm}`,
        );

        // Baseline learning
        const bs = baselineService.current;
        if (bs.isLearning()) {
          bs.addSample(km, g, s, currentBpm ?? 0);
        }

        // Change detection
        const baseline = bs.getBaseline();
        const changeStatus = changeDetector.current.update(
          baseline, { kappa: km, gini: g, spread: s },
        );

        perBeatUpdate = {
          ...perBeatUpdate,
          danceMatch: match,
          kappaMedian: km,
          gini: g,
          spread: s,
          isDancing: true,
          changeStatus,
          changeLevel: changeStatus.level as ChangeLevel,
          baselineLearningProgress: bs.getLearningProgress(),
          isLearningBaseline: bs.isLearning(),
          baselineBeatCount: bs.getSampleCount(),
        };
      }
    }

    console.log('SET_STATE beat=', totalBeats.current, 'pts=', (perBeatUpdate.displayPoints ?? []).length);
    setState(prev => ({ ...prev, ...perBeatUpdate }))
  }, []);

  const reset = useCallback(() => {
    ppiBuffer.current = [];
    kappaBuffer.current = [];
    displayPoints.current = [];
    featurePoints.current = [];
    totalBeats.current = 0;
    adaptiveMin.current = PPI_MIN;
    adaptiveMax.current = PPI_MAX;
    changeDetector.current.reset();
    setState({
      displayPoints: [],
      danceMatch: null,
      bpm: null,
      bpm15: null,
      kappaMedian: 0,
      gini: 0,
      spread: 0,
      totalBeats: 0,
      isDancing: false,
      changeStatus: DEFAULT_CHANGE_STATUS,
      changeLevel: 'learning',
      baselineLearningProgress: baselineService.current.getLearningProgress(),
      isLearningBaseline: baselineService.current.isLearning(),
      baselineBeatCount: 0,
      trailLength: DEFAULT_TRAIL_LENGTH,
    });
  }, []);

  const resetBaseline = useCallback(async () => {
    await baselineService.current.reset();
    changeDetector.current.reset();
    setState(prev => ({
      ...prev,
      changeStatus: DEFAULT_CHANGE_STATUS,
      changeLevel: 'learning',
      baselineLearningProgress: 0,
      isLearningBaseline: true,
      baselineBeatCount: 0,
    }));
  }, []);

  /** Force-establish baseline (for testing — skips duration check). */
  const forceEstablishBaseline = useCallback(() => {
    return baselineService.current.forceEstablish();
  }, []);

  const getBaselineService = useCallback(() => baselineService.current, []);

  return { state, processPPI, reset, resetBaseline, forceEstablishBaseline, getBaselineService };
}
