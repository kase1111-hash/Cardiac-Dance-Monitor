/**
 * PPG processor tests — combines Butterworth filter + peak detection.
 *
 * End-to-end: raw red channel values → filtered → peaks → PPIs.
 */
import { PPGProcessor } from '../camera/ppg-processor';

describe('PPGProcessor', () => {
  test('extracts PPIs from clean 1 Hz pulse signal', () => {
    const processor = new PPGProcessor(30); // 30 fps
    const freq = 1.0; // 1 Hz = 60 BPM
    const sampleRate = 30;

    const ppis: number[] = [];
    processor.onPPI = (ppi) => ppis.push(ppi);

    // Generate 5 seconds of clean pulse signal
    for (let i = 0; i < 150; i++) {
      const t = i / sampleRate;
      // Simulate PPG-like signal: sharp peak, slow return
      const phase = (t * freq) % 1;
      const value = 128 + 20 * Math.exp(-((phase - 0.3) ** 2) / 0.01);
      processor.processFrame(value, t * 1000);
    }

    // Should extract PPIs near 1000ms
    expect(ppis.length).toBeGreaterThanOrEqual(2);
    for (const ppi of ppis) {
      expect(ppi).toBeGreaterThan(700);
      expect(ppi).toBeLessThan(1400);
    }
  });

  test('extracts PPIs from 1.5 Hz signal (90 BPM)', () => {
    const processor = new PPGProcessor(30);
    const freq = 1.5;
    const sampleRate = 30;

    const ppis: number[] = [];
    processor.onPPI = (ppi) => ppis.push(ppi);

    // Need enough frames for filter to settle + multiple peaks
    for (let i = 0; i < 300; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const value = 128 + 20 * Math.exp(-((phase - 0.3) ** 2) / 0.01);
      processor.processFrame(value, t * 1000);
    }

    expect(ppis.length).toBeGreaterThanOrEqual(3);
    // Skip first PPI (may be affected by filter settling), check the rest
    const settledPpis = ppis.slice(1);
    for (const ppi of settledPpis) {
      expect(ppi).toBeGreaterThan(450);
      expect(ppi).toBeLessThan(900);
    }
  });

  test('constant DC produces far fewer PPIs than a real pulse', () => {
    const processor = new PPGProcessor(30);
    const sampleRate = 30;

    const ppis: number[] = [];
    processor.onPPI = (ppi) => ppis.push(ppi);

    // Feed 10 seconds of constant DC
    for (let i = 0; i < 300; i++) {
      processor.processFrame(128, (i / sampleRate) * 1000);
    }

    // A real 1 Hz pulse over 10s would produce ~9 PPIs.
    // DC should produce at most a few transient artifacts from filter settling.
    expect(ppis.length).toBeLessThan(5);
  });

  test('getConsecutivePeakCount tracks peaks', () => {
    const processor = new PPGProcessor(30);
    expect(processor.getConsecutivePeakCount()).toBe(0);

    const freq = 1.0;
    const sampleRate = 30;

    processor.onPPI = () => {};

    for (let i = 0; i < 150; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const value = 128 + 20 * Math.exp(-((phase - 0.3) ** 2) / 0.01);
      processor.processFrame(value, t * 1000);
    }

    expect(processor.getConsecutivePeakCount()).toBeGreaterThanOrEqual(2);
  });

  test('reset clears all state', () => {
    const processor = new PPGProcessor(30);
    const freq = 1.0;
    const sampleRate = 30;

    processor.onPPI = () => {};

    for (let i = 0; i < 90; i++) {
      const t = i / sampleRate;
      const value = 128 + 20 * Math.sin(2 * Math.PI * freq * t);
      processor.processFrame(value, t * 1000);
    }

    processor.reset();
    expect(processor.getConsecutivePeakCount()).toBe(0);
  });
});
