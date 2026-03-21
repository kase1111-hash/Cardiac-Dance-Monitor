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
  if (!BleManagerClass) {
    console.log('BLE_INIT: manager is null — BleManagerClass failed to load');
    return null;
  }
  if (!sharedManager) {
    try {
      console.log('BLE_INIT: creating manager');
      sharedManager = new BleManagerClass();
      console.log('BLE_INIT: manager created successfully');
    } catch (e: any) {
      console.warn('BLE_INIT: manager creation failed:', e?.message);
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
  if (Platform.OS !== 'android') {
    console.log('BLE_PERMS: non-Android platform, skipping permission request');
    return true;
  }

  console.log('BLE_PERMS: requesting (API level=' + Platform.Version + ')');

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
    console.log('BLE_PERMS: granted=' + allGranted, JSON.stringify(result));
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
  console.log('BLE_PERMS: granted=' + (granted === PermissionsAndroid.RESULTS.GRANTED));
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
    console.log('BLE_STATE: adapter=' + state);
    if (state !== 'PoweredOn') {
      console.log('BLE_STATE: waiting for PoweredOn...');
      await new Promise<void>((resolve) => {
        const sub = manager.onStateChange((newState: string) => {
          console.log('BLE_STATE: changed to ' + newState);
          if (newState === 'PoweredOn') {
            sub.remove();
            resolve();
          }
        }, true);
      });
    }

    console.log('BLE_SCAN: starting for service ' + NORDIC_UART_SERVICE_UUID);
    let firstNotification = true;

    manager.startDeviceScan(
      [NORDIC_UART_SERVICE_UUID],
      { allowDuplicates: false },
      async (error: any, device: any) => {
        if (error) {
          console.log('BLE_ERROR: scan error: ' + error.message);
          setConnectionStatus('disconnected');
          setScanning(false);
          activeRef.current = false;
          return;
        }
        if (!device) return;

        console.log('BLE_SCAN: found device=' + (device.name || device.localName || '(unnamed)') + ' id=' + device.id);

        // Match by name or by specific deviceId
        const nameMatch = device.name?.includes(INNOVO_DEVICE_NAME)
          || device.localName?.includes(INNOVO_DEVICE_NAME);
        if (_deviceId && device.id !== _deviceId) return;
        if (!_deviceId && !nameMatch) {
          console.log('BLE_SCAN: skipping — name does not match ' + INNOVO_DEVICE_NAME);
          return;
        }

        // Found the device — stop scanning and connect
        console.log('BLE_SCAN: matched! stopping scan');
        manager.stopDeviceScan();
        setScanning(false);
        setConnectionStatus('connecting');

        try {
          console.log('BLE_CONNECT: connecting to ' + device.id);
          const connected = await device.connect({ timeout: 10000 });
          console.log('BLE_CONNECT: connected, discovering services...');
          const discovered = await connected.discoverAllServicesAndCharacteristics();
          deviceRef.current = discovered;

          // Log all discovered services and characteristics
          try {
            const services = await discovered.services();
            console.log('BLE_DISCOVERY: found ' + services.length + ' services');
            for (const svc of services) {
              console.log('BLE_DISCOVERY:   service=' + svc.uuid);
              const chars = await svc.characteristics();
              for (const ch of chars) {
                console.log('BLE_DISCOVERY:     char=' + ch.uuid + ' notify=' + ch.isNotifiable + ' indicate=' + ch.isIndicatable + ' read=' + ch.isReadable + ' write=' + ch.isWritableWithResponse);
              }
            }
          } catch (discErr: any) {
            console.log('BLE_DISCOVERY: enumeration failed: ' + discErr.message);
          }

          // 500ms settling time — some Android BLE stacks need this after
          // service discovery before subscriptions work reliably
          console.log('BLE_SETTLE: waiting 500ms after discovery...');
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('BLE_SETTLE: done');

          // Service/char UUIDs to probe
          const FFF0_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
          const FFF1_CHAR = '0000fff1-0000-1000-8000-00805f9b34fb';
          const FF00_SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
          const FF01_CHAR = '0000ff01-0000-1000-8000-00805f9b34fb';
          const CHLOE_SERVICE = '00000001-0000-6465-6d6d-65636c6f6843';
          const CHLOE_CHAR = '00000003-0000-6465-6d6d-65636c6f6843';
          const NORDIC_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

          // Shared data handler for any channel that fires
          const handleData = (bytes: Uint8Array, label: string) => {
            if (firstNotification) {
              console.log('BLE_FIRST_DATA: arrived via ' + label);
              firstNotification = false;
            }
            handler.current.handleNotification(bytes, Date.now());
          };

          // ============================================================
          // APPROACH 1: Manager-level monitorCharacteristicForDevice
          // Uses manager.monitorCharacteristicForDevice() instead of
          // device.monitorCharacteristicForService() — different code path
          // in react-native-ble-plx that may handle notifications differently.
          // Each subscription gets a unique transactionId.
          // ============================================================
          const allSubs: any[] = [];
          const pollIntervals: any[] = [];
          let txnCounter = 0;

          const monitorViaManager = (serviceUUID: string, charUUID: string, label: string) => {
            const txnId = 'txn_' + label + '_' + (txnCounter++);
            try {
              console.log('BLE_MGR_SUB_' + label + ': manager.monitorCharacteristicForDevice(' + discovered.id + ', ' + serviceUUID + ', ' + charUUID + ', txn=' + txnId + ')');
              const sub = manager.monitorCharacteristicForDevice(
                discovered.id,
                serviceUUID,
                charUUID,
                (err: any, characteristic: any) => {
                  console.log('BLE_MGR_NOTIFY_' + label + ': callback! error=' + (err?.message || 'none') + ' value=' + (characteristic?.value ? characteristic.value.substring(0, 20) : 'null'));
                  if (err) return;
                  if (!characteristic?.value) return;
                  const bytes = base64ToBytes(characteristic.value);
                  console.log('BLE_MGR_RAW_' + label, bytes.length, 'bytes:', Array.from(bytes.slice(0, 16)));
                  handleData(bytes, 'MGR_' + label);
                },
                txnId,
              );
              allSubs.push(sub);
              console.log('BLE_MGR_SUB_' + label + ': OK (txn=' + txnId + ')');
            } catch (subErr: any) {
              console.log('BLE_MGR_SUB_' + label + ': FAILED: ' + subErr.message);
            }
          };

          // Also keep device-level monitor as a parallel approach
          const monitorViaDevice = (serviceUUID: string, charUUID: string, label: string) => {
            try {
              console.log('BLE_DEV_SUB_' + label + ': device.monitorCharacteristicForService(' + serviceUUID + ', ' + charUUID + ')');
              const sub = discovered.monitorCharacteristicForService(
                serviceUUID,
                charUUID,
                (err: any, characteristic: any) => {
                  console.log('BLE_DEV_NOTIFY_' + label + ': callback! error=' + (err?.message || 'none') + ' value=' + (characteristic?.value ? characteristic.value.substring(0, 20) : 'null'));
                  if (err) return;
                  if (!characteristic?.value) return;
                  const bytes = base64ToBytes(characteristic.value);
                  console.log('BLE_DEV_RAW_' + label, bytes.length, 'bytes:', Array.from(bytes.slice(0, 16)));
                  handleData(bytes, 'DEV_' + label);
                },
              );
              allSubs.push(sub);
              console.log('BLE_DEV_SUB_' + label + ': OK');
            } catch (subErr: any) {
              console.log('BLE_DEV_SUB_' + label + ': FAILED: ' + subErr.message);
            }
          };

          // Subscribe via BOTH manager-level and device-level APIs on all channels
          const channels: [string, string, string][] = [
            [NORDIC_UART_SERVICE_UUID, INNOVO_PPG_CHARACTERISTIC_UUID, 'NORDIC_FFF1'],
            [FFF0_SERVICE, FFF1_CHAR, 'FFF0_FFF1'],
            [FF00_SERVICE, FF01_CHAR, 'FF00_FF01'],
            [CHLOE_SERVICE, CHLOE_CHAR, 'CHLOE_0003'],
            [NORDIC_UART_SERVICE_UUID, NORDIC_TX, 'NORDIC_TX'],
          ];

          for (const [svc, chr, lbl] of channels) {
            monitorViaManager(svc, chr, lbl);
            monitorViaDevice(svc, chr, lbl);
          }
          console.log('BLE_MONITOR: ' + allSubs.length + ' subscriptions created (manager + device)');

          // ============================================================
          // APPROACH 2: Polling fallback at 50ms (20 Hz)
          // If notifications are broken in ble-plx, polling via read
          // proves the data path works.
          // ============================================================
          const pollChar = (serviceUUID: string, charUUID: string, label: string) => {
            let pollCount = 0;
            let lastValue = '';
            console.log('BLE_POLL_' + label + ': starting 50ms poll on service=' + serviceUUID + ' char=' + charUUID);
            const interval = setInterval(async () => {
              try {
                const char = await discovered.readCharacteristicForService(serviceUUID, charUUID);
                if (char?.value && char.value !== lastValue) {
                  lastValue = char.value;
                  pollCount++;
                  const bytes = base64ToBytes(char.value);
                  // Log first 10 polls, then every 100th
                  if (pollCount <= 10 || pollCount % 100 === 0) {
                    console.log('BLE_POLL_' + label + ': NEW data #' + pollCount + ' ' + bytes.length + ' bytes:', Array.from(bytes.slice(0, 16)));
                  }
                  handleData(bytes, 'POLL_' + label);
                }
              } catch (_e) {
                // Silently ignore read errors — char may not be readable
                if (pollCount === 0) {
                  // Log first failure only
                  console.log('BLE_POLL_' + label + ': read failed (not readable or disconnected)');
                  clearInterval(interval);
                }
              }
            }, 50);
            pollIntervals.push(interval);
          };

          // Poll all readable+notifiable characteristics
          pollChar(NORDIC_UART_SERVICE_UUID, INNOVO_PPG_CHARACTERISTIC_UUID, 'NORDIC_FFF1');
          pollChar(FF00_SERVICE, FF01_CHAR, 'FF00_FF01');
          // FFF1 under FFF0
          pollChar(FFF0_SERVICE, FFF1_CHAR, 'FFF0_FFF1');

          // ============================================================
          // APPROACH 3: Indication characteristics
          // 0xFFF0 under Nordic UART has indicate=true. Indications use
          // a different BLE mechanism (with ACK) that may work when
          // notifications don't. monitorCharacteristicForService handles
          // both, but let's be explicit with the indicatable chars.
          // ============================================================
          const FFF0_CHAR = '0000fff0-0000-1000-8000-00805f9b34fb';
          // Try monitoring the FFF0 characteristic itself (indicate=true)
          monitorViaManager(NORDIC_UART_SERVICE_UUID, FFF0_CHAR, 'NORDIC_FFF0_IND');
          monitorViaDevice(NORDIC_UART_SERVICE_UUID, FFF0_CHAR, 'NORDIC_FFF0_IND');

          // Store combined subscription + poll cleanup
          subscriptionRef.current = {
            remove: () => {
              allSubs.forEach(s => s?.remove());
              pollIntervals.forEach(i => clearInterval(i));
            },
          };

          // --- Write start commands to trigger data streaming ---
          const writeCmd = async (serviceUUID: string, charUUID: string, data: number[], label: string) => {
            try {
              const b64 = bytesToBase64(new Uint8Array(data));
              console.log('BLE_WRITE_' + label + ': writing ' + JSON.stringify(data) + ' to service=' + serviceUUID + ' char=' + charUUID);
              await discovered.writeCharacteristicWithResponseForService(
                serviceUUID,
                charUUID,
                b64,
              );
              console.log('BLE_WRITE_' + label + ': OK');
            } catch (wErr: any) {
              console.log('BLE_WRITE_' + label + ': FAILED: ' + wErr.message);
            }
          };

          // Also try writeWithoutResponse — some chars only support one type
          const writeCmdNoResp = async (serviceUUID: string, charUUID: string, data: number[], label: string) => {
            try {
              const b64 = bytesToBase64(new Uint8Array(data));
              console.log('BLE_WRITE_NORESP_' + label + ': writing ' + JSON.stringify(data));
              await discovered.writeCharacteristicWithoutResponseForService(
                serviceUUID,
                charUUID,
                b64,
              );
              console.log('BLE_WRITE_NORESP_' + label + ': OK');
            } catch (wErr: any) {
              console.log('BLE_WRITE_NORESP_' + label + ': FAILED: ' + wErr.message);
            }
          };

          // Try writing [0x01] to FF02 and FF03 under FF00 service
          const FF02_CHAR = '0000ff02-0000-1000-8000-00805f9b34fb';
          const FF03_CHAR = '0000ff03-0000-1000-8000-00805f9b34fb';
          await writeCmd(FF00_SERVICE, FF02_CHAR, [0x01], 'FF00_FF02');
          await writeCmd(FF00_SERVICE, FF03_CHAR, [0x01], 'FF00_FF03');
          await writeCmdNoResp(FF00_SERVICE, FF02_CHAR, [0x01], 'FF00_FF02');
          await writeCmdNoResp(FF00_SERVICE, FF03_CHAR, [0x01], 'FF00_FF03');

          // Try writing [0x01] to FFF2 under Nordic UART
          const FFF2_CHAR = '0000fff2-0000-1000-8000-00805f9b34fb';
          await writeCmd(NORDIC_UART_SERVICE_UUID, FFF2_CHAR, [0x01], 'NORDIC_FFF2');
          await writeCmdNoResp(NORDIC_UART_SERVICE_UUID, FFF2_CHAR, [0x01], 'NORDIC_FFF2');

          // Try writing [0x01] to Nordic UART RX (standard write path)
          const NORDIC_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
          await writeCmd(NORDIC_UART_SERVICE_UUID, NORDIC_RX, [0x01], 'NORDIC_RX');
          await writeCmdNoResp(NORDIC_UART_SERVICE_UUID, NORDIC_RX, [0x01], 'NORDIC_RX');

          console.log('BLE_CONNECT: fully connected — ' + allSubs.length + ' monitors + ' + pollIntervals.length + ' polls active');
          setConnectionStatus('connected');
          setSignalQuality('poor'); // upgrades as data flows
        } catch (err: any) {
          console.log('BLE_ERROR: connect failed: ' + (err?.message || err));
          setConnectionStatus('disconnected');
          activeRef.current = false;
        }
      },
    );

    // Scan timeout — stop after 15 seconds if nothing found
    setTimeout(() => {
      if (scanning) {
        console.log('BLE_SCAN: no devices after 15s — timeout');
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

/** Encode Uint8Array to base64 string (for BLE-PLX descriptor writes). */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
