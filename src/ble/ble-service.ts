/**
 * BLE pulse oximeter service — scans for devices advertising Heart Rate Service
 * (0x180D) or Nordic-style PPG Service (0xFFF0), connects, subscribes to
 * notifications, and parses data per the relevant protocol.
 *
 * Two BLE modes:
 * - Standard HR (0x180D): Heart Rate Measurement (0x2A37) → HR + RR intervals
 * - Raw PPG (0xFFF0): PPG waveform (0xFFF1) → intensity stream → PPGProcessor → PPIs
 *
 * This module defines the shared interface. The real BLE implementation requires
 * react-native-ble-plx and a physical device. The simulated version is in
 * use-simulated-pulse-ox.ts.
 */

// --- Standard Heart Rate Service UUIDs ---
export const HEART_RATE_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb';
export const HEART_RATE_MEASUREMENT_UUID = '00002a37-0000-1000-8000-00805f9b34fb';

// --- Nordic-style PPG Service UUIDs (Innovo iP900BP-B and similar) ---
export const PPG_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
export const PPG_CHARACTERISTIC_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';

/** Short-form UUIDs for scan filtering */
export const SCAN_SERVICE_UUIDS = [
  HEART_RATE_SERVICE_UUID,
  PPG_SERVICE_UUID,
];

/**
 * BLE operating mode — determined by which service the device advertises.
 * - standard_hr: Device exposes 0x180D Heart Rate Service with RR intervals
 * - raw_ppg: Device exposes 0xFFF0 Nordic PPG Service with raw waveform data
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

/**
 * Parse a Nordic-style PPG notification (0xFFF1) from devices like Innovo iP900BP-B.
 *
 * Data format: 2 bytes per packet
 * - Byte 0: Status/channel (0x01 = finger present, other values = finger removed)
 * - Byte 1: PPG intensity (0x00–0xFF)
 *
 * When finger is removed, intensity drops to 0x00.
 */
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
 * Prefers raw PPG if both services are advertised (more data).
 */
export function detectBLEMode(serviceUUIDs: string[]): BLEMode {
  const lower = serviceUUIDs.map(s => s.toLowerCase());
  if (lower.some(s => s.includes('fff0'))) {
    return 'raw_ppg';
  }
  return 'standard_hr';
}
