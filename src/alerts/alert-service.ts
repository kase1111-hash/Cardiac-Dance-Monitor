/**
 * Alert service — manages change detection notifications with suppression.
 *
 * Per SPEC Section 5.1:
 * - Alert fires when change level = 'alert' (3σ sustained 60s)
 * - Vibrate 3x + non-blocking banner
 * - Suppression: 1 alert per 30-minute window
 * - Recovery toast when level drops from alert to normal
 */
import type { ChangeLevel } from '../baseline/change-detector';

const SUPPRESSION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export interface AlertEvent {
  type: 'alert' | 'recovery';
  timestamp: number;
  distance: number;
  currentDance: string;
  message: string;
}

export class AlertService {
  private lastAlertTimestamp: number | null = null;
  private previousLevel: ChangeLevel = 'learning';
  private pendingEvents: AlertEvent[] = [];

  /**
   * Process a change level update. Returns any alert events that should fire.
   *
   * @param level - Current change level
   * @param distance - Mahalanobis distance
   * @param currentDance - Current dance name
   * @param now - Current timestamp (injectable for testing)
   */
  processLevelChange(
    level: ChangeLevel,
    distance: number,
    currentDance: string,
    now: number = Date.now(),
  ): AlertEvent[] {
    const events: AlertEvent[] = [];

    // Alert fires when transitioning TO alert
    if (level === 'alert' && this.previousLevel !== 'alert') {
      if (this.canFireAlert(now)) {
        events.push({
          type: 'alert',
          timestamp: now,
          distance,
          currentDance,
          message: 'Your rhythm pattern has shifted from your usual pattern. Consider checking with your provider.',
        });
        this.lastAlertTimestamp = now;
      }
    }

    // Recovery when dropping from alert to normal
    if (level === 'normal' && this.previousLevel === 'alert') {
      events.push({
        type: 'recovery',
        timestamp: now,
        distance,
        currentDance,
        message: 'Rhythm returned to baseline pattern',
      });
    }

    this.previousLevel = level;
    return events;
  }

  /** Check if an alert can fire (not suppressed). */
  canFireAlert(now: number = Date.now()): boolean {
    if (this.lastAlertTimestamp === null) return true;
    return (now - this.lastAlertTimestamp) >= SUPPRESSION_WINDOW_MS;
  }

  /** Get the time until suppression expires (ms), or 0 if not suppressed. */
  getSuppressionRemainingMs(now: number = Date.now()): number {
    if (this.lastAlertTimestamp === null) return 0;
    const remaining = SUPPRESSION_WINDOW_MS - (now - this.lastAlertTimestamp);
    return Math.max(0, remaining);
  }

  /** Get the previous level. */
  getPreviousLevel(): ChangeLevel {
    return this.previousLevel;
  }

  /** Reset the alert service. */
  reset(): void {
    this.lastAlertTimestamp = null;
    this.previousLevel = 'learning';
    this.pendingEvents = [];
  }
}
