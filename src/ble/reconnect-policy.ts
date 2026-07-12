/**
 * Reconnect policy — exponential backoff schedule for BLE auto-reconnect.
 * Pure logic, no timers: the caller asks for the next delay and schedules
 * it itself, so the schedule is fully testable.
 */
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 16000;
export const RECONNECT_MAX_ATTEMPTS = 6;

export class ReconnectPolicy {
  private attempts = 0;

  constructor(
    private readonly baseDelayMs: number = RECONNECT_BASE_DELAY_MS,
    private readonly maxDelayMs: number = RECONNECT_MAX_DELAY_MS,
    private readonly maxAttempts: number = RECONNECT_MAX_ATTEMPTS,
  ) {}

  /**
   * Delay before the next reconnect attempt, doubling each call and capped
   * at maxDelayMs (1s, 2s, 4s, 8s, 16s, 16s by default). Returns null once
   * attempts are exhausted — the caller should give up and report
   * disconnected instead of retrying forever.
   */
  nextDelayMs(): number | null {
    if (this.attempts >= this.maxAttempts) return null;
    const delay = Math.min(this.baseDelayMs * 2 ** this.attempts, this.maxDelayMs);
    this.attempts++;
    return delay;
  }

  /** Attempts consumed so far (for logging/UI). */
  get attemptCount(): number {
    return this.attempts;
  }

  /** Call after a successful connection so the next dropout starts fresh. */
  reset(): void {
    this.attempts = 0;
  }
}
