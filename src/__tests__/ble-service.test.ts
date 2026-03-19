/**
 * BLE Heart Rate Measurement parsing tests — SPEC Section 1.1 / Section 10.
 */
import { parseHeartRateMeasurement, ppiFromHeartRate } from '../ble/ble-service';

describe('parseHeartRateMeasurement', () => {
  test('Parse 0x2A37 with RR flag set → extract correct PPI', () => {
    // Flags: 0x10 (RR present, HR uint8)
    // HR: 72 BPM
    // RR: 820ms = 820 * 1.024 = 839.68 → raw = 840 (0x0348)
    const rrRaw = Math.round(820 * 1.024);
    const data = new Uint8Array([0x10, 72, rrRaw & 0xFF, (rrRaw >> 8) & 0xFF]);
    const result = parseHeartRateMeasurement(data);

    expect(result.heartRate).toBe(72);
    expect(result.rrIntervals.length).toBe(1);
    expect(result.rrIntervals[0]).toBeCloseTo(820, 0);
  });

  test('Parse 0x2A37 without RR flag → derive PPI from HR', () => {
    // Flags: 0x00 (no RR, HR uint8)
    // HR: 75 BPM
    const data = new Uint8Array([0x00, 75]);
    const result = parseHeartRateMeasurement(data);

    expect(result.heartRate).toBe(75);
    expect(result.rrIntervals.length).toBe(0);
  });

  test('Parse uint16 heart rate format', () => {
    // Flags: 0x01 (HR uint16, no RR)
    // HR: 260 BPM (0x0104)
    const data = new Uint8Array([0x01, 0x04, 0x01]);
    const result = parseHeartRateMeasurement(data);

    expect(result.heartRate).toBe(260);
    expect(result.rrIntervals.length).toBe(0);
  });

  test('Multiple RR values packed in one notification', () => {
    // Flags: 0x10 (RR present)
    // HR: 80
    // Two RR intervals: 750ms and 760ms
    const rr1Raw = Math.round(750 * 1.024);
    const rr2Raw = Math.round(760 * 1.024);
    const data = new Uint8Array([
      0x10, 80,
      rr1Raw & 0xFF, (rr1Raw >> 8) & 0xFF,
      rr2Raw & 0xFF, (rr2Raw >> 8) & 0xFF,
    ]);
    const result = parseHeartRateMeasurement(data);

    expect(result.heartRate).toBe(80);
    expect(result.rrIntervals.length).toBe(2);
    expect(result.rrIntervals[0]).toBeCloseTo(750, 0);
    expect(result.rrIntervals[1]).toBeCloseTo(760, 0);
  });

  test('Empty data returns defaults', () => {
    const data = new Uint8Array([]);
    const result = parseHeartRateMeasurement(data);
    expect(result.heartRate).toBe(0);
    expect(result.rrIntervals).toEqual([]);
  });

  test('Energy Expended field is skipped correctly', () => {
    // Flags: 0x18 (RR present + Energy Expended present)
    // HR: 70
    // Energy: 2 bytes (skipped)
    // RR: 850ms
    const rrRaw = Math.round(850 * 1.024);
    const data = new Uint8Array([
      0x18, 70,
      0x00, 0x00, // energy expended (ignored)
      rrRaw & 0xFF, (rrRaw >> 8) & 0xFF,
    ]);
    const result = parseHeartRateMeasurement(data);

    expect(result.heartRate).toBe(70);
    expect(result.rrIntervals.length).toBe(1);
    expect(result.rrIntervals[0]).toBeCloseTo(850, 0);
  });
});

describe('ppiFromHeartRate', () => {
  test('75 BPM → 800ms', () => {
    expect(ppiFromHeartRate(75)).toBe(800);
  });

  test('60 BPM → 1000ms', () => {
    expect(ppiFromHeartRate(60)).toBe(1000);
  });

  test('0 BPM → 0ms', () => {
    expect(ppiFromHeartRate(0)).toBe(0);
  });
});
