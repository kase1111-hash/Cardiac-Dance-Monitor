/**
 * PPG processor — combines Butterworth bandpass + peak detection.
 *
 * Pipeline: raw red channel → bandpass filter → peak detection → PPI output.
 * Per SPEC Section 1.4.
 */
import { ButterworthBandpass } from './butterworth-filter';
import { PeakDetector } from './peak-detector';
import { PPI_MIN, PPI_MAX } from '../../shared/constants';

const PPG_LOW_CUTOFF = 0.5;  // Hz (30 BPM lower bound)
const PPG_HIGH_CUTOFF = 4.0; // Hz (240 BPM upper bound)

export interface PPGProcessorOptions {
  /**
   * Minimum peak-to-peak amplitude of the FILTERED signal (over the last two
   * seconds) for a peak to count as a pulse. 0 disables the gate.
   *
   * The peak detector accepts any local maximum above zero, so with nothing
   * on the camera lens a few LSB of sensor noise still yields ~2 "beats" per
   * second. A real fingertip pulse swings several units; noise swings a
   * fraction of one. Sources whose signal level is known (BLE oximeter) keep
   * the gate off.
   */
  minAmplitude?: number;
}

export class PPGProcessor {
  private filter: ButterworthBandpass;
  private detector: PeakDetector;
  private peakCount = 0;
  private lastPeakTimestamp: number | null = null;
  private readonly minAmplitude: number;
  private readonly recent: number[] = [];
  private readonly recentCap: number;

  /** Called when a valid PPI is extracted. */
  onPPI: ((ppiMs: number) => void) | null = null;

  /**
   * @param sampleRate - Camera frame rate in Hz (typically 30)
   */
  constructor(sampleRate: number = 30, options: PPGProcessorOptions = {}) {
    this.filter = new ButterworthBandpass(PPG_LOW_CUTOFF, PPG_HIGH_CUTOFF, sampleRate);
    this.detector = new PeakDetector(PPI_MIN); // 300ms minimum
    this.minAmplitude = options.minAmplitude ?? 0;
    this.recentCap = Math.max(4, Math.round(sampleRate * 2));
  }

  /**
   * Process one camera frame's red channel mean intensity.
   *
   * @param redMean - Mean red channel intensity (0-255)
   * @param timestampMs - Frame timestamp in milliseconds
   */
  processFrame(redMean: number, timestampMs: number): void {
    const filtered = this.filter.process(redMean);
    if (this.minAmplitude > 0) {
      this.recent.push(filtered);
      if (this.recent.length > this.recentCap) this.recent.shift();
    }
    const peakTimestamp = this.detector.process(filtered, timestampMs);

    if (peakTimestamp !== null) {
      if (this.minAmplitude > 0) {
        // Warm-up: the bandpass filter rings for ~2 s after a reset (a DC
        // step of the whole red level), and that ringing is above any
        // amplitude floor. Peaks are not trusted until the window is full.
        if (this.recent.length < this.recentCap) return;
        // Too small to be a pulse — noise. Not counted, not emitted.
        if (this.getFilteredAmplitude() < this.minAmplitude) return;
      }

      this.peakCount++;

      if (this.lastPeakTimestamp !== null) {
        const ppi = peakTimestamp - this.lastPeakTimestamp;
        // Emit only physiologically plausible intervals. The filter's
        // initialization transient produces a spurious early peak (the first
        // emitted PPI measured ~1733ms in testing), and a missed beat doubles
        // the interval. Passing those downstream let them count against the
        // quality gate's clean-beat rate as if they were real measurements.
        if (this.onPPI && ppi >= PPI_MIN && ppi <= PPI_MAX) {
          this.onPPI(ppi);
        }
      }

      this.lastPeakTimestamp = peakTimestamp;
    }
  }

  /** Peak-to-peak swing of the filtered signal over the recent window. */
  getFilteredAmplitude(): number {
    if (this.recent.length < 2) return 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of this.recent) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  }

  /** Number of consecutive peaks detected since last reset. */
  getConsecutivePeakCount(): number {
    return this.peakCount;
  }

  /** Reset all internal state. */
  reset(): void {
    this.filter.reset();
    this.detector.reset();
    this.peakCount = 0;
    this.lastPeakTimestamp = null;
    this.recent.length = 0;
  }
}
