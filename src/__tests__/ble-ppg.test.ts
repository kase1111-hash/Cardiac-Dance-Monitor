/**
 * Tests for Innovo BLE PPG protocol — Nordic UART service with 0xFFF1 characteristic.
 *
 * Covers:
 * - Packet parsing (raw 2-byte PPG, 13-byte status with 0x3E/0xF0 markers)
 * - parseInnovoPacket dispatcher (length + header/trailer discrimination)
 * - BLE mode detection with Nordic UART UUID
 * - Scan service UUIDs include Nordic UART
 * - UUID aliases (PPG_SERVICE_UUID, PPG_CHARACTERISTIC_UUID)
 * - BLE PPG handler end-to-end:
 *   - Raw bytes @ 28 Hz → PPGProcessor → PPIs
 *   - Status packets → SpO2/BPM/PI exposure
 *   - Zero-run detection (5+ zeros → pause, resume on signal return)
 *   - Finger presence transitions
 */
import {
  parsePPGPacket,
  parseRawPPGPacket,
  parseStatusPacket,
  parseInnovoPacket,
  detectBLEMode,
  HEART_RATE_SERVICE_UUID,
  NORDIC_UART_SERVICE_UUID,
  INNOVO_PPG_CHARACTERISTIC_UUID,
  PPG_SERVICE_UUID,
  PPG_CHARACTERISTIC_UUID,
  SCAN_SERVICE_UUIDS,
} from '../ble/ble-service';
import { BLEPPGHandler, INNOVO_PPG_SAMPLE_RATE } from '../ble/ble-ppg-handler';

// ---------------------------------------------------------------------------
// Helper: build a real-format status packet (0x3E header, 0xF0 trailer)
// ---------------------------------------------------------------------------
function makeStatusPacket(opts: {
  spo2?: number;
  bpm?: number;
  pi?: number;
}): Uint8Array {
  const spo2 = opts.spo2 ?? 98;
  const bpm = opts.bpm ?? 72;
  const pi = opts.pi !== undefined ? Math.round(opts.pi * 10) : 35;
  return new Uint8Array([
    0x3E,                    // [0] header
    spo2,                    // [1] SpO2
    0x00,                    // [2] reserved
    bpm,                     // [3] BPM
    0x00,                    // [4] reserved
    0x00,                    // [5] unknown
    0, 0, 0, 0, 0,          // [6-10] reserved
    pi,                      // [11] PI × 10
    0xF0,                    // [12] trailer
  ]);
}

// ---------------------------------------------------------------------------
// parseRawPPGPacket
// ---------------------------------------------------------------------------
describe('parseRawPPGPacket', () => {
  test('finger present with intensity value', () => {
    const data = new Uint8Array([0x01, 0x80]);
    const result = parseRawPPGPacket(data);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('raw');
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(128);
  });

  test('finger removed (status != 0x01)', () => {
    const result = parseRawPPGPacket(new Uint8Array([0x00, 0x00]));
    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(false);
    expect(result!.intensity).toBe(0);
  });

  test('returns null for single byte', () => {
    expect(parseRawPPGPacket(new Uint8Array([0x01]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseStatusPacket (real 0x3E/0xF0 format)
// ---------------------------------------------------------------------------
describe('parseStatusPacket', () => {
  test('parses valid status packet', () => {
    const data = makeStatusPacket({ spo2: 98, bpm: 72, pi: 3.5 });
    const result = parseStatusPacket(data);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('status');
    expect(result!.bpm).toBe(72);
    expect(result!.spo2).toBe(98);
    expect(result!.perfusionIndex).toBeCloseTo(3.5, 1);
    expect(result!.fingerPresent).toBe(true);
    expect(result!.searching).toBe(false);
  });

  test('searching when SpO2 is 127 (invalid)', () => {
    const data = makeStatusPacket({ spo2: 127, bpm: 0 });
    const result = parseStatusPacket(data);

    expect(result!.searching).toBe(true);
    expect(result!.spo2).toBe(-1);
  });

  test('finger not present when bpm=0 and spo2=127', () => {
    const data = makeStatusPacket({ spo2: 127, bpm: 0 });
    const result = parseStatusPacket(data);

    expect(result!.fingerPresent).toBe(false);
  });

  test('SpO2 > 100 is invalid', () => {
    const data = makeStatusPacket({ spo2: 120 });
    const result = parseStatusPacket(data);
    expect(result!.spo2).toBe(-1);
  });

  test('SpO2 of 0 is valid (though clinically unlikely)', () => {
    const data = makeStatusPacket({ spo2: 0, bpm: 60 });
    const result = parseStatusPacket(data);
    expect(result!.spo2).toBe(0);
  });

  test('extracts BPM correctly', () => {
    const data = makeStatusPacket({ bpm: 120 });
    const result = parseStatusPacket(data);
    expect(result!.bpm).toBe(120);
  });

  test('returns null for short data', () => {
    expect(parseStatusPacket(new Uint8Array([0x3E, 98, 0]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseInnovoPacket (dispatcher: length + 0x3E/0xF0 markers)
// ---------------------------------------------------------------------------
describe('parseInnovoPacket', () => {
  test('2 bytes → raw PPG packet', () => {
    const result = parseInnovoPacket(new Uint8Array([0x01, 0x80]));
    expect(result).not.toBeNull();
    expect(result!.type).toBe('raw');
  });

  test('13 bytes with 0x3E/0xF0 → status packet', () => {
    const data = makeStatusPacket({ spo2: 98, bpm: 72 });
    const result = parseInnovoPacket(data);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('status');
  });

  test('13 bytes WITHOUT 0x3E header → null (not a status packet)', () => {
    const data = new Uint8Array([0x81, 0x01, 0, 72, 98, 35, 0, 0, 0, 0, 0, 0, 0xF0]);
    const result = parseInnovoPacket(data);
    expect(result).toBeNull();
  });

  test('13 bytes WITHOUT 0xF0 trailer → null', () => {
    const data = new Uint8Array([0x3E, 98, 0, 72, 0, 35, 0, 0, 0, 0, 0, 0, 0x00]);
    const result = parseInnovoPacket(data);
    expect(result).toBeNull();
  });

  test('1 byte → null', () => {
    expect(parseInnovoPacket(new Uint8Array([0x01]))).toBeNull();
  });

  test('5 bytes → null (unknown packet type)', () => {
    expect(parseInnovoPacket(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  test('0 bytes → null', () => {
    expect(parseInnovoPacket(new Uint8Array([]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parsePPGPacket (legacy compat)
// ---------------------------------------------------------------------------
describe('parsePPGPacket (legacy)', () => {
  test('finger present with intensity value', () => {
    const data = new Uint8Array([0x01, 0x80]);
    const result = parsePPGPacket(data);
    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(128);
  });

  test('finger removed (status != 0x01)', () => {
    const result = parsePPGPacket(new Uint8Array([0x00, 0x00]));
    expect(result).not.toBeNull();
    expect(result!.fingerPresent).toBe(false);
    expect(result!.intensity).toBe(0);
  });

  test('max intensity value', () => {
    const result = parsePPGPacket(new Uint8Array([0x01, 0xFF]));
    expect(result!.fingerPresent).toBe(true);
    expect(result!.intensity).toBe(255);
  });

  test('min intensity value with finger present', () => {
    const result = parsePPGPacket(new Uint8Array([0x01, 0x00]));
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
    const result = parsePPGPacket(new Uint8Array([0x02, 0x50]));
    expect(result!.fingerPresent).toBe(false);
    expect(result!.intensity).toBe(0x50);
  });
});

// ---------------------------------------------------------------------------
// detectBLEMode
// ---------------------------------------------------------------------------
describe('detectBLEMode', () => {
  test('Nordic UART service UUID → raw_ppg mode', () => {
    expect(detectBLEMode([NORDIC_UART_SERVICE_UUID])).toBe('raw_ppg');
  });

  test('Legacy PPG_SERVICE_UUID alias → raw_ppg mode', () => {
    expect(detectBLEMode([PPG_SERVICE_UUID])).toBe('raw_ppg');
  });

  test('Heart Rate service UUID → standard_hr mode', () => {
    expect(detectBLEMode([HEART_RATE_SERVICE_UUID])).toBe('standard_hr');
  });

  test('both services → prefers raw_ppg', () => {
    expect(detectBLEMode([HEART_RATE_SERVICE_UUID, NORDIC_UART_SERVICE_UUID])).toBe('raw_ppg');
  });

  test('short-form FFF0 UUID → raw_ppg (backward compat)', () => {
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
  test('includes both Heart Rate and Nordic UART service UUIDs', () => {
    expect(SCAN_SERVICE_UUIDS).toContain(HEART_RATE_SERVICE_UUID);
    expect(SCAN_SERVICE_UUIDS).toContain(NORDIC_UART_SERVICE_UUID);
  });
});

// ---------------------------------------------------------------------------
// UUID aliases
// ---------------------------------------------------------------------------
describe('UUID aliases', () => {
  test('PPG_SERVICE_UUID === NORDIC_UART_SERVICE_UUID', () => {
    expect(PPG_SERVICE_UUID).toBe(NORDIC_UART_SERVICE_UUID);
  });

  test('PPG_CHARACTERISTIC_UUID === INNOVO_PPG_CHARACTERISTIC_UUID (0xFFF1)', () => {
    expect(PPG_CHARACTERISTIC_UUID).toBe(INNOVO_PPG_CHARACTERISTIC_UUID);
    expect(PPG_CHARACTERISTIC_UUID).toBe('0000fff1-0000-1000-8000-00805f9b34fb');
  });
});

// ---------------------------------------------------------------------------
// INNOVO_PPG_SAMPLE_RATE
// ---------------------------------------------------------------------------
describe('INNOVO_PPG_SAMPLE_RATE', () => {
  test('is 28 Hz (measured from real device)', () => {
    expect(INNOVO_PPG_SAMPLE_RATE).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// BLEPPGHandler
// ---------------------------------------------------------------------------
describe('BLEPPGHandler', () => {
  test('default sample rate is 28 Hz', () => {
    const handler = new BLEPPGHandler();
    expect(handler.getSampleCount()).toBe(0);
  });

  test('extracts PPIs from simulated 1 Hz PPG stream at 28 Hz', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    const sampleRate = 28;
    const freq = 1.0;

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= sampleRate * 8; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));
      handler.handleNotification(new Uint8Array([0x01, intensity]), t * 1000);
    }

    expect(ppis.length).toBeGreaterThanOrEqual(2);
    for (const ppi of ppis) {
      expect(ppi).toBeGreaterThan(700);
      expect(ppi).toBeLessThan(1400);
    }
  });

  test('no PPIs emitted when finger not present', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    for (let i = 0; i < 200; i++) {
      const t = i / 28;
      const intensity = Math.round(128 + 40 * Math.sin(2 * Math.PI * 1.0 * t));
      handler.handleNotification(new Uint8Array([0x00, intensity]), t * 1000);
    }

    expect(ppis.length).toBe(0);
  });

  test('fires onFingerPresenceChange on transitions', () => {
    const handler = new BLEPPGHandler(28);
    const transitions: boolean[] = [];
    handler.onFingerPresenceChange = (present) => transitions.push(present);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    expect(transitions).toEqual([true]);

    handler.handleNotification(new Uint8Array([0x00, 0x00]), 100);
    expect(transitions).toEqual([true, false]);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 200);
    expect(transitions).toEqual([true, false, true]);
  });

  test('resets processor on finger removal and re-placement', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 50; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0x80]), i * 36);
    }

    handler.handleNotification(new Uint8Array([0x00, 0x00]), 2100);
    expect(handler.getConsecutivePeakCount()).toBe(0);
    expect(handler.getSampleCount()).toBe(0);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 3000);
    expect(handler.getConsecutivePeakCount()).toBe(0);
  });

  test('reset clears all state', () => {
    const handler = new BLEPPGHandler(28);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 10; i++) {
      handler.handleNotification(new Uint8Array([0x01, 128]), i * 36);
    }

    expect(handler.fingerPresent).toBe(true);
    expect(handler.getSampleCount()).toBeGreaterThan(0);

    handler.reset();
    expect(handler.fingerPresent).toBe(false);
    expect(handler.getSampleCount()).toBe(0);
    expect(handler.getConsecutivePeakCount()).toBe(0);
    expect(handler.spo2).toBe(-1);
    expect(handler.latestStatus).toBeNull();
  });

  test('ignores packets smaller than 2 bytes', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    handler.handleNotification(new Uint8Array([0x01]), 0);
    handler.handleNotification(new Uint8Array([]), 40);

    expect(ppis.length).toBe(0);
    expect(handler.getSampleCount()).toBe(0);
  });

  test('PPIs from BLE PPG feed through same pipeline as camera PPG', () => {
    const handler = new BLEPPGHandler(50);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    const sampleRate = 50;
    const freq = 1.2;

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= sampleRate * 10; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));
      handler.handleNotification(new Uint8Array([0x01, intensity]), t * 1000);
    }

    expect(ppis.length).toBeGreaterThanOrEqual(3);
    const settledPpis = ppis.slice(1);
    for (const ppi of settledPpis) {
      expect(ppi).toBeGreaterThan(500);
      expect(ppi).toBeLessThan(1200);
    }
  });

  // --- Status packet handling (0x3E/0xF0 format) ---

  test('routes 13-byte status packets to onStatus callback', () => {
    const handler = new BLEPPGHandler(28);
    const statuses: any[] = [];
    handler.onStatus = (s) => statuses.push(s);

    handler.handleNotification(makeStatusPacket({ spo2: 98, bpm: 72, pi: 3.5 }), 1000);

    expect(statuses.length).toBe(1);
    expect(statuses[0].bpm).toBe(72);
    expect(statuses[0].spo2).toBe(98);
    expect(statuses[0].perfusionIndex).toBeCloseTo(3.5, 1);
  });

  test('exposes SpO2 and deviceBPM from latest status', () => {
    const handler = new BLEPPGHandler(28);

    expect(handler.spo2).toBe(-1);
    expect(handler.deviceBPM).toBe(0);
    expect(handler.perfusionIndex).toBe(0);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    handler.handleNotification(makeStatusPacket({ spo2: 97, bpm: 75, pi: 4.2 }), 1000);

    expect(handler.spo2).toBe(97);
    expect(handler.deviceBPM).toBe(75);
    expect(handler.perfusionIndex).toBeCloseTo(4.2, 1);
  });

  test('interleaved raw PPG and status packets work together', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    const statuses: any[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);
    handler.onStatus = (s) => statuses.push(s);

    const sampleRate = 28;
    const freq = 1.0;

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= sampleRate * 5; i++) {
      const t = i / sampleRate;
      const phase = (t * freq) % 1;
      const intensity = Math.round(128 + 40 * Math.exp(-((phase - 0.3) ** 2) / 0.01));

      handler.handleNotification(new Uint8Array([0x01, intensity]), t * 1000);

      if (i % sampleRate === 0) {
        handler.handleNotification(
          makeStatusPacket({ spo2: 98, bpm: 72, pi: 3.5 }),
          t * 1000 + 1,
        );
      }
    }

    expect(ppis.length).toBeGreaterThan(0);
    expect(statuses.length).toBe(5);
    expect(handler.spo2).toBe(98);
  });

  test('13-byte packet without 0x3E/0xF0 markers is ignored by handler', () => {
    const handler = new BLEPPGHandler(28);
    const statuses: any[] = [];
    handler.onStatus = (s) => statuses.push(s);

    // Old-format packet (0x81 header) — parseInnovoPacket returns null,
    // falls through to legacy 2-byte parse which also returns null (too long for raw, no markers for status)
    const badPacket = new Uint8Array([0x81, 0x01, 0, 72, 98, 35, 0, 0, 0, 0, 0, 0, 0]);
    handler.handleNotification(badPacket, 1000);

    expect(statuses.length).toBe(0);
  });

  // --- Zero-run detection ---

  test('pauses peak detection after 5+ consecutive zeros', () => {
    const handler = new BLEPPGHandler(28);
    const ppis: number[] = [];
    handler.onPPI = (ppi) => ppis.push(ppi);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 28; i++) {
      handler.handleNotification(new Uint8Array([0x01, 128]), i * 36);
    }
    const countBeforeZeros = handler.getSampleCount();

    for (let i = 0; i < 10; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0]), (29 + i) * 36);
    }

    expect(handler.signalDropout).toBe(true);
    expect(handler.getSampleCount()).toBeLessThanOrEqual(countBeforeZeros + 5);
  });

  test('resets processor and resumes on signal return after zero-run', () => {
    const handler = new BLEPPGHandler(28);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);
    for (let i = 1; i <= 28; i++) {
      handler.handleNotification(new Uint8Array([0x01, 128]), i * 36);
    }

    for (let i = 0; i < 10; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0]), (29 + i) * 36);
    }
    expect(handler.signalDropout).toBe(true);

    handler.handleNotification(new Uint8Array([0x01, 128]), 2000);
    expect(handler.signalDropout).toBe(false);
    expect(handler.getConsecutivePeakCount()).toBe(0);
  });

  test('4 consecutive zeros do NOT trigger dropout', () => {
    const handler = new BLEPPGHandler(28);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= 4; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0]), i * 36);
    }

    expect(handler.signalDropout).toBe(false);
  });

  test('zero counter resets on non-zero sample', () => {
    const handler = new BLEPPGHandler(28);

    handler.handleNotification(new Uint8Array([0x01, 0x80]), 0);

    for (let i = 1; i <= 3; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0]), i * 36);
    }
    handler.handleNotification(new Uint8Array([0x01, 128]), 4 * 36);
    for (let i = 5; i <= 7; i++) {
      handler.handleNotification(new Uint8Array([0x01, 0]), i * 36);
    }

    expect(handler.signalDropout).toBe(false);
  });
});
