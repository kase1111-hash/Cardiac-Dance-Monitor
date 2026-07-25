/**
 * Peak detector for filtered PPG signal — SPEC Section 1.4.
 *
 * Detects positive peaks with a minimum inter-peak interval constraint.
 * Uses simple 3-point peak detection (previous < current > next pattern),
 * refined to sub-sample resolution by parabolic interpolation.
 *
 * Why interpolate: at 30 fps a peak snapped to the nearest frame quantizes
 * intervals to a 33.3ms grid, which injects a floor of ~13.6ms of artificial
 * beat-to-beat variability (uniform quantization, sigma = 33.3/sqrt(6)) into
 * a signal that may have none. That is enough to change the answer — a
 * realistic CHF rhythm (750ms +/-1.5%) measured kappa=20.6 / Gini=0.271
 * exactly but kappa=8.1 / Gini=0.000 when frame-quantized, flipping
 * "The Lock-Step" to "The Waltz". Fitting a parabola through the three
 * samples around the peak recovers the true vertex time between frames.
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
      const peakTime = this.interpolatePeakTime(
        this.prev, this.current, incoming,
      );
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

  /**
   * Sub-sample peak time by fitting a parabola through the three samples
   * bracketing the maximum.
   *
   * For a uniformly sampled max at y2 with neighbours y1, y3 the vertex sits
   * at offset d = 0.5*(y1 - y3) / (y1 - 2*y2 + y3) samples from y2, with
   * |d| <= 0.5 for a genuine interior maximum. Falls back to the raw sample
   * timestamp if the curvature is degenerate or the offset is implausible.
   */
  private interpolatePeakTime(
    p1: { value: number; timestamp: number },
    p2: { value: number; timestamp: number },
    p3: { value: number; timestamp: number },
  ): number {
    const denom = p1.value - 2 * p2.value + p3.value;
    if (Math.abs(denom) < 1e-12) return p2.timestamp;

    const offsetSamples = (0.5 * (p1.value - p3.value)) / denom;
    if (!Number.isFinite(offsetSamples) || Math.abs(offsetSamples) > 0.5) {
      return p2.timestamp;
    }

    // Local sample spacing, averaged so frame-timestamp jitter doesn't skew it.
    const dt = (p3.timestamp - p1.timestamp) / 2;
    return p2.timestamp + offsetSamples * dt;
  }

  /** Reset detector state. */
  reset(): void {
    this.prev = null;
    this.current = null;
    this.lastPeakTimestamp = null;
  }
}
