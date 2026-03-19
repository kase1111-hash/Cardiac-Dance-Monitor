/**
 * Mahalanobis change detection — computes distance from current features to
 * personal baseline and determines change status level.
 *
 * Per SPEC Section 3.2-3.3.
 */
import type { PersonalBaseline, ChangeStatus } from '../../shared/types';
import {
  CHANGE_NOTICE_SIGMA, CHANGE_ALERT_SIGMA, CHANGE_ALERT_SUSTAIN,
} from '../../shared/constants';

/**
 * Computes the Mahalanobis distance from current torus features to the baseline.
 * Each dimension is normalized by the baseline standard deviation.
 *
 * Source: SPEC Section 3.2
 */
export function mahalanobisDistance(
  current: { kappa: number; gini: number; spread: number },
  baseline: PersonalBaseline,
): number {
  const dk = (current.kappa - baseline.kappaMean) / Math.max(baseline.kappaSd, 0.01);
  const dg = (current.gini - baseline.giniMean) / Math.max(baseline.giniSd, 0.001);
  const ds = (current.spread - baseline.spreadMean) / Math.max(baseline.spreadSd, 0.01);
  return Math.sqrt(dk * dk + dg * dg + ds * ds);
}

export type ChangeLevel = 'learning' | 'normal' | 'notice' | 'alert';

/**
 * Stateful change detector — tracks sustained deviation for alert escalation.
 */
export class ChangeDetector {
  private sustainedSince: number | null = null;
  private currentLevel: ChangeLevel = 'learning';

  /**
   * Update change status with current features and baseline.
   * Call every DANCE_UPDATE_INTERVAL beats.
   *
   * @param baseline - Personal baseline (null if not established)
   * @param current - Current feature values (from fixed normalization)
   * @param now - Current timestamp in ms (injectable for testing)
   */
  update(
    baseline: PersonalBaseline | null,
    current: { kappa: number; gini: number; spread: number } | null,
    now: number = Date.now(),
  ): ChangeStatus {
    if (!baseline || !current) {
      this.currentLevel = 'learning';
      return { mahalanobisDistance: 0, level: 'learning', sustainedSince: null };
    }

    const distance = mahalanobisDistance(current, baseline);

    if (distance < CHANGE_NOTICE_SIGMA) {
      // Normal — reset sustained tracking
      this.currentLevel = 'normal';
      this.sustainedSince = null;
      return { mahalanobisDistance: distance, level: 'normal', sustainedSince: null };
    }

    if (distance < CHANGE_ALERT_SIGMA) {
      // Notice — track when we first crossed
      if (this.sustainedSince === null) {
        this.sustainedSince = now;
      }
      this.currentLevel = 'notice';
      return { mahalanobisDistance: distance, level: 'notice', sustainedSince: this.sustainedSince };
    }

    // distance >= CHANGE_ALERT_SIGMA
    if (this.sustainedSince === null) {
      this.sustainedSince = now;
    }

    const sustainedMs = now - this.sustainedSince;
    if (sustainedMs >= CHANGE_ALERT_SUSTAIN * 1000) {
      this.currentLevel = 'alert';
      return { mahalanobisDistance: distance, level: 'alert', sustainedSince: this.sustainedSince };
    }

    // Above alert threshold but not sustained long enough
    this.currentLevel = 'notice';
    return { mahalanobisDistance: distance, level: 'notice', sustainedSince: this.sustainedSince };
  }

  /** Get the current change level. */
  getLevel(): ChangeLevel {
    return this.currentLevel;
  }

  /** Reset the detector state. */
  reset(): void {
    this.sustainedSince = null;
    this.currentLevel = 'learning';
  }
}
