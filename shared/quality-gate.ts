/**
 * Quality gate — validates incoming PPI values against range and deviation thresholds.
 * Tracks acceptance rate over a sliding window of 30 beats.
 *
 * Source: SPEC.md Section 1.3
 */
import {
  PPI_MIN,
  PPI_MAX,
  PPI_DEVIATION_MAX,
  QUALITY_GOOD,
  QUALITY_FAIR,
} from './constants';

export class QualityGate {
  /** Last 15 valid PPIs for running median (insertion-sorted) */
  private medianBuffer: number[] = [];
  private readonly medianSize = 15;

  /** Last 30 acceptance results for quality tracking */
  private acceptanceWindow: boolean[] = [];
  private readonly windowSize = 30;

  /**
   * Check a PPI value. Returns true if accepted, false if rejected.
   */
  check(ppi: number): boolean {
    // Range check
    if (ppi < PPI_MIN || ppi > PPI_MAX) {
      this.recordResult(false);
      return false;
    }

    // Deviation check (skip if no median established yet)
    if (this.medianBuffer.length > 0) {
      const med = this.getRunningMedian();
      if (Math.abs(ppi - med) > PPI_DEVIATION_MAX * med) {
        this.recordResult(false);
        return false;
      }
    }

    // Accepted — update median buffer
    this.insertSorted(ppi);
    this.recordResult(true);
    return true;
  }

  /**
   * Returns the running median of the last 15 valid PPIs.
   */
  getRunningMedian(): number {
    if (this.medianBuffer.length === 0) return 0;
    const mid = Math.floor(this.medianBuffer.length / 2);
    if (this.medianBuffer.length % 2 === 0) {
      return (this.medianBuffer[mid - 1] + this.medianBuffer[mid]) / 2;
    }
    return this.medianBuffer[mid];
  }

  /**
   * Returns the acceptance rate over the last 30 beats (0-1).
   */
  getAcceptanceRate(): number {
    if (this.acceptanceWindow.length === 0) return 1;
    const accepted = this.acceptanceWindow.filter(v => v).length;
    return accepted / this.acceptanceWindow.length;
  }

  /**
   * Returns the quality level based on acceptance rate.
   */
  getQualityLevel(): 'good' | 'fair' | 'poor' {
    const rate = this.getAcceptanceRate();
    if (rate >= QUALITY_GOOD) return 'good';
    if (rate >= QUALITY_FAIR) return 'fair';
    return 'poor';
  }

  /** Insert a value into the sorted median buffer, maintaining max size. */
  private insertSorted(value: number): void {
    // Find insertion point (binary search on small array)
    let i = 0;
    while (i < this.medianBuffer.length && this.medianBuffer[i] < value) i++;
    this.medianBuffer.splice(i, 0, value);

    // Trim to max size (remove oldest conceptually, but since sorted, remove from end)
    if (this.medianBuffer.length > this.medianSize) {
      this.medianBuffer.shift();
    }
  }

  /** Record an acceptance/rejection result in the sliding window. */
  private recordResult(accepted: boolean): void {
    this.acceptanceWindow.push(accepted);
    if (this.acceptanceWindow.length > this.windowSize) {
      this.acceptanceWindow.shift();
    }
  }
}
