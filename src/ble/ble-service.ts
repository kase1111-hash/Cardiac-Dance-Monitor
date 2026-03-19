/**
 * BLE pulse oximeter service — scans for devices advertising Heart Rate Service
 * (0x180D), connects, subscribes to Heart Rate Measurement (0x2A37), and parses
 * HR + RR intervals per SPEC Section 1.1.
 *
 * This module defines the shared interface. The real BLE implementation requires
 * react-native-ble-plx and a physical device. The simulated version is in
 * use-simulated-pulse-ox.ts.
 */

export interface BLEDevice {
  id: string;
  name: string | null;
  rssi: number;
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
