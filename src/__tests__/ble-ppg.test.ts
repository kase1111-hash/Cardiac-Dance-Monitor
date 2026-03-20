/**
 * Tests for Nordic-style PPG BLE support (0xFFF0/0xFFF1).
 *
 * Covers:
 * - PPG packet parsing (parsePPGPacket)
 * - BLE mode detection (detectBLEMode)
 * - BLE PPG handler end-to-end (raw bytes → PPGProcessor → PPIs)
 */
import {
  parsePPGPacket,
  detectBLEMode,
  HEART_RATE_SERVICE_UUID,
  PPG_SERVICE_UUID,
  PPG_CHARACTERISTIC_UUID,
  SCAN_SERVICE_UUIDS,
} from '../ble/ble-service';
import { BLEPPGHandler } from '../ble/ble-ppg-handler';

// ---------------------------------------------------------------------------
// parsePPGPacket
// ---------------------------------------------------------------------------
describe('parsePPGPacket', () => {
  test('finger present with intensity value', () => {
    const data = new Uint8Array([0x01, 0x80]); // status=1, intensity=128
    const result = parsePPGPacket(data);

    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(128);
  });

  test('finger removed (status != 0x01)', () => {
    const data = new Uint8Array([0x00, 0x00]); // status=0, intensity=0
    const result = parsePPGPacket(data);

    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(false);
    expect(result!.intensity).toBe(0);
  });

  test('max intensity value', () => {
    const data = new Uint8Array([0x01, 0xFF]);
    const result = parsePPGPacket(data);

    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(255);
  });

  test('min intensity value with finger present', () => {
    const data = new Uint8Array([0x01, 0x00]);
    const result = parsePPGPacket(data);

    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(0);
  });

  test('returns null for empty data', () => {
    expect(parsePPGPacket(new Uint8Array([]))).toBeNull();
  });

  test('returns null for single byte', () => {
    expect(parsePPGPacket(new Uint8Array([0x01]))).toBeNull();
  });

  test('non-standard status byte treated as finger removed', () => {
    const data = new Uint8Array([0x02, 0x50]);
    const result = parsePPGPacket(data);

    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(false);
    expect(result!.intensity).toBe(0x50);
  });
});

// ---------------------------------------------------------------------------
// detectBLEMode
// ---------------------------------------------------------------------------
describe('detectBLEMode', () => {
  test('PPG service UUID → raw_ppg mode', () => {
    expect(detectBLEMode([PPG_SERVICE_UUID])).toBe('raw_ppg');
  });

  test('Heart Rate service UUID → standard_hr mode', () => {
    expect(detectBLEMode([HEART_RATE_SERVICE_UUID])).toBe('standard_hr');
  });

  test('both services → prefers raw_ppg', () => {
    expect(detectBLEMode([HEART_RATE_SERVICE_UUID, PPG_SERVICE_UUID])).toBe('raw_ppg');
  });

  test('short-form FFF0 UUID → raw_ppg', () => {
    expect(detectBLEMode(['FFF0'])).toBe('raw_ppg');
  });

  test('unknown service → defaults to standard_hr', () => {
    expect(detectBLEMode(['0000abcd-0000-1000-8000-00805f9b34fb'])).toBe('standard_hr');
  });

  test('empty array → defaults to standard_hr', () => {
    expect(detectBLEMode([])).toBe('standard_hr');
  });
});

// ---------------------------------------------------------------------------
// SCAN_SERVICE_UUIDS
// ---------------------------------------------------------------------------
describe('SCAN_SERVICE_UUIDS', () => {
  test('includes both Heart Rate and PPG service UUIDs', () => {
    expect(SCAN_SERVICE_UUIDS).toContain(HEART_RATE_SERVICE_UUID);
    expect(SCAN_SERVICE_UUIDS).toContain(PPG_SERVICE_UUID);
  });
});

// ---------------------------------------------------------------------------
// BLEPPGHandler
// ---------------------------------------------------------------------------
describe('BLEPPGHandler', () => {
  test('extracts PPIs from simulated 1 Hz PPG stream', () => {
    const handler = new BLEPPGHandler(25); // 25 Hz sample rate
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    const sampleRate = 25;
    const freq = 1.0; // 1 Hz = 60 BPM

    // Simulate finger placement first
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    // Generate 8 seconds of clean PPG-like signal at 25 Hz
    for (let i = 1; i <= sampleRate * 8; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      // PPG-like waveform: sharp peak, slow return
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));
      const data = new Uint8Array([0x01, intensity]);
      handler.handleNotification(data, t * 1000);
    }

    // Should extract PPIs near 1000ms (60 BPM)
    expect(ppis.length).toBeGreaterThanOrEqual(2);
    for (const ppi of ppis) {
      expect(ppi).toBeGreaterThan(700);
      expect(ppi).toBeLessThan(1400);
    }
  });

  test('no PPIs emitted when finger not present', () => {
    const handler = new BLEPPGHandler(25);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    // Send data with finger removed (status=0x00)
    for (let i = 0; i < 200; i++) {
      const t = i / 25;
      const intensity = Math.round(128 + 40 * Math.sin(2 * Math.PI * 1.0 * t));
      handler.handleNotification(new Uint8Array([0x00, intensity]), t * 1000);
    }

    expect(ppis.length).toBe(0);
  });

  test('fires onFingerPresenceChange on transitions', () => {
    const handler = new BLEPPGHandler(25);
    const transitions: boolean[] = [];
    handler.onFingerPresenceChange = (present) => transitions.push(present);

    // Initially finger absent, then place finger
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    expect(transitions).toEqual([true]);

    // Remove finger
    handler.handleNotification(new Uint8Array([0x00, 0x00]), 100);
    expect(transitions).toEqual([true, false]);

    // Place finger again
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 200);
    expect(transitions).toEqual([true, false, true]);
  });

  test('resets processor on finger removal and re-placement', () => {
    const handler = new BLEPPGHandler(25);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    // Place finger and send some samples
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 50; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0x80]), i * 40);
    }

    const peaksBefore = handler.getConsecutivePeakCount();

    // Remove finger
    handler.handleNotification(new Uint8Array([0x00, 0x00]), 2100);
    expect(handler.getConsecutivePeakCount()).toBe(0);
    expect(handler.getSampleCount()).toBe(0);

    // Re-place finger — should start fresh
    handler.handleNotification(new Uint8Array([0x01, 0x80]), 3000);
    expect(handler.getConsecutivePeakCount()).toBe(0);
  });

  test('reset clears all state', () => {
    const handler = new BLEPPGHandler(25);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 10; i++) {
      handler.handleNotification(new Uint8Array([0x01, 128]), i * 40);
    }

    expect(handler.fingerPresent).toBe(true);
    expect(handler.getSampleCount()).toBeGreaterThan(0);

    handler.reset();
    expect(handler.fingerPresent).toBe(false);
    expect(handler.getSampleCount()).toBe(0);
    expect(handler.getConsecutivePeakCount()).toBe(0);
  });

  test('ignores packets smaller than 2 bytes', () => {
    const handler = new BLEPPGHandler(25);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    handler.handleNotification(new Uint8Array([0x01]), 0);
    handler.handleNotification(new Uint8Array([]), 40);

    expect(ppis.length).toBe(0);
    expect(handler.getSampleCount()).toBe(0);
  });

  test('PPIs from BLE PPG feed through same pipeline as camera PPG', () => {
    // Verify the PPGProcessor is properly wired — PPIs should be in
    // physiologically valid range when fed a clean waveform
    const handler = new BLEPPGHandler(50); // 50 Hz (upper range)
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    const sampleRate = 50;
    const freq = 1.2; // 1.2 Hz = 72 BPM

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= sampleRate * 10; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));
      handler.handleNotification(new Uint8Array([0x01, intensity]), t * 1000);
    }

    expect(ppis.length).toBeGreaterThanOrEqual(3);
    // PPIs should cluster around 833ms (60000/72)
    const settledPpis = ppis.slice(1);
    for (const ppi of settledPpis) {
      expect(ppi).toBeGreaterThan(500);
      expect(ppi).toBeLessThan(1200);
    }
  });
});
