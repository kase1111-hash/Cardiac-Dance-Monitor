/**
 * Peak detector for filtered PPG signal — SPEC Section 1.4.
 *
 * Detects positive peaks with a minimum inter-peak interval constraint.
 * Uses simple 3-point peak detection (previous < current > next pattern).
 */

export class PeakDetector {
  private minIntervalMs: number;
  private lastPeakTimestamp: number | null = null;

  // 3-sample buffer for peak detection
  private prev: { value: number; timestamp: number } | null = null;
  private current: { value: number; timestamp: number } | null = null;

  /** Callback for when a PPI is computed (not used in process() return pattern). */
  onPeak: ((timestampMs: number) => void) | null = null;

  /**
   * @param minIntervalMs - Minimum ms between consecutive peaks (default 300)
   */
  constructor(minIntervalMs: number = 300) {
    this.minIntervalMs = minIntervalMs;
  }

  /**
   * Process a new filtered sample. Returns the peak timestamp if a peak is
   * detected at the previous sample, or null.
   */
  process(value: number, timestampMs: number): number | null {
    const incoming = { value, timestamp: timestampMs };

    if (this.prev === null) {
      this.prev = incoming;
      return null;
    }

    if (this.current === null) {
      this.current = incoming;
      return null;
    }

    // Check if `current` is a peak: prev < current > incoming
    const isPeak = this.current.value > this.prev.value &&
                   this.current.value > incoming.value &&
                   this.current.value > 0; // must be positive (above baseline)

    let result: number | null = null;

    if (isPeak) {
      const peakTime = this.current.timestamp;
      const intervalOk = this.lastPeakTimestamp === null ||
                         (peakTime - this.lastPeakTimestamp) >= this.minIntervalMs;

      if (intervalOk) {
        this.lastPeakTimestamp = peakTime;
        result = peakTime;
      }
    }

    // Shift window
    this.prev = this.current;
    this.current = incoming;

    return result;
  }

  /** Reset detector state. */
  reset(): void {
    this.prev = null;
    this.current = null;
    this.lastPeakTimestamp = null;
  }
}
