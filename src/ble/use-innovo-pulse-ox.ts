/**
 * Innovo BLE pulse oximeter hook — scans for Innovo iP900BPB via Nordic UART
 * service, connects, subscribes to 0xFFF1 notifications, and routes data
 * through BLEPPGHandler.
 *
 * Characteristic 0xFFF1 delivers two packet types:
 *   - 2 bytes starting with 0x01: raw PPG waveform at ~28 Hz
 *     → byte[1] = intensity (0-255) → PPGProcessor → PPIs
 *   - 13 bytes starting with 0x3E, ending with 0xF0: status packet ~1/sec
 *     → byte[1]=SpO2%, byte[3]=BPM, byte[5]=Perfusion Index
 *
 * Exposes PulseOxInterface + SpO2/PI for the monitor pipeline.
 *
 * IMPORTANT: react-native-ble-plx is loaded via try-catch require() so the
 * app starts cleanly even if the native module is missing or crashes (Expo Go,
 * device policy, etc.). BLE features degrade gracefully to "BLE not available".
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import { BLEPPGHandler, INNOVO_PPG_SAMPLE_RATE } from './ble-ppg-handler';
import { QualityGate } from '../../shared/quality-gate';
import type {
  PulseOxInterface,
  ConnectionStatus,
  SignalQuality,
  StatusPacket,
} from './ble-service';
import {
  NORDIC_UART_SERVICE_UUID,
  INNOVO_PPG_CHARACTERISTIC_UUID,
  INNOVO_DEVICE_NAME,
} from './ble-service';

// --- Safe BLE module loading ---
// react-native-ble-plx crashes at module level with "Cannot read property
// 'createClient' of null" on Expo Go and some device configurations.
// Wrap in try-catch so the rest of the app keeps working.
let BleManagerClass: any = null;
let bleLoadError: string | null = null;

try {
  BleManagerClass = require('react-native-ble-plx').BleManager;
} catch (e: any) {
  bleLoadError = e?.message || 'react-native-ble-plx not available';
  console.warn('BLE_LOAD_FAILED:', bleLoadError);
}

export interface InnovoPulseOxResult extends PulseOxInterface {
  spo2: number | null;
  perfusionIndex: number | null;
  deviceBPM: number | null;
  scanning: boolean;
  /** If BLE native module failed to load, this contains the error message */
  bleUnavailableReason: string | null;
}

// Singleton BleManager — must not be recreated per render
let sharedManager: any = null;
function getManager(): any | null {
  if (!BleManagerClass) return null;
  if (!sharedManager) {
    try {
      sharedManager = new BleManagerClass();
    } catch (e: any) {
      console.warn('BLE_MANAGER_CREATE_FAILED:', e?.message);
      return null;
    }
  }
  return sharedManager;
}

/**
 * Request Android runtime BLE permissions (API 31+).
 * Returns true if all granted, false if any denied.
 */
async function requestBLEPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // Android 12+ (API 31) requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    const allGranted = Object.values(result).every(
      v => v === PermissionsAndroid.RESULTS.GRANTED,
    );
    if (!allGranted) {
      Alert.alert(
        'Bluetooth Permissions Required',
        'Please grant Bluetooth and Location permissions in Settings to connect to the Innovo pulse oximeter.',
      );
      return false;
    }
    return true;
  }

  // Android < 12: only location needed for BLE scanning
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location Permission',
      message: 'Bluetooth Low Energy scanning requires location permission.',
      buttonPositive: 'OK',
    },
  );
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    Alert.alert(
      'Location Permission Required',
      'Please grant Location permission in Settings to scan for Bluetooth devices.',
    );
    return false;
  }
  return true;
}

export function useInnovoPulseOx(): InnovoPulseOxResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [spo2, setSpo2] = useState<number | null>(null);
  const [deviceBPM, setDeviceBPM] = useState<number | null>(null);
  const [perfusionIndex, setPerfusionIndex] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);

  const handler = useRef(new BLEPPGHandler(INNOVO_PPG_SAMPLE_RATE));
  const qualityGate = useRef(new QualityGate());
  const subscriptionRef = useRef<any>(null);
  const deviceRef = useRef<any>(null);
  const activeRef = useRef(false);

  const wireHandler = useCallback(() => {
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
      if (status.spo2 >= 0) setSpo2(status.spo2);
      if (status.bpm > 0) setDeviceBPM(status.bpm);
      if (status.perfusionIndex > 0) setPerfusionIndex(status.perfusionIndex);
    };
  }, []);

  const connect = useCallback(async (_deviceId?: string) => {
    if (activeRef.current) return;

    // Check if BLE native module is available
    const manager = getManager();
    if (!manager) {
      console.warn('BLE_CONNECT_BLOCKED: native module not available');
      Alert.alert(
        'Bluetooth Not Available',
        bleLoadError || 'The Bluetooth module failed to load. BLE features require a dev build (not Expo Go).',
      );
      return;
    }

    // Request runtime permissions (Android)
    const permitted = await requestBLEPermissions();
    if (!permitted) return;

    activeRef.current = true;

    handler.current.reset();
    qualityGate.current = new QualityGate();
    wireHandler();

    setConnectionStatus('scanning');
    setScanning(true);
    setSpo2(null);
    setDeviceBPM(null);
    setPerfusionIndex(null);

    // Wait for BLE to be powered on (Android needs this)
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      await new Promise<void>((resolve) => {
        const sub = manager.onStateChange((newState: string) => {
          if (newState === 'PoweredOn') {
            sub.remove();
            resolve();
          }
        }, true);
      });
    }

    manager.startDeviceScan(
      [NORDIC_UART_SERVICE_UUID],
      { allowDuplicates: false },
      async (error: any, device: any) => {
        if (error) {
          console.warn('[Innovo] Scan error:', error.message);
          setConnectionStatus('disconnected');
          setScanning(false);
          activeRef.current = false;
          return;
        }
        if (!device) return;

        // Match by name or by specific deviceId
        const nameMatch = device.name?.includes(INNOVO_DEVICE_NAME)
          || device.localName?.includes(INNOVO_DEVICE_NAME);
        if (_deviceId && device.id !== _deviceId) return;
        if (!_deviceId && !nameMatch) return;

        // Found the device — stop scanning and connect
        manager.stopDeviceScan();
        setScanning(false);
        setConnectionStatus('connecting');

        try {
          const connected = await device.connect({ timeout: 10000 });
          await connected.discoverAllServicesAndCharacteristics();
          deviceRef.current = connected;

          // Subscribe to 0xFFF1 notifications
          subscriptionRef.current = connected.monitorCharacteristicForService(
            NORDIC_UART_SERVICE_UUID,
            INNOVO_PPG_CHARACTERISTIC_UUID,
            (err: any, characteristic: any) => {
              if (err) {
                console.warn('[Innovo] Notification error:', err.message);
                return;
              }
              if (!characteristic?.value) return;

              const bytes = base64ToBytes(characteristic.value);
              console.log('BLE_RAW', bytes.length, 'bytes:', Array.from(bytes));
              handler.current.handleNotification(bytes, Date.now());
            },
          );

          setConnectionStatus('connected');
          setSignalQuality('poor'); // upgrades as data flows
        } catch (err: any) {
          console.warn('[Innovo] Connect failed:', err?.message);
          setConnectionStatus('disconnected');
          activeRef.current = false;
        }
      },
    );

    // Scan timeout — stop after 15 seconds if nothing found
    setTimeout(() => {
      if (scanning) {
        manager.stopDeviceScan();
        setScanning(false);
        if (connectionStatus === 'scanning') {
          setConnectionStatus('disconnected');
          activeRef.current = false;
        }
      }
    }, 15000);
  }, [wireHandler]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => {
    activeRef.current = false;
    const manager = getManager();
    if (manager) {
      manager.stopDeviceScan();
    }
    setScanning(false);

    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (deviceRef.current) {
      deviceRef.current.cancelConnection().catch(() => {});
      deviceRef.current = null;
    }

    handler.current.reset();
    setConnectionStatus('disconnected');
    setLatestPPI(null);
    setSignalQuality('disconnected');
    setSpo2(null);
    setDeviceBPM(null);
    setPerfusionIndex(null);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (subscriptionRef.current) subscriptionRef.current.remove();
      if (deviceRef.current) deviceRef.current.cancelConnection().catch(() => {});
    };
  }, []);

  return {
    devices: [],
    connect,
    disconnect,
    connectionStatus,
    latestPPI,
    signalQuality,
    sourceName: 'Innovo iP900BPB',
    spo2,
    perfusionIndex,
    deviceBPM,
    scanning,
    bleUnavailableReason: BleManagerClass ? null : (bleLoadError || 'BLE module not loaded'),
  };
}

/** Decode base64 string (from BLE-PLX) to Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  // Use Buffer in RN (available via react-native polyfill)
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf);
  }
  // Fallback: atob
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
