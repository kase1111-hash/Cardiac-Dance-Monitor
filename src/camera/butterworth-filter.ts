/**
 * Butterworth bandpass filter — SPEC Section 1.4.
 *
 * 2nd order Butterworth bandpass implemented as cascaded
 * 2nd order highpass + 2nd order lowpass biquad sections.
 *
 * Design: bilinear transform from analog prototype.
 */

/** Biquad filter section (Direct Form II Transposed). */
class BiquadSection {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;

  // State variables
  private z1 = 0;
  private z2 = 0;
  /** False until the delay line has been primed from the first sample. */
  private primed = false;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  process(input: number): number {
    // Prime the delay line from the first sample so the filter starts in
    // steady state for a constant input. Starting at zero while redMean is
    // ~200 presents a full-amplitude step: the response took ~52 samples
    // (1.73s) to settle and its 3rd sample was a local maximum, so the peak
    // detector fired on it and emitted a bogus first interval after every
    // reset (which happens on each finger transition and dropout recovery).
    if (!this.primed) {
      this.primed = true;
      // DC steady state for constant x: y = x*(b0+b1+b2)/(1+a1+a2). Solving
      // the DF2T fixed point z1 = b1*x - a1*y + z2, z2 = b2*x - a2*y makes
      // the very first output equal y instead of b0*x. For the high-pass
      // stage the DC gain is 0, so the output correctly starts at 0.
      const denom = 1 + this.a1 + this.a2;
      if (Math.abs(denom) > 1e-12) {
        const y = (input * (this.b0 + this.b1 + this.b2)) / denom;
        this.z2 = this.b2 * input - this.a2 * y;
        this.z1 = this.b1 * input - this.a1 * y + this.z2;
      }
    }
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
    this.primed = false;
  }
}

/**
 * Design a 2nd order Butterworth lowpass biquad.
 * Uses bilinear transform with frequency pre-warping.
 */
function designLowpass(cutoffHz: number, sampleRate: number): BiquadSection {
  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const K = Math.tan(omega / 2);
  const K2 = K * K;
  const sqrt2K = Math.SQRT2 * K;
  const norm = 1 / (1 + sqrt2K + K2);

  return new BiquadSection(
    K2 * norm,           // b0
    2 * K2 * norm,       // b1
    K2 * norm,           // b2
    2 * (K2 - 1) * norm, // a1
    (1 - sqrt2K + K2) * norm, // a2
  );
}

/**
 * Design a 2nd order Butterworth highpass biquad.
 * Uses bilinear transform with frequency pre-warping.
 */
function designHighpass(cutoffHz: number, sampleRate: number): BiquadSection {
  const omega = 2 * Math.PI * cutoffHz / sampleRate;
  const K = Math.tan(omega / 2);
  const K2 = K * K;
  const sqrt2K = Math.SQRT2 * K;
  const norm = 1 / (1 + sqrt2K + K2);

  return new BiquadSection(
    norm,                      // b0
    -2 * norm,                 // b1
    norm,                      // b2
    2 * (K2 - 1) * norm,      // a1
    (1 - sqrt2K + K2) * norm,  // a2
  );
}

/**
 * 2nd order Butterworth bandpass filter.
 *
 * Implemented as cascade of highpass (lowCutoff) + lowpass (highCutoff).
 */
export class ButterworthBandpass {
  private highpass: BiquadSection;
  private lowpass: BiquadSection;

  /**
   * @param lowCutoff - Lower cutoff frequency in Hz (e.g. 0.5)
   * @param highCutoff - Upper cutoff frequency in Hz (e.g. 4.0)
   * @param sampleRate - Sample rate in Hz (e.g. 30 for camera fps)
   */
  constructor(lowCutoff: number, highCutoff: number, sampleRate: number) {
    this.highpass = designHighpass(lowCutoff, sampleRate);
    this.lowpass = designLowpass(highCutoff, sampleRate);
  }

  /** Process one sample through the bandpass filter. */
  process(input: number): number {
    return this.lowpass.process(this.highpass.process(input));
  }

  /** Reset filter state (clear history). */
  reset(): void {
    this.highpass.reset();
    this.lowpass.reset();
  }
}
