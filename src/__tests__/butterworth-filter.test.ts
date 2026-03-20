/**
 * Butterworth filter tests — SPEC Section 1.4.
 *
 * 2nd order Butterworth bandpass: 0.5–4 Hz at 30 Hz sample rate.
 */
import { ButterworthBandpass } from '../camera/butterworth-filter';

describe('ButterworthBandpass', () => {
  const SAMPLE_RATE = 30; // Hz (camera fps)

  test('creates filter with correct parameters', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);
    expect(filter).toBeDefined();
  });

  test('passes signal within passband (1 Hz ~ 60 BPM)', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);
    const freq = 1.0; // Hz — well within passband

    // Generate 3 seconds of 1 Hz sine at 30 fps
    const samples = 90;
    const output: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const input = Math.sin(2 * Math.PI * freq * t);
      output.push(filter.process(input));
    }

    // After settling (first ~30 samples), output should have significant amplitude
    const settled = output.slice(60);
    const maxAmplitude = Math.max(...settled.map(Math.abs));
    expect(maxAmplitude).toBeGreaterThan(0.3); // significant passthrough
  });

  test('attenuates signal below passband (0.1 Hz)', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);
    const freq = 0.1; // Hz — below passband (motion artifact range)

    // Generate 10 seconds to let slow signal develop
    const samples = 300;
    const output: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const input = Math.sin(2 * Math.PI * freq * t);
      output.push(filter.process(input));
    }

    // Output amplitude should be significantly reduced
    const settled = output.slice(150);
    const maxAmplitude = Math.max(...settled.map(Math.abs));
    expect(maxAmplitude).toBeLessThan(0.3); // attenuated
  });

  test('attenuates signal above passband (10 Hz)', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);
    const freq = 10; // Hz — above passband (noise range)

    const samples = 90;
    const output: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const input = Math.sin(2 * Math.PI * freq * t);
      output.push(filter.process(input));
    }

    const settled = output.slice(30);
    const maxAmplitude = Math.max(...settled.map(Math.abs));
    expect(maxAmplitude).toBeLessThan(0.15); // strongly attenuated
  });

  test('2 Hz signal passes well (120 BPM — typical heart rate)', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);
    const freq = 2.0;

    const samples = 90;
    const output: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const input = Math.sin(2 * Math.PI * freq * t);
      output.push(filter.process(input));
    }

    const settled = output.slice(60);
    const maxAmplitude = Math.max(...settled.map(Math.abs));
    expect(maxAmplitude).toBeGreaterThan(0.3);
  });

  test('reset clears filter state', () => {
    const filter = new ButterworthBandpass(0.5, 4, SAMPLE_RATE);

    // Feed some data
    for (let i = 0; i < 30; i++) {
      filter.process(Math.sin(2 * Math.PI * i / SAMPLE_RATE));
    }

    filter.reset();

    // After reset, first output should be near zero (no history)
    const out = filter.process(0);
    expect(out).toBe(0);
  });
});
