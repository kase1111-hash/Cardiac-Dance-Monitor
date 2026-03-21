/**
 * Chest accelerometer — captures phone accelerometer data for respiratory
 * tracking and motion artifact rejection.
 *
 * When the phone lies flat on a supine user's chest:
 * - Z-axis captures chest rise/fall (breathing)
 * - Magnitude variance detects motion artifacts
 *
 * Uses expo-sensors Accelerometer, loaded via try-catch for graceful
 * degradation when not available.
 */

// --- Safe module loading ---
let AccelerometerModule: any = null;
let accelLoadError: string | null = null;

try {
  AccelerometerModule = require('expo-sensors').Accelerometer;
} catch (e: any) {
  accelLoadError = e?.message || 'expo-sensors not available';
}

export interface AccelSample {
  timestamp: number;  // ms since epoch
  x: number;
  y: number;
  z: number;
  magnitude: number;  // sqrt(x² + y² + z²)
}

// Ring buffer: 120 seconds at 25 Hz = 3000 samples
const BUFFER_SIZE = 3000;
const SAMPLE_INTERVAL_MS = 40; // 25 Hz

let buffer: AccelSample[] = [];
let subscription: any = null;
let running = false;

/**
 * Start accelerometer collection at 25 Hz.
 * Returns false if expo-sensors is not available.
 */
export function startChestAccel(): boolean {
  if (!AccelerometerModule) {
    console.warn('ACCEL: not available —', accelLoadError);
    return false;
  }
  if (running) return true;

  AccelerometerModule.setUpdateInterval(SAMPLE_INTERVAL_MS);
  subscription = AccelerometerModule.addListener(
    (data: { x: number; y: number; z: number }) => {
      const mag = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
      const sample: AccelSample = {
        timestamp: Date.now(),
        x: data.x,
        y: data.y,
        z: data.z,
        magnitude: mag,
      };
      buffer.push(sample);
      if (buffer.length > BUFFER_SIZE) {
        buffer = buffer.slice(buffer.length - BUFFER_SIZE);
      }
    },
  );
  running = true;
  console.log('ACCEL: started at 25 Hz');
  return true;
}

/**
 * Stop accelerometer collection.
 */
export function stopChestAccel(): void {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  running = false;
  console.log('ACCEL: stopped');
}

/**
 * Clear the buffer (call on source change).
 */
export function clearAccelBuffer(): void {
  buffer = [];
}

/**
 * Get the full accelerometer buffer (read-only reference).
 */
export function getAccelBuffer(): readonly AccelSample[] {
  return buffer;
}

/**
 * Check if accelerometer is currently running.
 */
export function isAccelRunning(): boolean {
  return running;
}

/**
 * Check if expo-sensors Accelerometer is available.
 */
export function isAccelAvailable(): boolean {
  return AccelerometerModule !== null;
}

/**
 * Get the load error message if accelerometer is unavailable.
 */
export function getAccelLoadError(): string | null {
  return accelLoadError;
}

/**
 * Check if a beat's PPI window shows motion artifacts.
 * Looks at accelerometer magnitude variance during the beat interval.
 *
 * @param beatTimestamp - when the beat was detected (ms)
 * @param ppiMs - the PPI duration (how far back to look)
 * @param threshold - magnitude std deviation threshold (default 0.05g)
 * @returns true if motion artifact detected, false if clean or no data
 */
export function detectMotionArtifact(
  beatTimestamp: number,
  ppiMs: number,
  threshold: number = 0.05,
): boolean {
  if (buffer.length < 2) return false;

  const windowStart = beatTimestamp - ppiMs;
  const samples = buffer.filter(
    s => s.timestamp >= windowStart && s.timestamp <= beatTimestamp,
  );

  if (samples.length < 3) return false;

  // Compute mean magnitude
  let sum = 0;
  for (const s of samples) {
    sum += s.magnitude;
  }
  const mean = sum / samples.length;

  // Compute std deviation
  let sqDiffSum = 0;
  for (const s of samples) {
    const diff = s.magnitude - mean;
    sqDiffSum += diff * diff;
  }
  const stdDev = Math.sqrt(sqDiffSum / samples.length);

  return stdDev > threshold;
}
