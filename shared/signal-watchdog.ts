/**
 * Signal watchdog — tracks wall-clock continuity of the beat stream.
 *
 * A pulse sensor can stop delivering beats without any explicit disconnect
 * event (finger removed, BLE link stall, camera occlusion). The watchdog
 * answers two questions from beat timestamps alone:
 *   - beat(now): did a dropout gap just end? The caller must not pair this
 *     beat with the previous one (they are not consecutive heartbeats).
 *   - isStale(now): has the stream been silent long enough that the UI
 *     should stop presenting the last reading as live?
 */
import { SIGNAL_GAP_MS } from './constants';

export class SignalWatchdog {
  private lastBeatAt: number | null = null;

  constructor(private readonly gapThresholdMs: number = SIGNAL_GAP_MS) {}

  /**
   * Record a beat at wall-clock time `nowMs`.
   * Returns true if this beat ends a dropout gap — i.e. the silence since
   * the previous beat exceeded the threshold.
   */
  beat(nowMs: number): boolean {
    const endsGap =
      this.lastBeatAt !== null && nowMs - this.lastBeatAt > this.gapThresholdMs;
    this.lastBeatAt = nowMs;
    return endsGap;
  }

  /** True once the silence since the last beat exceeds the threshold. */
  isStale(nowMs: number): boolean {
    return this.lastBeatAt !== null && nowMs - this.lastBeatAt > this.gapThresholdMs;
  }

  /** Milliseconds since the last beat, or null before the first beat. */
  msSinceLastBeat(nowMs: number): number | null {
    return this.lastBeatAt === null ? null : nowMs - this.lastBeatAt;
  }

  reset(): void {
    this.lastBeatAt = null;
  }
}
