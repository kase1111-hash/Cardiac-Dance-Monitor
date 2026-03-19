/**
 * PPG processor — combines Butterworth bandpass + peak detection.
 *
 * Pipeline: raw red channel → bandpass filter → peak detection → PPI output.
 * Per SPEC Section 1.4.
 */
import { ButterworthBandpass } from './butterworth-filter';
import { PeakDetector } from './peak-detector';
import { PPI_MIN } from '../../shared/constants';

const PPG_LOW_CUTOFF = 0.5;  // Hz (30 BPM lower bound)
const PPG_HIGH_CUTOFF = 4.0; // Hz (240 BPM upper bound)

export class PPGProcessor {
  private filter: ButterworthBandpass;
  private detector: PeakDetector;
  private peakCount = 0;
  private lastPeakTimestamp: number | null = null;

  /** Called when a valid PPI is extracted. */
  onPPI: ((ppiMs: number) => void) | null = null;

  /**
   * @param sampleRate - Camera frame rate in Hz (typically 30)
   */
  constructor(sampleRate: number = 30) {
    this.filter = new ButterworthBandpass(PPG_LOW_CUTOFF, PPG_HIGH_CUTOFF, sampleRate);
    this.detector = new PeakDetector(PPI_MIN); // 300ms minimum
  }

  /**
   * Process one camera frame's red channel mean intensity.
   *
   * @param redMean - Mean red channel intensity (0-255)
   * @param timestampMs - Frame timestamp in milliseconds
   */
  processFrame(redMean: number, timestampMs: number): void {
    const filtered = this.filter.process(redMean);
    const peakTimestamp = this.detector.process(filtered, timestampMs);

    if (peakTimestamp !== null) {
      this.peakCount++;

      if (this.lastPeakTimestamp !== null) {
        const ppi = peakTimestamp - this.lastPeakTimestamp;
        if (this.onPPI) {
          this.onPPI(ppi);
        }
      }

      this.lastPeakTimestamp = peakTimestamp;
    }
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
  }
}
