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
 * NAMESPACES. A baseline describes one rhythm source. A simulated rhythm and
 * a real person are different subjects, so their baselines are stored under
 * different keys and switching source no longer wipes anything: the
 * `simulated` namespace suffixes the keys, while the `sensor` namespace uses
 * the original un-suffixed keys so a real baseline learned by an earlier
 * build is still found.
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

/** Namespace whose keys are the legacy un-suffixed ones. */
export const DEFAULT_BASELINE_NAMESPACE = 'sensor';

/**
 * Feature windows a forced baseline needs. Two windows produced SDs so tiny
 * that an UNCHANGED rhythm read as 20-46% false alerts; ten windows measured
 * 3.8% transient notices and zero false alerts, and 200 beats always supply
 * at least 16 windows anyway. This floor only matters if the raw-beat rule
 * is ever relaxed.
 */
export const FORCE_ESTABLISH_MIN_SAMPLES = 10;

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

export interface BaselineServiceOptions {
  /** Storage namespace; see the module comment. Defaults to the legacy keys. */
  namespace?: string;
}

function isUsableBaseline(value: unknown): value is PersonalBaseline {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  const numeric = [
    'kappaMean', 'kappaSd', 'giniMean', 'giniSd', 'spreadMean', 'spreadSd',
    'bpmMean', 'recordedAt', 'beatCount',
  ];
  return numeric.every(k => typeof b[k] === 'number' && Number.isFinite(b[k] as number));
}

export class BaselineService {
  private storage: StorageAdapter;
  private namespace: string;

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
  private loaded = false;

  constructor(storage: StorageAdapter, options: BaselineServiceOptions = {}) {
    this.storage = storage;
    this.namespace = options.namespace ?? DEFAULT_BASELINE_NAMESPACE;
  }

  /** Storage namespace currently in use. */
  getNamespace(): string {
    return this.namespace;
  }

  private key(base: string): string {
    return this.namespace === DEFAULT_BASELINE_NAMESPACE ? base : `${base}:${this.namespace}`;
  }

  /**
   * Load baseline from persistent storage. Call on app start.
   *
   * With no baseline yet, partial learning progress is restored instead, so
   * this session continues counting toward the thresholds where the last one
   * left off rather than starting from zero.
   */
  async load(): Promise<PersonalBaseline | null> {
    this.loaded = true;
    let raw: string | null = null;
    try {
      raw = await this.storage.getItem(this.key(BASELINE_KEY));
    } catch {
      // Unreadable storage: behave as if nothing was stored.
    }
    if (raw) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // fall through
      }
      if (isUsableBaseline(parsed)) {
        this.baseline = parsed;
        this.frozen = true;
        return this.baseline;
      }
      // A truncated or hand-edited record used to be accepted as-is and froze
      // a baseline of NaNs — every distance was then NaN, which fails both
      // threshold checks and pinned the UI to 'notice' forever.
      console.warn('BASELINE: stored baseline is unusable — discarding');
      try {
        await this.storage.setItem(this.key(BASELINE_KEY), '');
      } catch {
        // ignore
      }
    }
    await this.loadProgress();
    return null;
  }

  /**
   * Point the service at another namespace and load whatever is stored
   * there. In-progress learning for the previous namespace is checkpointed
   * first. A no-op (returning the current baseline) when the namespace is
   * unchanged and already loaded.
   */
  async activateNamespace(namespace: string): Promise<PersonalBaseline | null> {
    if (namespace === this.namespace) {
      return this.loaded ? this.baseline : this.load();
    }
    await this.saveProgress();
    this.clearMemory();
    this.namespace = namespace;
    return this.load();
  }

  /** Restore partial learning progress written by an earlier session. */
  private async loadProgress(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await this.storage.getItem(this.key(BASELINE_PROGRESS_KEY));
    } catch {
      return;
    }
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
      await this.storage.setItem(this.key(BASELINE_PROGRESS_KEY), JSON.stringify(progress));
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

  /**
   * Beats behind the baseline: the raw count accumulated while learning, or
   * the count the established baseline was built from. A baseline restored
   * from storage previously reported 0 here (rawBeats is not persisted), so
   * every relaunch read "Baseline: 3m ago (0 samples)".
   */
  getSampleCount(): number {
    if (this.frozen && this.baseline) return this.baseline.beatCount;
    return this.rawBeats;
  }

  /** Feature windows collected while learning. */
  getFeatureSampleCount(): number {
    return this.totalSamples;
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

  /**
   * Persist the current baseline to storage, retiring the progress record.
   * Returns false when the write failed (storage full); the baseline stays
   * in memory for this session either way.
   */
  async save(): Promise<boolean> {
    if (!this.baseline) return false;
    try {
      await this.storage.setItem(this.key(BASELINE_KEY), JSON.stringify(this.baseline));
      await this.storage.setItem(this.key(BASELINE_PROGRESS_KEY), '');
      return true;
    } catch (e: any) {
      console.warn('BASELINE_SAVE_FAILED:', e?.message ?? e);
      return false;
    }
  }

  private clearMemory(): void {
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
    this.loaded = false;
  }

  /** Reset baseline — clears stored data and re-enters learning mode. */
  async reset(): Promise<void> {
    this.clearMemory();
    this.loaded = true;
    try {
      await this.storage.setItem(this.key(BASELINE_KEY), '');
      // Partial progress must go too, or "start over" silently resumes from
      // the discarded baseline's learning data.
      await this.storage.setItem(this.key(BASELINE_PROGRESS_KEY), '');
    } catch (e: any) {
      console.warn('BASELINE_RESET_WRITE_FAILED:', e?.message ?? e);
    }
  }

  /**
   * Force-establish the baseline (demo/testing — skips the 5-minute rule).
   * Requires BASELINE_MIN_BEATS raw beats and FORCE_ESTABLISH_MIN_SAMPLES
   * feature windows.
   */
  forceEstablish(): boolean {
    // BOTH conditions are required. With `&&`, 200 raw beats alone sufficed
    // even with zero feature samples, so establish() averaged empty arrays and
    // froze an all-zero baseline — every later distance then divided by the
    // SD floor against a zero mean and pinned the UI to a permanent alert.
    if (this.rawBeats < BASELINE_MIN_BEATS || this.totalSamples < FORCE_ESTABLISH_MIN_SAMPLES) {
      return false;
    }
    this.establish();
    return true;
  }
}
