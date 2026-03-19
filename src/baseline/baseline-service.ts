/**
 * Baseline learning service — accumulates torus features during the first 5 minutes
 * (or 200 beats, whichever is longer) to establish a personal baseline.
 *
 * Uses FIXED normalization (PPI_MIN/PPI_MAX) for features per the dual-normalization rule.
 * Baseline is FROZEN once established — new data does not update it.
 *
 * Per SPEC Section 3.1.
 */
import type { PersonalBaseline } from '../../shared/types';
import type { StorageAdapter } from '../session/session-store';
import { BASELINE_MIN_BEATS, BASELINE_DURATION } from '../../shared/constants';
import { mean, std } from '../../shared/torus-engine';

const BASELINE_KEY = 'personal_baseline';

export class BaselineService {
  private storage: StorageAdapter;

  // Accumulation buffers during learning
  private kappaValues: number[] = [];
  private giniValues: number[] = [];
  private spreadValues: number[] = [];
  private bpmValues: number[] = [];
  private learningStartTime: number | null = null;
  private totalSamples = 0;

  // Established baseline (frozen once set)
  private baseline: PersonalBaseline | null = null;
  private frozen = false;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /** Load baseline from persistent storage. Call on app start. */
  async load(): Promise<PersonalBaseline | null> {
    const raw = await this.storage.getItem(BASELINE_KEY);
    if (raw) {
      try {
        this.baseline = JSON.parse(raw) as PersonalBaseline;
        this.frozen = true;
        return this.baseline;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Get the current baseline (null if not yet established). */
  getBaseline(): PersonalBaseline | null {
    return this.baseline;
  }

  /** Whether the baseline is currently being learned. */
  isLearning(): boolean {
    return !this.frozen;
  }

  /** Learning progress as a fraction 0-1. */
  getLearningProgress(): number {
    if (this.frozen) return 1;
    return Math.min(1, this.totalSamples / BASELINE_MIN_BEATS);
  }

  /** Total feature samples accumulated during learning. */
  getSampleCount(): number {
    return this.totalSamples;
  }

  /**
   * Feed a feature sample into the baseline learner.
   * Called every DANCE_UPDATE_INTERVAL beats with the current features.
   * Returns true if baseline was just established on this call.
   */
  addSample(kappa: number, gini: number, spread: number, bpm: number): boolean {
    if (this.frozen) return false;

    if (this.learningStartTime === null) {
      this.learningStartTime = Date.now();
    }

    this.kappaValues.push(kappa);
    this.giniValues.push(gini);
    this.spreadValues.push(spread);
    this.bpmValues.push(bpm);
    this.totalSamples++;

    // Check if we've met the threshold
    const elapsedMs = Date.now() - this.learningStartTime;
    const elapsedSeconds = elapsedMs / 1000;
    const meetsBeats = this.totalSamples >= BASELINE_MIN_BEATS;
    const meetsDuration = elapsedSeconds >= BASELINE_DURATION;

    if (meetsBeats && meetsDuration) {
      this.establish();
      return true;
    }

    return false;
  }

  /** Establish the baseline from accumulated samples and freeze it. */
  private establish(): void {
    this.baseline = {
      kappaMean: mean(this.kappaValues),
      kappaSd: std(this.kappaValues),
      giniMean: mean(this.giniValues),
      giniSd: std(this.giniValues),
      spreadMean: mean(this.spreadValues),
      spreadSd: std(this.spreadValues),
      bpmMean: Math.round(mean(this.bpmValues)),
      recordedAt: Date.now(),
      beatCount: this.totalSamples,
    };
    this.frozen = true;
  }

  /** Persist the current baseline to storage. */
  async save(): Promise<void> {
    if (this.baseline) {
      await this.storage.setItem(BASELINE_KEY, JSON.stringify(this.baseline));
    }
  }

  /** Reset baseline — clears stored data and re-enters learning mode. */
  async reset(): Promise<void> {
    this.baseline = null;
    this.frozen = false;
    this.kappaValues = [];
    this.giniValues = [];
    this.spreadValues = [];
    this.bpmValues = [];
    this.learningStartTime = null;
    this.totalSamples = 0;
    await this.storage.setItem(BASELINE_KEY, '');
  }

  /**
   * Force-establish the baseline (for testing — skips duration check).
   * Requires at least BASELINE_MIN_BEATS samples.
   */
  forceEstablish(): boolean {
    if (this.totalSamples < BASELINE_MIN_BEATS) return false;
    this.establish();
    return true;
  }
}
