/**
 * Quality gate — decides which PPI values are physiologically plausible enough
 * to enter the pipeline, and separately tracks how clean the signal looks.
 *
 * TWO-TIER DESIGN (important — this is a deliberate clinical decision):
 *
 *   Tier 1 — ADMISSION (range): a PPI is fed to the pipeline iff it is finite
 *   and within [PPI_MIN, PPI_MAX]. Anything outside that is physiologically
 *   impossible and is a sensor artifact.
 *
 *   Tier 2 — QUALITY (deviation): a PPI that deviates more than
 *   PPI_DEVIATION_MAX from the running median is flagged "deviant" and counts
 *   against the acceptance rate that drives the signal-quality badge. It is
 *   NOT excluded from the pipeline.
 *
 * Why deviation must not gate admission: an arrhythmia IS deviation. A PVC is
 * a premature beat followed by a compensatory pause — by definition far more
 * than 40% from the median, yet entirely real and the single most diagnostic
 * event in the recording. Gating on deviation deleted exactly those beats and
 * made ventricular ectopy read as normal sinus rhythm. Interval deviation
 * cannot distinguish ectopy from motion artifact; that discrimination belongs
 * at the waveform level (perfusion index, peak template), not here.
 *
 * Source: SPEC.md Section 1.3, revised after replay validation.
 */
import {
  PPI_MIN,
  PPI_MAX,
  PPI_DEVIATION_MAX,
  QUALITY_GOOD,
  QUALITY_FAIR,
} from './constants';

export interface QualityCheckResult {
  /** Physiologically plausible — safe to feed into the pipeline. */
  valid: boolean;
  /** Deviates from the running median — counts against the quality badge. */
  deviant: boolean;
}

export class QualityGate {
  /**
   * Last 15 admitted PPIs in ARRIVAL order (FIFO).
   * Must stay insertion-ordered: evicting by value instead of by age makes the
   * median monotonically non-decreasing, so it ratchets toward the largest
   * values ever seen and never tracks a real heart-rate change.
   */
  private recent: number[] = [];
  private readonly medianSize = 15;

  /** Last 30 cleanliness results for quality tracking */
  private acceptanceWindow: boolean[] = [];
  private readonly windowSize = 30;

  /**
   * Check a PPI value. Returns true if it should be fed to the pipeline.
   * Deviant-but-plausible beats return true and are counted against quality.
   */
  check(ppi: number): boolean {
    return this.checkBeat(ppi).valid;
  }

  /** Full result: admission decision plus the quality signal. */
  checkBeat(ppi: number): QualityCheckResult {
    // Range / finiteness check. NaN fails every comparison, so test it
    // explicitly — otherwise it slips through and poisons every downstream
    // metric (curvature, Gini, confidence) as NaN.
    if (!Number.isFinite(ppi) || ppi < PPI_MIN || ppi > PPI_MAX) {
      this.recordResult(false);
      return { valid: false, deviant: true };
    }

    // Deviation check — quality signal only, never an admission decision.
    let deviant = false;
    if (this.recent.length > 0) {
      const med = this.getRunningMedian();
      deviant = Math.abs(ppi - med) > PPI_DEVIATION_MAX * med;
    }

    this.pushRecent(ppi);
    this.recordResult(!deviant);
    return { valid: true, deviant };
  }

  /**
   * Returns the running median of the last 15 admitted PPIs.
   * Sorts a copy so `recent` keeps its arrival order; 15 elements makes this
   * negligible per beat.
   */
  getRunningMedian(): number {
    if (this.recent.length === 0) return 0;
    const sorted = [...this.recent].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * Returns the clean-beat rate over the last 30 beats (0-1).
   * Drives the signal-quality badge, not pipeline admission.
   */
  getAcceptanceRate(): number {
    if (this.acceptanceWindow.length === 0) return 1;
    const accepted = this.acceptanceWindow.filter(v => v).length;
    return accepted / this.acceptanceWindow.length;
  }

  /**
   * Returns the quality level based on the clean-beat rate.
   */
  getQualityLevel(): 'good' | 'fair' | 'poor' {
    const rate = this.getAcceptanceRate();
    if (rate >= QUALITY_GOOD) return 'good';
    if (rate >= QUALITY_FAIR) return 'fair';
    return 'poor';
  }

  /** Append to the FIFO buffer, evicting the OLDEST value when full. */
  private pushRecent(value: number): void {
    this.recent.push(value);
    if (this.recent.length > this.medianSize) {
      this.recent.shift();
    }
  }

  /** Record a cleanliness result in the sliding window. */
  private recordResult(clean: boolean): void {
    this.acceptanceWindow.push(clean);
    if (this.acceptanceWindow.length > this.windowSize) {
      this.acceptanceWindow.shift();
    }
  }
}
