/**
 * Baseline learning service — accumulates torus features over 5 minutes of
 * observed rhythm (and at least 200 beats) to establish a personal baseline.
 *
 * Uses FIXED normalization (PPI_MIN/PPI_MAX) for features per the dual-normalization rule.
 * Baseline is FROZEN once established — new data does not update it.
 *
 * LEARNING SURVIVES RESTARTS. Progress used to live only in this object, so
 * it was discarded every time the app closed: ten 2-minute sessions totalling
 * 1,500 beats and 20 minutes of rhythm established nothing, and a user who
 * only ever monitors briefly never got change detection at all. Partial
 * progress is now persisted alongside the baseline and reloaded on the next
 * launch, so the 200-beat and 5-minute rules accumulate across sessions.
 *
 * The 5-minute rule counts OBSERVED rhythm, not wall clock: intervals longer
 * than a dropout gap are not credited, which is also what makes the rule
 * accumulate correctly across sessions (the time between them is not rhythm
 * anyone observed).
 *
 * Per SPEC Section 3.1.
 */
import type { PersonalBaseline } from '../../shared/types';
import type { StorageAdapter } from '../session/session-store';
import {
  BASELINE_MIN_BEATS, BASELINE_DURATION, SIGNAL_GAP_MS,
} from '../../shared/constants';
import { mean, std } from '../../shared/torus-engine';

export const BASELINE_KEY = 'personal_baseline';
/** Partial learning progress, kept only until a baseline is established. */
export const BASELINE_PROGRESS_KEY = 'personal_baseline_progress';

/**
 * Feature samples retained while learning. A baseline needs ~35, and any
 * user who keeps learning past this is stuck (e.g. sessions too short to
 * ever close a feature window), so the cap only bounds a pathological case.
 */
const MAX_LEARNING_SAMPLES = 600;

/** Persist progress every N samples — roughly every 40 seconds of wear. */
const PROGRESS_SAVE_INTERVAL = 5;

/** Shape written to BASELINE_PROGRESS_KEY. */
interface BaselineProgress {
  version: 1;
  rawBeats: number;
  observedMs: number;
  kappaValues: number[];
  giniValues: number[];
  spreadValues: number[];
  bpmValues: number[];
}

export class BaselineService {
  private storage: StorageAdapter;

  // Accumulation buffers during learning
  private kappaValues: number[] = [];
  private giniValues: number[] = [];
  private spreadValues: number[] = [];
  private bpmValues: number[] = [];
  private totalSamples = 0;
  /** Raw beat count — tracks actual PPIs received, not feature windows. */
  private rawBeats = 0;
  /** Rhythm actually observed, summed beat to beat and across sessions. */
  private observedMs = 0;
  /** Timestamp of the previous beat, for crediting observed time. */
  private lastBeatAt: number | null = null;

  // Established baseline (frozen once set)
  private baseline: PersonalBaseline | null = null;
  private frozen = false;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /**
   * Load baseline from persistent storage. Call on app start.
   *
   * With no baseline yet, partial learning progress is restored instead, so
   * this session continues counting toward the thresholds where the last one
   * left off rather than starting from zero.
   */
  async load(): Promise<PersonalBaseline | null> {
    const raw = await this.storage.getItem(BASELINE_KEY);
    if (raw) {
      try {
        this.baseline = JSON.parse(raw) as PersonalBaseline;
        this.frozen = true;
        return this.baseline;
      } catch {
        // Fall through: a corrupt baseline means we are still learning.
      }
    }
    await this.loadProgress();
    return null;
  }

  /** Restore partial learning progress written by an earlier session. */
  private async loadProgress(): Promise<void> {
    const raw = await this.storage.getItem(BASELINE_PROGRESS_KEY);
    if (!raw) return;
    try {
      const p = JSON.parse(raw) as BaselineProgress;
      if (p.version !== 1) return;
      if (!Array.isArray(p.kappaValues) || !Number.isFinite(p.rawBeats)) return;
      this.rawBeats = p.rawBeats;
      this.observedMs = Number.isFinite(p.observedMs) ? p.observedMs : 0;
      this.kappaValues = p.kappaValues;
      this.giniValues = p.giniValues ?? [];
      this.spreadValues = p.spreadValues ?? [];
      this.bpmValues = p.bpmValues ?? [];
      this.totalSamples = this.kappaValues.length;
      // A new session's first beat has no predecessor to measure against.
      this.lastBeatAt = null;
    } catch {
      // Unreadable progress is simply progress lost — start this one fresh.
    }
  }

  /**
   * Write partial learning progress. Called automatically while learning;
   * call it directly to flush before the app leaves the foreground.
   */
  async saveProgress(): Promise<void> {
    if (this.frozen) return;
    const progress: BaselineProgress = {
      version: 1,
      rawBeats: this.rawBeats,
      observedMs: this.observedMs,
      kappaValues: this.kappaValues,
      giniValues: this.giniValues,
      spreadValues: this.spreadValues,
      bpmValues: this.bpmValues,
    };
    try {
      await this.storage.setItem(BASELINE_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Storage full or unavailable — learning continues in memory.
    }
  }

  /** Get the current baseline (null if not yet established). */
  getBaseline(): PersonalBaseline | null {
    return this.baseline;
  }

  /** Whether the baseline is currently being learned. */
  isLearning(): boolean {
    return !this.frozen;
  }

  /**
   * Learning progress as a fraction 0-1 — the further of the two rules from
   * being satisfied, so the bar reflects whichever the user is actually
   * waiting on. Reporting beats alone pinned it at 100% for the last ~2
   * minutes of every baseline, since 200 beats arrive well before 5 minutes
   * of rhythm do.
   */
  getLearningProgress(): number {
    if (this.frozen) return 1;
    return Math.min(
      1,
      this.rawBeats / BASELINE_MIN_BEATS,
      this.observedMs / 1000 / BASELINE_DURATION,
    );
  }

  /** Raw beat count accumulated during learning. */
  getSampleCount(): number {
    return this.rawBeats;
  }

  /** Rhythm observed so far toward the 5-minute rule, in ms. */
  getObservedMs(): number {
    return this.observedMs;
  }

  /**
   * Record a raw beat (call every PPI, not just every feature window).
   * `now` is injectable so session replay can drive time from recorded
   * timestamps instead of the wall clock.
   *
   * Observed time accrues one inter-beat interval at a time. Anything longer
   * than a dropout gap is not rhythm anyone observed, so it is not credited —
   * which covers sensor dropouts and the days between sessions alike.
   */
  countBeat(now: number = Date.now()): void {
    if (this.frozen) return;
    if (this.lastBeatAt !== null) {
      const dt = now - this.lastBeatAt;
      if (dt > 0 && dt <= SIGNAL_GAP_MS) this.observedMs += dt;
    }
    this.lastBeatAt = now;
    this.rawBeats++;
  }

  /**
   * Exclude a dropout interval from the baseline duration requirement.
   *
   * The 5-minute rule is meant to span 5 minutes of OBSERVED rhythm. When
   * elapsed time was measured against a fixed start, a long dropout satisfied
   * it outright — one beat, a 10-minute gap, then 200 quick beats froze a
   * "personal baseline" built from ~16 seconds of data, which then became the
   * denominator for every subsequent Mahalanobis distance.
   *
   * Accumulating observed time makes that structural, so this is now a
   * belt-and-braces break in beat continuity: the pipeline calls it on a
   * detected gap, and the next beat starts a fresh interval either way.
   */
  skipDeadTime(gapMs: number): void {
    if (this.frozen || gapMs <= 0) return;
    this.lastBeatAt = null;
  }

  /**
   * Feed a feature sample into the baseline learner.
   * Called every DANCE_UPDATE_INTERVAL beats with the current features.
   * Returns true if baseline was just established on this call.
   */
  addSample(kappa: number, gini: number, spread: number, bpm: number, now: number = Date.now()): boolean {
    if (this.frozen) return false;

    if (this.kappaValues.length < MAX_LEARNING_SAMPLES) {
      this.kappaValues.push(kappa);
      this.giniValues.push(gini);
      this.spreadValues.push(spread);
      this.bpmValues.push(bpm);
    }
    this.totalSamples++;

    // Thresholds use raw beats and OBSERVED time, both of which carry over
    // from previous sessions.
    const meetsBeats = this.rawBeats >= BASELINE_MIN_BEATS;
    const meetsDuration = this.observedMs / 1000 >= BASELINE_DURATION;

    if (meetsBeats && meetsDuration) {
      this.establish(now);
      return true;
    }

    // Checkpoint periodically so an app that is closed (or killed) mid-window
    // resumes from roughly here instead of from zero.
    if (this.totalSamples % PROGRESS_SAVE_INTERVAL === 0) {
      void this.saveProgress();
    }

    return false;
  }

  /** Establish the baseline from accumulated samples and freeze it. */
  private establish(now: number = Date.now()): void {
    this.baseline = {
      kappaMean: mean(this.kappaValues),
      kappaSd: std(this.kappaValues),
      giniMean: mean(this.giniValues),
      giniSd: std(this.giniValues),
      spreadMean: mean(this.spreadValues),
      spreadSd: std(this.spreadValues),
      bpmMean: Math.round(mean(this.bpmValues)),
      recordedAt: now,
      beatCount: this.rawBeats,
    };
    this.frozen = true;
  }

  /** Persist the current baseline to storage, retiring the progress record. */
  async save(): Promise<void> {
    if (this.baseline) {
      await this.storage.setItem(BASELINE_KEY, JSON.stringify(this.baseline));
      await this.storage.setItem(BASELINE_PROGRESS_KEY, '');
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
    this.totalSamples = 0;
    this.rawBeats = 0;
    this.observedMs = 0;
    this.lastBeatAt = null;
    await this.storage.setItem(BASELINE_KEY, '');
    // Partial progress must go too, or "start over" silently resumes from
    // the discarded baseline's learning data.
    await this.storage.setItem(BASELINE_PROGRESS_KEY, '');
  }

  /**
   * Force-establish the baseline (for testing — skips duration check).
   * Requires at least BASELINE_MIN_BEATS samples.
   */
  forceEstablish(): boolean {
    // BOTH conditions are required. With `&&`, 200 raw beats alone sufficed
    // even with zero feature samples, so establish() averaged empty arrays and
    // froze an all-zero baseline — every later distance then divided by the
    // SD floor against a zero mean and pinned the UI to a permanent alert.
    if (this.rawBeats < BASELINE_MIN_BEATS || this.totalSamples < 2) return false;
    this.establish();
    return true;
  }
}
