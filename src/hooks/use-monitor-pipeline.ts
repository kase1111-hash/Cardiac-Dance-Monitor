/**
 * Monitor pipeline hook — owns ring buffers, torus computation, and dance matching.
 * Consumes PPIs from any source (BLE or simulated) and produces all display state.
 *
 * Uses FIXED normalization (PPI_MIN/PPI_MAX) for dance matching features.
 * Uses ADAPTIVE normalization (2nd/98th percentile) for torus display points.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  toAngle, mengerCurvature, giniCoefficient,
  median, mean, std,
} from '../../shared/torus-engine';
import { matchDance } from '../../shared/dance-matcher';
import {
  PPI_MIN, PPI_MAX, TORUS_WINDOW, KAPPA_WINDOW,
  DANCE_UPDATE_INTERVAL, CONFIDENCE_UNCERTAIN,
} from '../../shared/constants';
import type { TorusPoint, DanceMatch } from '../../shared/types';

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
}

export function useMonitorPipeline() {
  const [state, setState] = useState<PipelineState>({
    displayPoints: [],
    danceMatch: null,
    bpm: null,
    kappaMedian: 0,
    gini: 0,
    spread: 0,
    totalBeats: 0,
    isDancing: false,
  });

  // Ring buffers (mutable refs — no re-render on push)
  const ppiBuffer = useRef<number[]>([]);
  const kappaBuffer = useRef<number[]>([]);
  const displayPoints = useRef<TorusPoint[]>([]);
  const featurePoints = useRef<TorusPoint[]>([]);
  const totalBeats = useRef(0);

  // Adaptive normalization bounds (updated every 10 beats)
  const adaptiveMin = useRef(PPI_MIN);
  const adaptiveMax = useRef(PPI_MAX);
  const beatsSinceAdaptiveUpdate = useRef(0);

  const processPPI = useCallback((ppi: number) => {
    // Push to PPI buffer
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

    // --- DISPLAY points (adaptive normalization) ---
    const dTheta1 = toAngle(prevPPI, adaptiveMin.current, adaptiveMax.current);
    const dTheta2 = toAngle(currPPI, adaptiveMin.current, adaptiveMax.current);
    displayPoints.current.push({
      theta1: dTheta1, theta2: dTheta2,
      kappa: 0, beatIndex: totalBeats.current,
    });
    if (displayPoints.current.length > TORUS_WINDOW) displayPoints.current.shift();

    // --- FEATURE points (fixed normalization) ---
    const fTheta1 = toAngle(prevPPI, PPI_MIN, PPI_MAX);
    const fTheta2 = toAngle(currPPI, PPI_MIN, PPI_MAX);
    featurePoints.current.push({
      theta1: fTheta1, theta2: fTheta2,
      kappa: 0, beatIndex: totalBeats.current,
    });
    if (featurePoints.current.length > TORUS_WINDOW) featurePoints.current.shift();

    // --- Curvature (computed from FEATURE points for dance matching) ---
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

      // Also set curvature on display point for coloring
      if (displayPoints.current.length >= 2) {
        displayPoints.current[displayPoints.current.length - 2].kappa = kappa;
      }
    }

    // --- Feature computation + dance matching every DANCE_UPDATE_INTERVAL beats ---
    const shouldUpdate = totalBeats.current % DANCE_UPDATE_INTERVAL === 0;
    const hasEnoughData = kappaBuffer.current.length >= 10;

    if (shouldUpdate && hasEnoughData) {
      const positiveKappas = kappaBuffer.current.filter(k => k > 0);
      if (positiveKappas.length < 2) return;

      const km = median(positiveKappas);
      const g = giniCoefficient(positiveKappas);
      const fPoints = featurePoints.current;
      const t1s = fPoints.map(p => p.theta1);
      const t2s = fPoints.map(p => p.theta2);
      const s = std(t1s) + std(t2s);
      const currentBpm = Math.round(60000 / mean(buf));

      const match = matchDance(km, g, s);
      match.bpm = currentBpm;

      setState({
        displayPoints: [...displayPoints.current],
        danceMatch: match,
        bpm: currentBpm,
        kappaMedian: km,
        gini: g,
        spread: s,
        totalBeats: totalBeats.current,
        isDancing: true,
      });
    } else {
      // Update display points and BPM between dance matches
      const currentBpm = buf.length >= 2 ? Math.round(60000 / mean(buf)) : null;
      setState(prev => ({
        ...prev,
        displayPoints: [...displayPoints.current],
        bpm: currentBpm,
        totalBeats: totalBeats.current,
        isDancing: totalBeats.current >= 10,
      }));
    }
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
    setState({
      displayPoints: [],
      danceMatch: null,
      bpm: null,
      kappaMedian: 0,
      gini: 0,
      spread: 0,
      totalBeats: 0,
      isDancing: false,
    });
  }, []);

  return { state, processPPI, reset };
}
