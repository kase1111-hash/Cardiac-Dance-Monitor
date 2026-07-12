/**
 * Innovo BLE pulse oximeter hook — scans for Innovo iP900BPB via Nordic UART
 * service, connects, subscribes to 0xFFF1 notifications, and routes data
 * through BLEPPGHandler.
 *
 * Characteristic 0xFFF1 delivers two packet types:
 *   - 2 bytes starting with 0x01: raw PPG waveform at ~28 Hz
 *     → byte[1] = intensity (0-255) → PPGProcessor → PPIs
 *   - 13 bytes starting with 0x3E, ending with 0xF0: status packet ~1/sec
 *     → byte[1]=SpO2%, byte[3]=BPM, byte[11]=Perfusion Index
 *
 * Exposes PulseOxInterface + SpO2/PI for the monitor pipeline.
 *
 * Link resilience:
 *   - onDisconnected listener catches unexpected link loss (battery, range)
 *     so the UI never shows stale data as "connected"
 *   - Notification stall watchdog forces a reconnect when the link stays up
 *     but the data stream silently stops
 *   - Auto-reconnect with exponential backoff (ReconnectPolicy); reports
 *     'reconnecting' status, gives up to 'disconnected' after max attempts
 *
 * IMPORTANT: react-native-ble-plx is loaded via try-catch require() so the
 * app starts cleanly even if the native module is missing or crashes (Expo Go,
 * device policy, etc.). BLE features degrade gracefully to "BLE not available".
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import { BLEPPGHandler, INNOVO_PPG_SAMPLE_RATE } from './ble-ppg-handler';
import { QualityGate } from '../../shared/quality-gate';
import { ReconnectPolicy } from './reconnect-policy';
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

/** Stop scanning if no matching device is found within this window. */
const SCAN_TIMEOUT_MS = 15000;
/** No notifications for this long while "connected" = stalled link → reconnect. */
const NOTIFICATION_STALL_MS = 10000;
/** How often the stall watchdog checks for silence. */
const STALL_CHECK_INTERVAL_MS = 3000;

/** FFF0 indications trigger PPG streaming on FFF1 (CCCD enable side effect). */
const FFF0_CHARACTERISTIC_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

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
  const reconnectPolicy = useRef(new ReconnectPolicy());
  const subscriptionRef = useRef<any>(null);
  const fff0SubRef = useRef<any>(null);
  const disconnectSubRef = useRef<any>(null);
  const deviceRef = useRef<any>(null);
  const activeRef = useRef(false);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNotificationAtRef = useRef(0);
  // Breaks the setupConnectedDevice ↔ scheduleReconnect callback cycle
  const scheduleReconnectRef = useRef<(deviceId: string) => void>(() => {});

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

  const clearTimers = useCallback(() => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (stallIntervalRef.current) {
      clearInterval(stallIntervalRef.current);
      stallIntervalRef.current = null;
    }
  }, []);

  /** Remove all subscriptions and drop the device connection. */
  const teardownConnection = useCallback(() => {
    if (disconnectSubRef.current) {
      disconnectSubRef.current.remove();
      disconnectSubRef.current = null;
    }
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (fff0SubRef.current) {
      fff0SubRef.current.remove();
      fff0SubRef.current = null;
    }
    if (deviceRef.current) {
      deviceRef.current.cancelConnection().catch(() => {});
      deviceRef.current = null;
    }
  }, []);

  /**
   * Discover services, subscribe to PPG notifications, and arm the disconnect
   * listener + stall watchdog on an already-connected device.
   * Shared by the initial connect and every auto-reconnect attempt.
   */
  const setupConnectedDevice = useCallback(async (manager: any, connected: any) => {
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

    let firstNotification = true;
    lastNotificationAtRef.current = Date.now();

    // Single subscription via manager-level API (confirmed working in testing)
    console.log('BLE_SUBSCRIBE: monitorCharacteristicForDevice(' + discovered.id + ', ' + NORDIC_UART_SERVICE_UUID + ', ' + INNOVO_PPG_CHARACTERISTIC_UUID + ')');
    subscriptionRef.current = manager.monitorCharacteristicForDevice(
      discovered.id,
      NORDIC_UART_SERVICE_UUID,
      INNOVO_PPG_CHARACTERISTIC_UUID,
      (err: any, characteristic: any) => {
        if (err) {
          console.log('BLE_ERROR: notification error: ' + err.message);
          return;
        }
        if (!characteristic?.value) return;

        if (firstNotification) {
          console.log('BLE_SUBSCRIBE: active — first notification received');
          firstNotification = false;
        }

        lastNotificationAtRef.current = Date.now();
        const bytes = base64ToBytes(characteristic.value);
        handler.current.handleNotification(bytes, Date.now());
      },
      'txn_innovo_ppg',
    );
    console.log('BLE_MONITOR: FFF1 subscription created');

    // Subscribe to FFF0 indications to trigger PPG streaming on FFF1.
    // The device starts sending PPG data when its CCCD descriptor gets
    // the indicate-enable write ([0x02, 0x00] to 0x2902), which
    // monitorCharacteristicForDevice does automatically.
    console.log('BLE_TRIGGER: subscribing to FFF0 indications to start PPG stream');
    fff0SubRef.current = manager.monitorCharacteristicForDevice(
      discovered.id,
      NORDIC_UART_SERVICE_UUID,
      FFF0_CHARACTERISTIC_UUID,
      (err: any, char: any) => {
        if (err) {
          console.log('BLE_FFF0_INDICATE: error: ' + err.message);
          return;
        }
        if (char?.value) {
          console.log('BLE_FFF0_INDICATE:', char.value);
        }
      },
      'txn_fff0_trigger',
    );
    console.log('BLE_TRIGGER: FFF0 indication subscription created — device should start streaming');

    // Unexpected link loss (battery, range): never leave a stale "connected".
    disconnectSubRef.current = connected.onDisconnected((error: any, dev: any) => {
      console.log('BLE_DISCONNECTED: ' + (error?.message ?? 'link closed'));
      if (activeRef.current) {
        scheduleReconnectRef.current(dev?.id ?? discovered.id);
      }
    });

    // Stall watchdog: the link can stay "up" while notifications silently
    // stop (sleeve pressure, firmware hiccup). Force a reconnect cycle —
    // cancelConnection fires onDisconnected, which schedules the reconnect.
    if (stallIntervalRef.current) clearInterval(stallIntervalRef.current);
    stallIntervalRef.current = setInterval(() => {
      const silence = Date.now() - lastNotificationAtRef.current;
      if (silence > NOTIFICATION_STALL_MS) {
        console.log('BLE_STALL: no notifications for ' + silence + 'ms — forcing reconnect');
        deviceRef.current?.cancelConnection().catch(() => {});
      }
    }, STALL_CHECK_INTERVAL_MS);

    reconnectPolicy.current.reset();
    setConnectionStatus('connected');
    setSignalQuality('poor'); // upgrades as data flows
  }, []);

  /**
   * Schedule an auto-reconnect attempt with exponential backoff.
   * Gives up to 'disconnected' once the policy's attempts are exhausted.
   */
  const scheduleReconnect = useCallback((deviceId: string) => {
    // Drop the dead connection's subscriptions before retrying
    if (disconnectSubRef.current) {
      disconnectSubRef.current.remove();
      disconnectSubRef.current = null;
    }
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (fff0SubRef.current) {
      fff0SubRef.current.remove();
      fff0SubRef.current = null;
    }
    if (stallIntervalRef.current) {
      clearInterval(stallIntervalRef.current);
      stallIntervalRef.current = null;
    }
    deviceRef.current = null;
    handler.current.reset();
    wireHandler();

    const delay = reconnectPolicy.current.nextDelayMs();
    if (delay === null) {
      console.log('BLE_RECONNECT: giving up after ' + reconnectPolicy.current.attemptCount + ' attempts');
      activeRef.current = false;
      reconnectPolicy.current.reset();
      setConnectionStatus('disconnected');
      setSignalQuality('disconnected');
      return;
    }

    console.log('BLE_RECONNECT: attempt ' + reconnectPolicy.current.attemptCount + ' in ' + delay + 'ms');
    setConnectionStatus('reconnecting');
    setSignalQuality('disconnected');

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      if (!activeRef.current) return;
      const manager = getManager();
      if (!manager) {
        scheduleReconnectRef.current(deviceId);
        return;
      }
      try {
        const connected = await manager.connectToDevice(deviceId, { timeout: 10000 });
        await setupConnectedDevice(manager, connected);
        console.log('BLE_RECONNECT: reconnected');
      } catch (e: any) {
        console.log('BLE_RECONNECT: attempt failed: ' + (e?.message || e));
        if (activeRef.current) {
          scheduleReconnectRef.current(deviceId);
        }
      }
    }, delay);
  }, [setupConnectedDevice, wireHandler]);
  scheduleReconnectRef.current = scheduleReconnect;

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
    reconnectPolicy.current.reset();
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

    manager.startDeviceScan(
      [NORDIC_UART_SERVICE_UUID],
      { allowDuplicates: false },
      async (error: any, device: any) => {
        if (error) {
          console.log('BLE_ERROR: scan error: ' + error.message);
          if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
            scanTimeoutRef.current = null;
          }
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
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
        manager.stopDeviceScan();
        setScanning(false);
        setConnectionStatus('connecting');

        try {
          console.log('BLE_CONNECT: connecting to ' + device.id);
          const connected = await device.connect({ timeout: 10000 });
          await setupConnectedDevice(manager, connected);
        } catch (err: any) {
          console.log('BLE_ERROR: connect failed: ' + (err?.message || err));
          setConnectionStatus('disconnected');
          activeRef.current = false;
        }
      },
    );

    // Scan timeout — cleared on match/error above, so if it fires we are
    // still scanning with nothing found. (Reading React state here would be
    // stale: this closure captured the values from before the scan started.)
    scanTimeoutRef.current = setTimeout(() => {
      scanTimeoutRef.current = null;
      console.log('BLE_SCAN: no matching device after ' + SCAN_TIMEOUT_MS + 'ms — stopping scan');
      manager.stopDeviceScan();
      setScanning(false);
      setConnectionStatus('disconnected');
      activeRef.current = false;
    }, SCAN_TIMEOUT_MS);
  }, [wireHandler, setupConnectedDevice]);

  const disconnect = useCallback(() => {
    activeRef.current = false;
    clearTimers();
    const manager = getManager();
    if (manager) {
      manager.stopDeviceScan();
    }
    setScanning(false);

    teardownConnection();

    handler.current.reset();
    reconnectPolicy.current.reset();
    setConnectionStatus('disconnected');
    setLatestPPI(null);
    setSignalQuality('disconnected');
    setSpo2(null);
    setDeviceBPM(null);
    setPerfusionIndex(null);
  }, [clearTimers, teardownConnection]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearTimers();
      teardownConnection();
    };
  }, [clearTimers, teardownConnection]);

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
