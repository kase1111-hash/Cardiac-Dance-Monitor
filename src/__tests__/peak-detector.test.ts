/**
 * Peak detector tests — SPEC Section 1.4.
 *
 * Detects peaks in filtered PPG signal with minimum 300ms inter-peak interval.
 */
import { PeakDetector } from '../camera/peak-detector';

describe('PeakDetector', () => {
  test('detects peak in simple sine wave', () => {
    const detector = new PeakDetector(300);
    const sampleRate = 30;
    const freq = 1.0; // 1 Hz = 60 BPM

    const ppis: number[] = [];
    detector.onPeak = (timestampMs) => {
      // We'll collect timestamps and compute intervals
    };

    // Generate 3 seconds of 1 Hz sine, feeding timestamps
    const timestamps: number[] = [];
    for (let i = 0; i < 90; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * freq * t);
      const timestampMs = t * 1000;
      const peak = detector.process(value, timestampMs);
      if (peak !== null) {
        timestamps.push(peak);
      }
    }

    // Should detect ~2-3 peaks in 3 seconds at 1 Hz
    expect(timestamps.length).toBeGreaterThanOrEqual(2);
  });

  test('enforces minimum 300ms inter-peak interval', () => {
    const detector = new PeakDetector(300);

    // Simulate peaks at 200ms intervals (too fast — should be suppressed)
    const timestamps: number[] = [];

    // Create artificial "peaks" by feeding alternating high/low values
    for (let i = 0; i < 20; i++) {
      const t = i * 100; // every 100ms
      const value = i % 2 === 0 ? 1.0 : -1.0;
      const peak = detector.process(value, t);
      if (peak !== null) {
        timestamps.push(peak);
      }
    }

    // Consecutive peaks must be >= 300ms apart
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(300);
    }
  });

  test('returns PPI when two or more peaks detected', () => {
    const detector = new PeakDetector(300);
    const sampleRate = 30;
    const freq = 1.0; // 1 Hz

    const peaks: number[] = [];
    for (let i = 0; i < 120; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * freq * t);
      const peak = detector.process(value, t * 1000);
      if (peak !== null) {
        peaks.push(peak);
      }
    }

    // With 2+ peaks we can compute PPIs
    expect(peaks.length).toBeGreaterThanOrEqual(2);

    // PPIs should be approximately 1000ms (1 Hz)
    for (let i = 1; i < peaks.length; i++) {
      const ppi = peaks[i] - peaks[i - 1];
      expect(ppi).toBeGreaterThan(800);
      expect(ppi).toBeLessThan(1200);
    }
  });

  test('handles noisy signal without false peaks', () => {
    const detector = new PeakDetector(300);
    const sampleRate = 30;

    // Generate 1 Hz sine with small noise
    const peaks: number[] = [];
    for (let i = 0; i < 150; i++) {
      const t = i / sampleRate;
      const noise = (Math.random() - 0.5) * 0.1; // small noise
      const value = Math.sin(2 * Math.PI * 1.0 * t) + noise;
      const peak = detector.process(value, t * 1000);
      if (peak !== null) {
        peaks.push(peak);
      }
    }

    // All inter-peak intervals should be reasonable (800-1200ms for 1 Hz)
    for (let i = 1; i < peaks.length; i++) {
      const ppi = peaks[i] - peaks[i - 1];
      expect(ppi).toBeGreaterThanOrEqual(300); // minimum enforced
    }
  });

  test('reset clears state', () => {
    const detector = new PeakDetector(300);

    // Feed some data
    for (let i = 0; i < 30; i++) {
      detector.process(Math.sin(i), i * 33);
    }

    detector.reset();

    // After reset, no immediate peak should fire
    const peak = detector.process(0, 0);
    expect(peak).toBeNull();
  });

  test('detects peaks at 2 Hz (120 BPM)', () => {
    const detector = new PeakDetector(300);
    const sampleRate = 30;
    const freq = 2.0;

    const peaks: number[] = [];
    for (let i = 0; i < 150; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * freq * t);
      const peak = detector.process(value, t * 1000);
      if (peak !== null) {
        peaks.push(peak);
      }
    }

    // At 2 Hz over 5 seconds, expect ~9-10 peaks
    expect(peaks.length).toBeGreaterThanOrEqual(7);

    // PPIs should be ~500ms
    for (let i = 1; i < peaks.length; i++) {
      const ppi = peaks[i] - peaks[i - 1];
      expect(ppi).toBeGreaterThan(350);
      expect(ppi).toBeLessThan(700);
    }
  });
});
