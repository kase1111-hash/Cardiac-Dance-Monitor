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
  const beatsSinceAdaptiveUpdate = useRef(0);

  const processPPI = useCallback((ppi: number) => {
    ppiBuffer.current.push(ppi);
    if (ppiBuffer.current.length > TORUS_WINDOW) ppiBuffer.current.shift();
    totalBeats.current++;
    beatsSinceAdaptiveUpdate.current++;

    const buf = ppiBuffer.current;
    if (buf.length < 2) return;

    // Update adaptive normalization every 10 beats
    if (beatsSinceAdaptiveUpdate.current >= 10) {
      const sorted = [...buf].sort((a, b) => a - b);
      adaptiveMin.current = sorted[Math.floor(sorted.length * 0.02)];
      adaptiveMax.current = sorted[Math.floor(sorted.length * 0.98)];
      beatsSinceAdaptiveUpdate.current = 0;
    }

    const n = buf.length;
    const prevPPI = buf[n - 2];
    const currPPI = buf[n - 1];

    // DISPLAY points (adaptive normalization)
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

    // BPM + torus display update on EVERY beat
    const currentBpm = buf.length >= 2 ? Math.round(60000 / mean(buf)) : null;
    let perBeatUpdate: Partial<PipelineState> = {
      displayPoints: [...displayPoints.current],
      bpm: currentBpm,
      totalBeats: totalBeats.current,
      isDancing: totalBeats.current >= 10,
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

    setState(prev => ({ ...prev, ...perBeatUpdate }))
  }, []);

  const reset = useCallback(() => {
    ppiBuffer.current = [];
    kappaBuffer.current = [];
    displayPoints.current = [];
    featurePoints.current = [];
    totalBeats.current = 0;
    beatsSinceAdaptiveUpdate.current = 0;
    adaptiveMin.current = PPI_MIN;
    adaptiveMax.current = PPI_MAX;
    changeDetector.current.reset();
    setState({
      displayPoints: [],
      danceMatch: null,
      bpm: null,
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
