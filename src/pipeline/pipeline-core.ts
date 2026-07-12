/**
 * Pipeline core — the pure, React-free heart of the monitor pipeline:
 * ring buffers, dual-normalization torus computation, dance matching,
 * baseline learning, and change detection.
 *
 * Extracted from useMonitorPipeline so the exact same code path serves
 * the live monitor (via the hook) and offline session replay
 * (src/replay/session-replay.ts) — replay results are faithful by
 * construction, not by re-implementation.
 *
 * Uses FIXED normalization (PPI_MIN/PPI_MAX) for dance matching features.
 * Uses ADAPTIVE normalization (2nd/98th percentile) for torus display points.
 *
 * All time comes in through processBeat's timestampMs, so a recorded
 * session replays with its original timing (baseline duration rule,
 * alert sustain rule, dropout gaps) regardless of wall-clock speed.
 */
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
import { SignalWatchdog } from '../../shared/signal-watchdog';
import { BaselineService } from '../baseline/baseline-service';
import { ChangeDetector, type ChangeLevel } from '../baseline/change-detector';

/** One feature window (every DANCE_UPDATE_INTERVAL beats) for trend displays. */
export interface FeatureSample {
  /** Total beat count when this window closed */
  beat: number;
  /** Rolling-mean BPM at that moment */
  bpm: number;
  /** Torus spread (σθ1 + σθ2, fixed normalization) */
  spread: number;
}

/** Feature windows kept for trend displays (30 windows ≈ 300 beats). */
const FEATURE_HISTORY_LENGTH = 30;

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
  /** True only on the beat where the baseline was just established */
  baselineJustEstablished: boolean;
  /** 15-beat rolling average BPM */
  bpm15: number | null;
  /** Dynamic trail length from autocorrelation (respiratory cycle) */
  trailLength: number;
  /** Rolling feature-window history for trend displays */
  featureHistory: FeatureSample[];
  /** Dropout gaps detected (torus geometry restarted after each) */
  gapCount: number;
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

export interface PipelineCoreOptions {
  /** Emit per-beat diagnostic console logs (the live monitor turns this on) */
  verbose?: boolean;
}

export class PipelineCore {
  // Ring buffers
  private ppiBuffer: number[] = [];
  private kappaBuffer: number[] = [];
  private displayPoints: TorusPoint[] = [];
  private featurePoints: TorusPoint[] = [];
  private featureHistory: FeatureSample[] = [];
  private totalBeats = 0;

  // Detects sensor dropout gaps so torus geometry never spans them
  private watchdog = new SignalWatchdog();
  private gapCount = 0;

  // Adaptive normalization bounds
  private adaptiveMin = PPI_MIN;
  private adaptiveMax = PPI_MAX;

  private changeDetector = new ChangeDetector();
  private readonly verbose: boolean;
  private state: PipelineState;

  constructor(
    private readonly baselineService: BaselineService,
    options: PipelineCoreOptions = {},
  ) {
    this.verbose = options.verbose ?? false;
    this.state = this.buildInitialState();
  }

  private buildInitialState(): PipelineState {
    return {
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
      baselineLearningProgress: this.baselineService.getLearningProgress(),
      isLearningBaseline: this.baselineService.isLearning(),
      baselineBeatCount: this.baselineService.getSampleCount(),
      baselineJustEstablished: false,
      trailLength: DEFAULT_TRAIL_LENGTH,
      featureHistory: [],
      gapCount: this.gapCount,
    };
  }

  /** Latest state snapshot (fresh object per beat — safe for React state). */
  getState(): PipelineState {
    return this.state;
  }

  /**
   * Process one valid (quality-gated) PPI.
   * Returns the updated state snapshot.
   */
  processBeat(ppi: number, timestampMs: number = Date.now()): PipelineState {
    // A dropout gap means this beat and the previous one are not consecutive
    // heartbeats: pairing them would fabricate a torus point, and the Menger
    // curvature across the gap would feed phantom features into dance
    // matching, baseline learning, and change detection. Restart the
    // geometry buffers; baseline and change-detector state are kept.
    if (this.watchdog.beat(timestampMs)) {
      if (this.verbose) console.log('PIPELINE_GAP: dropout detected — resetting torus geometry');
      this.gapCount++;
      this.ppiBuffer = [];
      this.kappaBuffer = [];
      this.displayPoints = [];
      this.featurePoints = [];
      this.adaptiveMin = PPI_MIN;
      this.adaptiveMax = PPI_MAX;
    }

    if (this.verbose) console.log('PIPELINE_BEAT', this.totalBeats + 1, 'ppi=', ppi);
    this.ppiBuffer.push(ppi);
    if (this.ppiBuffer.length > TORUS_WINDOW) this.ppiBuffer.shift();
    this.totalBeats++;

    const buf = this.ppiBuffer;
    if (buf.length < 2) {
      this.state = {
        ...this.state,
        totalBeats: this.totalBeats,
        gapCount: this.gapCount,
        baselineJustEstablished: false,
      };
      return this.state;
    }

    // Update adaptive normalization EVERY beat for smooth visual transitions.
    // Without per-beat updates, NSR integer PPIs (780 vs 781) map to positions
    // only ~2px apart, making 60 dots look like ~15 blobs.
    {
      const sorted = [...buf].sort((a, b) => a - b);
      this.adaptiveMin = sorted[Math.max(0, Math.floor(sorted.length * 0.02))];
      this.adaptiveMax = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
    }

    const n = buf.length;

    // Re-map ALL existing display points with current adaptive bounds.
    // This prevents stale normalization from the first few beats causing
    // permanent clustering. All points stay in sync with the latest bounds.
    for (let i = 0; i < this.displayPoints.length; i++) {
      const dp = this.displayPoints[i];
      const ppiIdx = buf.length - this.displayPoints.length + i;
      if (ppiIdx >= 0 && ppiIdx < buf.length) {
        const prevIdx = Math.max(0, ppiIdx - 1);
        dp.theta1 = toAngle(buf[prevIdx], this.adaptiveMin, this.adaptiveMax);
        dp.theta2 = toAngle(buf[ppiIdx], this.adaptiveMin, this.adaptiveMax);
      }
    }

    const prevPPI = buf[n - 2];
    const currPPI = buf[n - 1];

    // DISPLAY points (adaptive normalization) — new point for this beat
    const dTheta1 = toAngle(prevPPI, this.adaptiveMin, this.adaptiveMax);
    const dTheta2 = toAngle(currPPI, this.adaptiveMin, this.adaptiveMax);
    this.displayPoints.push({
      theta1: dTheta1, theta2: dTheta2, kappa: 0, beatIndex: this.totalBeats,
    });
    if (this.displayPoints.length > TORUS_WINDOW) this.displayPoints.shift();

    // FEATURE points (fixed normalization)
    const fTheta1 = toAngle(prevPPI, PPI_MIN, PPI_MAX);
    const fTheta2 = toAngle(currPPI, PPI_MIN, PPI_MAX);
    this.featurePoints.push({
      theta1: fTheta1, theta2: fTheta2, kappa: 0, beatIndex: this.totalBeats,
    });
    if (this.featurePoints.length > TORUS_WINDOW) this.featurePoints.shift();

    // Curvature (from FEATURE points)
    const fLen = this.featurePoints.length;
    if (fLen >= 3) {
      const fp = this.featurePoints;
      const p1: [number, number] = [fp[fLen - 3].theta1, fp[fLen - 3].theta2];
      const p2: [number, number] = [fp[fLen - 2].theta1, fp[fLen - 2].theta2];
      const p3: [number, number] = [fp[fLen - 1].theta1, fp[fLen - 1].theta2];
      const kappa = mengerCurvature(p1, p2, p3);
      fp[fLen - 2].kappa = kappa;
      this.kappaBuffer.push(kappa);
      if (this.kappaBuffer.length > KAPPA_WINDOW) this.kappaBuffer.shift();

      if (this.displayPoints.length >= 2) {
        this.displayPoints[this.displayPoints.length - 2].kappa = kappa;
      }
    }

    // Count every raw beat for baseline learning
    const bs = this.baselineService;
    bs.countBeat(timestampMs);

    // BPM + torus display update on EVERY beat
    const currentBpm = buf.length >= 2 ? Math.round(60000 / mean(buf)) : null;
    const last15 = buf.slice(-15);
    const bpm15 = last15.length >= 2 ? Math.round(60000 / mean(last15)) : null;

    // Respiratory cycle trail length — recompute every 10 beats (cheap enough)
    let trailUpdate: Partial<PipelineState> = {};
    if (this.totalBeats % DANCE_UPDATE_INTERVAL === 0 && buf.length >= 20) {
      const period = computeRespiratoryPeriod(buf);
      trailUpdate = { trailLength: period };
    }

    let update: Partial<PipelineState> = {
      displayPoints: [...this.displayPoints],
      bpm: currentBpm,
      bpm15,
      totalBeats: this.totalBeats,
      isDancing: this.totalBeats >= 10,
      baselineJustEstablished: false,
      baselineLearningProgress: bs.getLearningProgress(),
      isLearningBaseline: bs.isLearning(),
      baselineBeatCount: bs.getSampleCount(),
      gapCount: this.gapCount,
      ...trailUpdate,
    };

    // Dance identification + features every DANCE_UPDATE_INTERVAL beats
    const shouldMatchDance = this.totalBeats % DANCE_UPDATE_INTERVAL === 0;
    const hasEnoughData = this.kappaBuffer.length >= 10;

    if (shouldMatchDance && hasEnoughData) {
      const positiveKappas = this.kappaBuffer.filter(k => k > 0);
      if (positiveKappas.length >= 2) {
        const km = median(positiveKappas);
        const g = giniCoefficient(positiveKappas);
        const fPoints = this.featurePoints;
        const t1s = fPoints.map(p => p.theta1);
        const t2s = fPoints.map(p => p.theta2);
        const s = std(t1s) + std(t2s);

        const match = matchDance(km, g, s);
        match.bpm = currentBpm ?? 0;

        // Diagnostic: verify features match expected dance centroids
        if (this.verbose) {
          console.log(
            `[Dance] beat=${this.totalBeats} κ=${km.toFixed(1)} G=${g.toFixed(3)} σ=${s.toFixed(2)} → ${match.name} (${(match.confidence * 100).toFixed(0)}%) BPM=${currentBpm}`,
          );
        }

        // Baseline learning
        let justEstablished = false;
        if (bs.isLearning()) {
          justEstablished = bs.addSample(km, g, s, currentBpm ?? 0, timestampMs);
        }

        // Change detection
        const baseline = bs.getBaseline();
        const changeStatus = this.changeDetector.update(
          baseline, { kappa: km, gini: g, spread: s }, timestampMs,
        );

        // Trend history for the comparison strip
        this.featureHistory.push({
          beat: this.totalBeats, bpm: currentBpm ?? 0, spread: s,
        });
        if (this.featureHistory.length > FEATURE_HISTORY_LENGTH) {
          this.featureHistory.shift();
        }

        update = {
          ...update,
          danceMatch: match,
          kappaMedian: km,
          gini: g,
          spread: s,
          isDancing: true,
          changeStatus,
          changeLevel: changeStatus.level as ChangeLevel,
          baselineJustEstablished: justEstablished,
          baselineLearningProgress: bs.getLearningProgress(),
          isLearningBaseline: bs.isLearning(),
          baselineBeatCount: bs.getSampleCount(),
          featureHistory: [...this.featureHistory],
        };
      }
    }

    this.state = { ...this.state, ...update };
    return this.state;
  }

  /** Reset everything except the baseline (mirrors a source change). */
  reset(): void {
    this.ppiBuffer = [];
    this.kappaBuffer = [];
    this.displayPoints = [];
    this.featurePoints = [];
    this.featureHistory = [];
    this.totalBeats = 0;
    this.gapCount = 0;
    this.adaptiveMin = PPI_MIN;
    this.adaptiveMax = PPI_MAX;
    this.watchdog.reset();
    this.changeDetector.reset();
    this.state = this.buildInitialState();
  }

  /**
   * Sync state after the baseline was reset externally
   * (BaselineService.reset()). Returns the updated snapshot.
   */
  onBaselineReset(): PipelineState {
    this.changeDetector.reset();
    this.state = {
      ...this.state,
      changeStatus: DEFAULT_CHANGE_STATUS,
      changeLevel: 'learning',
      baselineLearningProgress: this.baselineService.getLearningProgress(),
      isLearningBaseline: this.baselineService.isLearning(),
      baselineBeatCount: this.baselineService.getSampleCount(),
      baselineJustEstablished: false,
    };
    return this.state;
  }
}
