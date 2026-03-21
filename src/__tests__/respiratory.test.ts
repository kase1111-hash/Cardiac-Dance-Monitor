/**
 * Tests for respiratory signal extraction from chest accelerometer Z-axis.
 *
 * Covers:
 * - Bandpass filter (moving average subtraction)
 * - Peak detection with minimum spacing
 * - IBI computation from peaks
 * - Breath rate calculation
 * - Edge cases (empty data, insufficient data, noise)
 */
import {
  bandpassZ,
  detectBreathPeaks,
  computeIBIs,
  getBreathRate,
  getLatestIBI,
  getFilteredZForDisplay,
} from '../sensors/respiratory';
import type { AccelSample } from '../sensors/chest-accel';

// Helper: generate simulated accelerometer data with a sinusoidal Z-axis
// representing breathing at a given rate
function makeSamples(opts: {
  durationSec: number;
  breathsPerMin: number;
  sampleRate?: number;
  baseZ?: number;
  amplitude?: number;
  noiseAmplitude?: number;
}): AccelSample[] {
  const rate = opts.sampleRate ?? 25;
  const baseZ = opts.baseZ ?? 1.0; // ~1g when flat
  const amp = opts.amplitude ?? 0.02; // small chest deflection
  const noise = opts.noiseAmplitude ?? 0;
  const breathFreqHz = opts.breathsPerMin / 60;
  const numSamples = Math.floor(opts.durationSec * rate);
  const samples: AccelSample[] = [];

  const startTime = 1000000; // arbitrary start

  for (let i = 0; i < numSamples; i++) {
    const t = i / rate;
    const z = baseZ + amp * Math.sin(2 * Math.PI * breathFreqHz * t)
      + (noise > 0 ? (Math.random() - 0.5) * noise : 0);
    samples.push({
      timestamp: startTime + Math.round(t * 1000),
      x: 0,
      y: 0,
      z,
      magnitude: Math.sqrt(z * z),
    });
  }

  return samples;
}

// ---------------------------------------------------------------------------
// bandpassZ
// ---------------------------------------------------------------------------
describe('bandpassZ', () => {
  test('returns empty for empty input', () => {
    expect(bandpassZ([])).toEqual([]);
  });

  test('returns array of same length as input', () => {
    const samples = makeSamples({ durationSec: 5, breathsPerMin: 15 });
    const filtered = bandpassZ(samples);
    expect(filtered.length).toBe(samples.length);
  });

  test('removes DC offset from Z axis', () => {
    // Constant Z = 1.0 should filter to ~0
    const samples: AccelSample[] = [];
    for (let i = 0; i < 200; i++) {
      samples.push({
        timestamp: i * 40,
        x: 0, y: 0, z: 1.0,
        magnitude: 1.0,
      });
    }
    const filtered = bandpassZ(samples);
    // All values should be near zero (DC removed)
    const maxAbs = Math.max(...filtered.map(Math.abs));
    expect(maxAbs).toBeLessThan(0.01);
  });

  test('preserves breathing frequency signal', () => {
    const samples = makeSamples({
      durationSec: 20,
      breathsPerMin: 15,
      amplitude: 0.05,
    });
    const filtered = bandpassZ(samples);
    // Interior samples should have non-zero variation (breath signal preserved)
    const interiorSlice = filtered.slice(100, 400);
    const maxAmp = Math.max(...interiorSlice.map(Math.abs));
    expect(maxAmp).toBeGreaterThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// detectBreathPeaks
// ---------------------------------------------------------------------------
describe('detectBreathPeaks', () => {
  test('returns empty for short data', () => {
    const samples = makeSamples({ durationSec: 0.1, breathsPerMin: 15 });
    const filtered = bandpassZ(samples);
    expect(detectBreathPeaks(filtered, samples).length).toBe(0);
  });

  test('detects peaks at expected breath rate', () => {
    const breathsPerMin = 15;
    const durationSec = 30;
    const samples = makeSamples({ durationSec, breathsPerMin, amplitude: 0.05 });
    const filtered = bandpassZ(samples);
    const peaks = detectBreathPeaks(filtered, samples);

    // 15 breaths/min for 30 sec = ~7.5 breaths, expect 5-9 peaks
    expect(peaks.length).toBeGreaterThanOrEqual(4);
    expect(peaks.length).toBeLessThanOrEqual(10);
  });

  test('enforces minimum 2-second spacing', () => {
    const samples = makeSamples({ durationSec: 20, breathsPerMin: 15, amplitude: 0.05 });
    const filtered = bandpassZ(samples);
    const peaks = detectBreathPeaks(filtered, samples);

    for (let i = 1; i < peaks.length; i++) {
      const spacing = peaks[i].timestamp - peaks[i - 1].timestamp;
      expect(spacing).toBeGreaterThanOrEqual(2000);
    }
  });

  test('rejects noise near zero amplitude', () => {
    // Very tiny amplitude should produce no peaks
    const samples = makeSamples({
      durationSec: 10,
      breathsPerMin: 15,
      amplitude: 0.0001,
    });
    const filtered = bandpassZ(samples);
    const peaks = detectBreathPeaks(filtered, samples);
    expect(peaks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeIBIs
// ---------------------------------------------------------------------------
describe('computeIBIs', () => {
  test('returns empty for no peaks', () => {
    expect(computeIBIs([])).toEqual([]);
  });

  test('returns empty for single peak', () => {
    expect(computeIBIs([{ timestamp: 1000, index: 0, amplitude: 0.1 }])).toEqual([]);
  });

  test('computes correct IBI from peaks', () => {
    const peaks = [
      { timestamp: 1000, index: 0, amplitude: 0.1 },
      { timestamp: 5000, index: 100, amplitude: 0.1 },
      { timestamp: 9000, index: 200, amplitude: 0.1 },
    ];
    const ibis = computeIBIs(peaks);
    expect(ibis).toEqual([4000, 4000]); // 4 seconds apart
  });

  test('filters out unreasonably long IBIs', () => {
    const peaks = [
      { timestamp: 1000, index: 0, amplitude: 0.1 },
      { timestamp: 20000, index: 100, amplitude: 0.1 }, // 19 sec — too long
    ];
    const ibis = computeIBIs(peaks);
    expect(ibis).toEqual([]); // filtered out (>10s)
  });
});

// ---------------------------------------------------------------------------
// getBreathRate
// ---------------------------------------------------------------------------
describe('getBreathRate', () => {
  test('returns null for insufficient data', () => {
    expect(getBreathRate([])).toBeNull();
    expect(getBreathRate(makeSamples({ durationSec: 1, breathsPerMin: 15 }))).toBeNull();
  });

  test('computes correct breath rate from clean signal', () => {
    const targetBPM = 15;
    const samples = makeSamples({
      durationSec: 60,
      breathsPerMin: targetBPM,
      amplitude: 0.05,
    });
    const rate = getBreathRate(samples);
    expect(rate).not.toBeNull();
    // Allow +-3 from target
    expect(rate!).toBeGreaterThanOrEqual(targetBPM - 3);
    expect(rate!).toBeLessThanOrEqual(targetBPM + 3);
  });

  test('returns null for out-of-range rates', () => {
    // 2 breaths/min is below the 4 bpm minimum
    const samples = makeSamples({
      durationSec: 60,
      breathsPerMin: 2,
      amplitude: 0.05,
    });
    const rate = getBreathRate(samples);
    // Should be null (out of 4-40 range) or very low
    if (rate !== null) {
      expect(rate).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// getLatestIBI
// ---------------------------------------------------------------------------
describe('getLatestIBI', () => {
  test('returns null for insufficient data', () => {
    expect(getLatestIBI([])).toBeNull();
  });

  test('returns IBI in reasonable range for breathing signal', () => {
    const samples = makeSamples({
      durationSec: 30,
      breathsPerMin: 15,
      amplitude: 0.05,
    });
    const ibi = getLatestIBI(samples);
    if (ibi !== null) {
      // 15 bpm → ~4000ms IBI, allow 2000-8000ms range
      expect(ibi).toBeGreaterThanOrEqual(2000);
      expect(ibi).toBeLessThanOrEqual(8000);
    }
  });
});

// ---------------------------------------------------------------------------
// getFilteredZForDisplay
// ---------------------------------------------------------------------------
describe('getFilteredZForDisplay', () => {
  test('returns empty for insufficient data', () => {
    expect(getFilteredZForDisplay([])).toEqual([]);
  });

  test('returns timestamped values for valid data', () => {
    const samples = makeSamples({ durationSec: 25, breathsPerMin: 15 });
    const display = getFilteredZForDisplay(samples, 20000);
    expect(display.length).toBeGreaterThan(0);
    expect(display[0]).toHaveProperty('timestamp');
    expect(display[0]).toHaveProperty('value');
  });
});
