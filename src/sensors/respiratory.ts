/**
 * Respiratory signal extraction from chest accelerometer Z-axis.
 *
 * When a phone lies flat on a supine user's chest, the Z-axis accelerometer
 * captures chest rise/fall from breathing. This module extracts breath rate
 * and inter-breath intervals using simple signal processing:
 *
 * 1. Bandpass via moving average subtraction (keep 0.1-0.5 Hz = 6-30 bpm)
 * 2. Peak detection with minimum 2-second spacing
 * 3. IBI (inter-breath interval) from successive peaks
 */

import type { AccelSample } from './chest-accel';

// Moving average window: 4 seconds at 25 Hz = 100 samples
const MA_WINDOW = 100;

// Minimum spacing between breaths: 2 seconds at 25 Hz = 50 samples
const MIN_PEAK_SPACING_SAMPLES = 50;
const MIN_PEAK_SPACING_MS = 2000;

// Maximum expected breath period: 10 seconds (6 breaths/min)
const MAX_BREATH_PERIOD_MS = 10000;

export interface BreathPeak {
  timestamp: number;  // ms
  index: number;      // index in filtered signal
  amplitude: number;  // filtered Z value at peak
}

/**
 * Apply bandpass filter to Z-axis data via moving average subtraction.
 * breath_signal = z - movingAvg(z, 4sec)
 * This removes DC offset and slow drift while keeping breath frequencies.
 *
 * @param samples - raw accelerometer samples
 * @returns filtered Z-axis values aligned with input samples
 */
export function bandpassZ(samples: readonly AccelSample[]): number[] {
  const len = samples.length;
  if (len === 0) return [];

  const zValues = samples.map(s => s.z);
  const filtered: number[] = new Array(len);

  for (let i = 0; i < len; i++) {
    // Compute moving average centered on i
    const halfWin = Math.floor(MA_WINDOW / 2);
    const start = Math.max(0, i - halfWin);
    const end = Math.min(len, i + halfWin + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += zValues[j];
    }
    const avg = sum / (end - start);
    filtered[i] = zValues[i] - avg;
  }

  return filtered;
}

/**
 * Detect breath peaks in filtered Z-axis signal.
 * Uses local maxima detection with minimum 2-second spacing.
 *
 * @param filtered - bandpass-filtered Z values
 * @param samples - original samples (for timestamps)
 * @returns array of detected breath peaks
 */
export function detectBreathPeaks(
  filtered: number[],
  samples: readonly AccelSample[],
): BreathPeak[] {
  const peaks: BreathPeak[] = [];
  if (filtered.length < 3) return peaks;

  for (let i = 1; i < filtered.length - 1; i++) {
    // Local maximum: higher than both neighbors
    if (filtered[i] > filtered[i - 1] && filtered[i] > filtered[i + 1]) {
      // Check minimum spacing from last peak
      if (peaks.length > 0) {
        const lastPeak = peaks[peaks.length - 1];
        const timeSinceLast = samples[i].timestamp - lastPeak.timestamp;
        if (timeSinceLast < MIN_PEAK_SPACING_MS) continue;
      }

      // Require minimum amplitude (reject noise near zero)
      if (Math.abs(filtered[i]) < 0.001) continue;

      peaks.push({
        timestamp: samples[i].timestamp,
        index: i,
        amplitude: filtered[i],
      });
    }
  }

  return peaks;
}

/**
 * Compute inter-breath intervals from breath peaks.
 * @returns array of IBIs in milliseconds
 */
export function computeIBIs(peaks: BreathPeak[]): number[] {
  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ibi = peaks[i].timestamp - peaks[i - 1].timestamp;
    if (ibi > 0 && ibi <= MAX_BREATH_PERIOD_MS) {
      ibis.push(ibi);
    }
  }
  return ibis;
}

/**
 * Compute current breath rate from accelerometer buffer.
 *
 * @param accelBuffer - raw accelerometer samples
 * @returns breath rate in breaths/min, or null if insufficient data
 */
export function getBreathRate(accelBuffer: readonly AccelSample[]): number | null {
  if (accelBuffer.length < MA_WINDOW) return null;

  // Use last 30 seconds of data for stable rate
  const windowMs = 30000;
  const now = accelBuffer[accelBuffer.length - 1].timestamp;
  const windowStart = now - windowMs;
  const recent = accelBuffer.filter(s => s.timestamp >= windowStart);

  if (recent.length < MA_WINDOW) return null;

  const filtered = bandpassZ(recent);
  const peaks = detectBreathPeaks(filtered, recent);

  if (peaks.length < 2) return null;

  const ibis = computeIBIs(peaks);
  if (ibis.length === 0) return null;

  // Mean IBI → breaths per minute
  const meanIBI = ibis.reduce((a, b) => a + b, 0) / ibis.length;
  const breathsPerMin = 60000 / meanIBI;

  // Sanity check: 4-40 breaths/min
  if (breathsPerMin < 4 || breathsPerMin > 40) return null;

  return Math.round(breathsPerMin * 10) / 10;
}

/**
 * Get the latest inter-breath interval in milliseconds.
 *
 * @param accelBuffer - raw accelerometer samples
 * @returns latest IBI in ms, or null if not enough peaks
 */
export function getLatestIBI(accelBuffer: readonly AccelSample[]): number | null {
  if (accelBuffer.length < MA_WINDOW) return null;

  // Use last 30 seconds
  const windowMs = 30000;
  const now = accelBuffer[accelBuffer.length - 1].timestamp;
  const recent = accelBuffer.filter(s => s.timestamp >= windowStart(now, windowMs));

  const filtered = bandpassZ(recent);
  const peaks = detectBreathPeaks(filtered, recent);
  const ibis = computeIBIs(peaks);

  return ibis.length > 0 ? ibis[ibis.length - 1] : null;
}

function windowStart(now: number, windowMs: number): number {
  return now - windowMs;
}

/**
 * Get filtered Z-axis signal for display (last N seconds).
 *
 * @param accelBuffer - raw accelerometer samples
 * @param durationMs - how many ms of data to return (default 20000 = 20s)
 * @returns array of {timestamp, value} for rendering
 */
export function getFilteredZForDisplay(
  accelBuffer: readonly AccelSample[],
  durationMs: number = 20000,
): { timestamp: number; value: number }[] {
  if (accelBuffer.length < 10) return [];

  const now = accelBuffer[accelBuffer.length - 1].timestamp;
  const start = now - durationMs;
  const recent = accelBuffer.filter(s => s.timestamp >= start);

  if (recent.length < 10) return [];

  const filtered = bandpassZ(recent);
  return recent.map((s, i) => ({
    timestamp: s.timestamp,
    value: filtered[i],
  }));
}
