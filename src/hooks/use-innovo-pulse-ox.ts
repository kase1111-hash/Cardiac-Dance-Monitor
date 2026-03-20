/**
 * Innovo BLE pulse oximeter hook — scans for devices advertising Nordic UART
 * service, connects, subscribes to TX characteristic, and routes notifications
 * through BLEPPGHandler for PPG processing + status packet parsing.
 *
 * Data flow:
 *   BLE notification (6e400003-...)
 *     → 2-byte:  raw PPG @ 28 Hz → BLEPPGHandler → PPGProcessor → PPI
 *     → 13-byte: status packet   → SpO2 / BPM / PI for display
 *
 * Requires react-native-ble-plx for actual BLE communication.
 * The handler logic (parsing, filtering, peak detection) is pure TypeScript
 * and fully testable without native modules.
 */
import { useState, useRef, useCallback } from 'react';
import { BLEPPGHandler, INNOVO_PPG_SAMPLE_RATE } from '../ble/ble-ppg-handler';
import { QualityGate } from '../../shared/quality-gate';
import type {
  PulseOxInterface,
  ConnectionStatus,
  SignalQuality,
  StatusPacket,
} from '../ble/ble-service';
import {
  NORDIC_UART_SERVICE_UUID,
  NORDIC_UART_TX_UUID,
  SCAN_SERVICE_UUIDS,
} from '../ble/ble-service';

/** Extended interface exposing SpO2 and device-reported vitals. */
export interface InnovoPulseOxResult extends PulseOxInterface {
  /** SpO2 percentage from device status packet (0-100, or -1 if unavailable). */
  spo2: number;
  /** Device-reported BPM (for display validation). */
  deviceBPM: number;
  /** Perfusion index from device (0.0-25.5). */
  perfusionIndex: number;
  /** Whether the device is still searching for a stable signal. */
  searching: boolean;
  /** Feed a raw BLE notification for testing or manual bridging. */
  feedNotification: (data: Uint8Array, timestampMs: number) => void;
}

export function useInnovoPulseOx(): InnovoPulseOxResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [spo2, setSpo2] = useState(-1);
  const [deviceBPM, setDeviceBPM] = useState(0);
  const [perfusionIndex, setPerfusionIndex] = useState(0);
  const [searching, setSearching] = useState(false);

  const handler = useRef(new BLEPPGHandler(INNOVO_PPG_SAMPLE_RATE));
  const qualityGate = useRef(new QualityGate());
  const bleManagerRef = useRef<any>(null);
  const subscriptionRef = useRef<any>(null);

  const setupHandler = useCallback(() => {
    handler.current.onPPI = (ppi: number) => {
      const valid = qualityGate.current.check(ppi);
      if (valid) {
        setLatestPPI(ppi);
      }
      setSignalQuality(qualityGate.current.getQualityLevel());
    };

    handler.current.onFingerPresenceChange = (present: boolean) => {
      if (!present) {
        setSignalQuality('poor');
      }
    };

    handler.current.onStatus = (status: StatusPacket) => {
      setSpo2(status.spo2);
      setDeviceBPM(status.bpm);
      setPerfusionIndex(status.perfusionIndex);
      setSearching(status.searching);
    };
  }, []);

  const connect = useCallback(async (deviceId?: string) => {
    // Reset handler state
    handler.current.reset();
    qualityGate.current = new QualityGate();
    setupHandler();

    setConnectionStatus('scanning');
    setSpo2(-1);
    setDeviceBPM(0);
    setPerfusionIndex(0);
    setSearching(false);

    // BLE scanning + connection via react-native-ble-plx.
    // The actual BLE manager integration is guarded behind a dynamic import
    // so the hook works in test environments without native modules.
    try {
      const BleManager = await getBleManager();
      if (!BleManager) {
        // No BLE library available — fall through to manual feed mode
        setConnectionStatus('connected');
        setSignalQuality('poor');
        return;
      }

      const manager = new BleManager();
      bleManagerRef.current = manager;

      // Scan for devices advertising Nordic UART service
      setConnectionStatus('scanning');

      manager.startDeviceScan(
        SCAN_SERVICE_UUIDS,
        { allowDuplicates: false },
        async (error: any, device: any) => {
          if (error) {
            console.warn('BLE scan error:', error);
            return;
          }

          // Connect to first device found (or specific deviceId)
          if (deviceId && device.id !== deviceId) return;

          manager.stopDeviceScan();
          setConnectionStatus('connecting');

          try {
            const connected = await device.connect();
            await connected.discoverAllServicesAndCharacteristics();

            // Subscribe to Nordic UART TX for notifications
            subscriptionRef.current = connected.monitorCharacteristicForService(
              NORDIC_UART_SERVICE_UUID,
              NORDIC_UART_TX_UUID,
              (err: any, characteristic: any) => {
                if (err) {
                  console.warn('BLE notification error:', err);
                  return;
                }
                if (characteristic?.value) {
                  // BLE-PLX gives base64, decode to Uint8Array
                  const bytes = base64ToUint8Array(characteristic.value);
                  handler.current.handleNotification(bytes, Date.now());
                }
              },
            );

            setConnectionStatus('connected');
            setSignalQuality('poor'); // will upgrade as data flows
          } catch (connectErr) {
            console.warn('BLE connect error:', connectErr);
            setConnectionStatus('disconnected');
          }
        },
      );
    } catch (err) {
      // BLE library not available — hook still works for manual feed
      setConnectionStatus('connected');
      setSignalQuality('poor');
    }
  }, [setupHandler]);

  const disconnect = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (bleManagerRef.current) {
      bleManagerRef.current.destroy();
      bleManagerRef.current = null;
    }
    handler.current.reset();
    setConnectionStatus('disconnected');
    setLatestPPI(null);
    setSignalQuality('disconnected');
    setSpo2(-1);
    setDeviceBPM(0);
    setPerfusionIndex(0);
    setSearching(false);
  }, []);

  /**
   * Manual notification feed — for testing or bridging from external BLE
   * libraries without going through react-native-ble-plx.
   */
  const feedNotification = useCallback((data: Uint8Array, timestampMs: number) => {
    handler.current.handleNotification(data, timestampMs);
  }, []);

  return {
    devices: [],
    connect,
    disconnect,
    connectionStatus,
    latestPPI,
    signalQuality,
    sourceName: 'Innovo PPG',
    spo2,
    deviceBPM,
    perfusionIndex,
    searching,
    feedNotification,
  };
}

/**
 * Dynamically import react-native-ble-plx. Returns null if not available.
 * This allows the hook to work in test environments without native modules.
 */
async function getBleManager(): Promise<any> {
  try {
    const mod = require('react-native-ble-plx');
    return mod.BleManager;
  } catch {
    return null;
  }
}

/** Decode a base64 string to Uint8Array (for BLE characteristic values). */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
