/**
 * Dance transition tracker — hysteresis per SPEC Section 2.6.
 *
 * Rules:
 * - If newDance !== currentDance and sustained < 20s: transient (display briefly, don't commit)
 * - If newDance !== currentDance and sustained ≥ 30s: commit transition, log it
 * - If original dance returns before 20s: clear transient, no transition
 */

const TRANSIENT_THRESHOLD_MS = 20_000;  // 20 seconds
const COMMIT_THRESHOLD_MS = 30_000;     // 30 seconds

export interface TransitionEvent {
  from: string;
  to: string;
  timestamp: number;
}

export class TransitionTracker {
  private currentDance: string | null = null;
  private transientDance: string | null = null;
  private transientStartTime: number | null = null;
  private transitions: TransitionEvent[] = [];

  /**
   * Update with the latest dance match result.
   *
   * @param danceName - Current dance identification
   * @param now - Timestamp in ms
   */
  update(danceName: string, now: number): void {
    // First dance ever — adopt immediately
    if (this.currentDance === null) {
      this.currentDance = danceName;
      return;
    }

    // Same as committed dance — clear any transient
    if (danceName === this.currentDance) {
      this.transientDance = null;
      this.transientStartTime = null;
      return;
    }

    // Different dance detected
    if (this.transientDance === danceName) {
      // Continuation of existing transient — check duration
      const elapsed = now - this.transientStartTime!;
      if (elapsed >= COMMIT_THRESHOLD_MS) {
        // Commit the transition
        this.transitions.push({
          from: this.currentDance,
          to: danceName,
          timestamp: now,
        });
        this.currentDance = danceName;
        this.transientDance = null;
        this.transientStartTime = null;
      }
      // Otherwise stay transient
    } else {
      // New transient dance (different from both current and previous transient)
      this.transientDance = danceName;
      this.transientStartTime = now;
    }
  }

  /** Get the committed current dance. */
  getCurrentDance(): string | null {
    return this.currentDance;
  }

  /** Get the transient (uncommitted) dance, or null if none. */
  getTransientDance(): string | null {
    return this.transientDance;
  }

  /** Get all logged transitions. */
  getTransitions(): TransitionEvent[] {
    return [...this.transitions];
  }

  /** Reset all state. */
  reset(): void {
    this.currentDance = null;
    this.transientDance = null;
    this.transientStartTime = null;
    this.transitions = [];
  }
}
