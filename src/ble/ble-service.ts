/**
 * BLE pulse oximeter service — scans for devices advertising Heart Rate Service
 * (0x180D) or Nordic UART Service (6e400001-...), connects, subscribes to
 * notifications, and parses data per the relevant protocol.
 *
 * Two BLE modes:
 * - Standard HR (0x180D): Heart Rate Measurement (0x2A37) → HR + RR intervals
 * - Raw PPG via Nordic UART: Two packet types on TX characteristic (6e400003-...):
 *     • Short (2 bytes):  raw PPG waveform at 28 Hz → PPGProcessor → PPIs
 *     • Long  (13 bytes): computed SpO2/BPM/PI once per second → display + validation
 *
 * Protocol decoded from Innovo iP900BP-B real device captures.
 * See innovo-ble-protocol.md for full documentation.
 */

// --- Standard Heart Rate Service UUIDs ---
export const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// --- Nordic UART Service UUIDs (Innovo iP900BP-B and similar) ---
export const NORDIC_UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NORDIC_UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify
export const NORDIC_UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // write

// --- Innovo PPG characteristic (advertised under Nordic UART service) ---
// The actual data characteristic is 0xFFF1, not the Nordic UART TX UUID.
export const INNOVO_PPG_CHARACTERISTIC_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';

// Innovo device name prefix for scan filtering
export const INNOVO_DEVICE_NAME = 'iP900BPB';

// Legacy aliases — kept for backward compatibility with any code referencing old names
export const PPG_SERVICE_UUID = NORDIC_UART_SERVICE_UUID;
export const PPG_CHARACTERISTIC_UUID = INNOVO_PPG_CHARACTERISTIC_UUID;

/** Short-form UUIDs for scan filtering */
export const SCAN_SERVICE_UUIDS = [
  HEART_RATE_SERVICE_UUID,
  NORDIC_UART_SERVICE_UUID,
];

/**
 * BLE operating mode — determined by which service the device advertises.
 * - standard_hr: Device exposes 0x180D Heart Rate Service with RR intervals
 * - raw_ppg: Device exposes Nordic UART Service with raw waveform + status packets
 */
export type BLEMode = 'standard_hr' | 'raw_ppg';

export interface BLEDevice {
  id: string;
  name: string | null;
  rssi: number;
  /** Which services the device advertises, used to select BLE mode */
  advertisedServices?: string[];
}

export type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected';
export type SignalQuality = 'good' | 'fair' | 'poor' | 'disconnected';

export interface PulseOxInterface {
  devices: BLEDevice[];
  connect: (deviceId: string) => void;
  disconnect: () => void;
  connectionStatus: ConnectionStatus;
  latestPPI: number | null;
  signalQuality: SignalQuality;
  /** Source identifier for display */
  sourceName: string;
}

/**
 * Parse a BLE Heart Rate Measurement (0x2A37) characteristic value.
 * Returns heart rate (BPM) and any RR intervals present.
 *
 * Per Bluetooth GATT spec:
 * - Byte 0 (Flags): Bit 0 = HR format (0=uint8, 1=uint16), Bit 4 = RR present
 * - Byte 1 (or 1-2): Heart Rate
 * - Remaining bytes if RR flag set: pairs of uint16 in 1/1024 second units
 */
export function parseHeartRateMeasurement(data: Uint8Array): {
  heartRate: number;
  rrIntervals: number[]; // in milliseconds
} {
  if (data.length < 2) {
    return { heartRate: 0, rrIntervals: [] };
  }

  const flags = data[0];
  const hrIs16Bit = (flags & 0x01) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let heartRate: number;
  let offset: number;

  if (hrIs16Bit) {
    heartRate = data[1] | (data[2] << 8);
    offset = 3;
  } else {
    heartRate = data[1];
    offset = 2;
  }

  // Skip Energy Expended if present (bit 3)
  if ((flags & 0x08) !== 0) {
    offset += 2;
  }

  const rrIntervals: number[] = [];
  if (rrPresent) {
    while (offset + 1 < data.length) {
      const rrRaw = data[offset] | (data[offset + 1] << 8);
      // Convert from 1/1024 seconds to milliseconds
      const rrMs = Math.round(rrRaw / 1.024);
      rrIntervals.push(rrMs);
      offset += 2;
    }
  }

  return { heartRate, rrIntervals };
}

/**
 * Derive PPI from heart rate when RR intervals are not available.
 * Fallback only — true RR intervals are preferred.
 */
export function ppiFromHeartRate(bpm: number): number {
  if (bpm <= 0) return 0;
  return Math.round(60000 / bpm);
}

// ---------------------------------------------------------------------------
// Nordic UART PPG packet types (Innovo protocol)
// ---------------------------------------------------------------------------

/**
 * Raw PPG packet — 2 bytes, received at ~28 Hz.
 * - Byte 0: Status/channel (0x01 = finger present, other = finger removed)
 * - Byte 1: PPG intensity (0x00–0xFF)
 */
export interface RawPPGPacket {
  type: 'raw';
  fingerPresent: boolean;
  intensity: number; // 0-255
}

/**
 * Status packet — 13 bytes, received ~1/second.
 * Contains device-computed vitals: SpO2, BPM, perfusion index.
 *
 * Byte layout (from real device captures):
 *   [0]    0x3E  header/sync byte
 *   [1]    SpO2 percentage (0-100, or 127 = invalid/searching)
 *   [2]    reserved
 *   [3]    BPM (heart rate)
 *   [4]    reserved
 *   [5]    unknown (signal quality?)
 *   [6-10] Reserved / waveform metadata (ignored)
 *   [11]   Perfusion Index × 10 (e.g. 54 = PI 5.4%)
 *   [12]   0xF0  trailer/sync byte
 */
export interface StatusPacket {
  type: 'status';
  fingerPresent: boolean;
  searching: boolean;
  bpm: number;
  spo2: number;        // 0-100, or -1 if invalid
  perfusionIndex: number; // 0.0-25.5 (tenths)
}

/** Discriminated union of both packet types */
export type InnovoPacket = RawPPGPacket | StatusPacket;

/**
 * Parse an Innovo PPG notification from characteristic 0xFFF1.
 * Discriminates packet type by length and header/trailer bytes:
 * - 2 bytes starting with 0x01 → raw PPG sample (28 Hz)
 * - 13 bytes starting with 0x3E and ending with 0xF0 → status/vitals (1 Hz)
 */
export function parseInnovoPacket(data: Uint8Array): InnovoPacket | null {
  if (data.length === 2) {
    return parseRawPPGPacket(data);
  }
  if (data.length >= 13 && data[0] === 0x3E && data[12] === 0xF0) {
    return parseStatusPacket(data);
  }
  return null;
}

/**
 * Parse a 2-byte raw PPG packet.
 */
export function parseRawPPGPacket(data: Uint8Array): RawPPGPacket | null {
  if (data.length < 2) {
    return null;
  }
  const status = data[0];
  const intensity = data[1];
  const fingerPresent = status === 0x01;
  return { type: 'raw', fingerPresent, intensity };
}

/**
 * Parse a 13-byte status packet (0x3E header, 0xF0 trailer).
 *
 * Real byte layout from device captures:
 *   [0]=0x3E  [1]=SpO2  [2]=reserved  [3]=BPM  [4]=reserved
 *   [5]=unknown  [6-10]=reserved  [11]=PI×10  [12]=0xF0
 */
export function parseStatusPacket(data: Uint8Array): StatusPacket | null {
  if (data.length < 13) {
    return null;
  }

  const spo2Raw = data[1];
  const bpm = data[3];
  const piRaw = data[11];

  // 127 (0x7F) or >100 means invalid / still searching
  const spo2 = spo2Raw === 127 || spo2Raw > 100 ? -1 : spo2Raw;
  const searching = spo2 === -1;
  // Finger present if we're getting valid-ish readings
  const fingerPresent = bpm > 0 || (spo2Raw > 0 && spo2Raw !== 127);
  const perfusionIndex = piRaw / 10;

  return {
    type: 'status',
    fingerPresent,
    searching,
    bpm,
    spo2,
    perfusionIndex,
  };
}

// Legacy wrapper — parsePPGPacket returns the old PPGPacket shape for
// backward compatibility with existing tests.
export interface PPGPacket {
  fingerPresent: boolean;
  intensity: number; // 0-255
}

export function parsePPGPacket(data: Uint8Array): PPGPacket | null {
  if (data.length < 2) {
    return null;
  }
  const status = data[0];
  const intensity = data[1];
  const fingerPresent = status === 0x01;
  return { fingerPresent, intensity };
}

/**
 * Determine BLE mode from advertised service UUIDs.
 * Prefers raw PPG if Nordic UART service is advertised (more data).
 */
export function detectBLEMode(serviceUUIDs: string[]): BLEMode {
  const lower = serviceUUIDs.map(s => s.toLowerCase());
  // Check for Nordic UART service (full or short form)
  if (lower.some(s => s.includes('6e400001') || s.includes('fff0'))) {
    return 'raw_ppg';
  }
  return 'standard_hr';
}
