/**
 * Hardware-source gates that keep a demo honest:
 *  - Camera PPG must not fabricate beats from sensor noise with no finger on
 *    the lens (amplitude gate in PPGProcessor).
 *  - Innovo status packets sent while the oximeter is still acquiring must
 *    not reset the waveform processor every second.
 */
import { PPGProcessor } from '../camera/ppg-processor';
import { BLEPPGHandler } from '../ble/ble-ppg-handler';
import { CAMERA_MIN_PULSE_AMPLITUDE, VALIDATION_PEAKS } from '../hooks/use-camera-ppg';

/** Deterministic pseudo-random generator so runs are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function runProcessor(
  signal: (tSec: number) => number,
  seconds: number,
  minAmplitude: number,
): number[] {
  const fps = 30;
  const processor = new PPGProcessor(fps, { minAmplitude });
  const ppis: number[] = [];
  // Mirror the hook: beats are only surfaced once the pulse is validated,
  // which also hides the filter's start-up transient.
  processor.onPPI = ppi => {
    if (processor.getConsecutivePeakCount() >= VALIDATION_PEAKS) ppis.push(ppi);
  };
  for (let i = 0; i < fps * seconds; i++) {
    const t = i / fps;
    processor.processFrame(signal(t), t * 1000);
  }
  return ppis;
}

describe('camera amplitude gate', () => {
  test('sensor noise on an uncovered lens produces zero beats', () => {
    // A 100-pixel red mean has well under 1 LSB of frame-to-frame noise; the
    // gate must hold at 1 LSB with margin. (Frames darker than the red-level
    // floor never reach the processor at all — see useCameraPPG.)
    const rnd = lcg(11);
    const bright = runProcessor(() => 200 + (rnd() - 0.5) * 2, 30, CAMERA_MIN_PULSE_AMPLITUDE);
    const rnd2 = lcg(29);
    const mid = runProcessor(() => 150 + (rnd2() - 0.5) * 1, 30, CAMERA_MIN_PULSE_AMPLITUDE);
    expect(bright.length).toBe(0);
    expect(mid.length).toBe(0);
  });

  test('the same noise DOES produce beats with the gate off (regression guard)', () => {
    const rnd = lcg(11);
    const ungated = runProcessor(() => 200 + (rnd() - 0.5) * 2, 30, 0);
    expect(ungated.length).toBeGreaterThan(10);
  });

  test('a realistic fingertip pulse still produces beats through the gate', () => {
    const rnd = lcg(3);
    // 72 BPM pulse, ~6 units peak-to-peak, on a saturated red level plus noise.
    const pulse = runProcessor(
      t => 190 + 3 * Math.sin(2 * Math.PI * 1.2 * t) + (rnd() - 0.5) * 1,
      30,
      CAMERA_MIN_PULSE_AMPLITUDE,
    );
    expect(pulse.length).toBeGreaterThanOrEqual(25);
    for (const ppi of pulse) {
      expect(ppi).toBeGreaterThan(700);
      expect(ppi).toBeLessThan(1000);
    }
  });
});

function statusPacket(spo2: number, bpm: number): Uint8Array {
  return new Uint8Array([0x3E, spo2, 0, bpm, 0, 0, 0, 0, 0, 0, 0, 35, 0xF0]);
}

describe('Innovo acquisition status packets', () => {
  function feed(withAcquiringStatus: boolean): number[] {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = ppi => ppis.push(ppi);
    const sampleRate = 28;
    const freq = 1.1; // 66 BPM
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= sampleRate * 20; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));
      handler.handleNotification(new Uint8Array([0x01, intensity]), t * 1000);
      // One status packet per second: "still acquiring" = spo2 127 / bpm 0
      if (i % sampleRate === 0 && withAcquiringStatus) {
        handler.handleNotification(statusPacket(127, 0), t * 1000 + 1);
      }
    }
    return ppis;
  }

  test('a clean waveform yields PPIs even while the device reports acquiring', () => {
    const withStatus = feed(true);
    const without = feed(false);
    expect(without.length).toBeGreaterThanOrEqual(15);
    expect(withStatus.length).toBeGreaterThanOrEqual(15);
  });

  test('status packets are still surfaced through onStatus', () => {
    const handler = new BLEPPGHandler(28);
    const seen: number[] = [];
    handler.onStatus = s => seen.push(s.spo2);
    handler.handleNotification(statusPacket(97, 72), 0);
    expect(seen).toEqual([97]);
    expect(handler.deviceBPM).toBe(72);
  });
});
