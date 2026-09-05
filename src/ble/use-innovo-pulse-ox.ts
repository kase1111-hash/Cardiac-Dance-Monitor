/**
 * Innovo BLE pulse oximeter hook — scans for Innovo iP900BP-B via Nordic UART
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
 * Every way of ending up 'disconnected' (scan timeout, Bluetooth off,
 * permission denied, reconnect exhausted) leaves a plain-language
 * `statusMessage` and allows connect() to be called again to retry —
 * previously the only way to retry was to switch data source in Settings.
 *
 * IMPORTANT: react-native-ble-plx is loaded via try-catch require() so the
 * app starts cleanly even if the native module is missing or crashes (Expo Go,
 * device policy, etc.). BLE features degrade gracefully to "BLE not available".
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import { BLEPPGHandler, INNOVO_PPG_SAMPLE_RATE } from './ble-ppg-handler';
import { QualityGate } from '../../shared/quality-gate';
import { PPI_DEVIATION_MAX } from '../../shared/constants';
import { debugLog, IS_DEV } from '../../shared/debug';
import { ReconnectPolicy } from './reconnect-policy';
import type {
  PulseOxInterface,
  ConnectionStatus,
  SignalQuality,
  StatusPacket,
  PPIBeat,
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

/** User-facing product name (the advertised BLE name is INNOVO_DEVICE_NAME). */
export const INNOVO_DISPLAY_NAME = 'Innovo iP900BP-B';

/**
 * Stop scanning if no matching device is found within this window. 30 s
 * rather than 15: presenters routinely select the source first and only
 * then power the oximeter and insert a finger.
 */
const SCAN_TIMEOUT_MS = 30000;
/** No notifications for this long while "connected" = stalled link → reconnect. */
const NOTIFICATION_STALL_MS = 10000;
/** How often the stall watchdog checks for silence. */
const STALL_CHECK_INTERVAL_MS = 3000;

/** FFF0 indications trigger PPG streaming on FFF1 (CCCD enable side effect). */
const FFF0_CHARACTERISTIC_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';

const MSG_NOT_FOUND =
  `No ${INNOVO_DISPLAY_NAME} found. Turn it on and insert a finger, then tap to scan again.`;
const MSG_BLUETOOTH_OFF = 'Bluetooth is off. Turn on Bluetooth, then tap to scan again.';
const MSG_BLUETOOTH_UNAUTHORIZED =
  'Bluetooth access was denied. Allow Bluetooth for this app in Settings, then tap to scan again.';
const MSG_LINK_LOST = `Lost the connection to the ${INNOVO_DISPLAY_NAME}. Tap to scan again.`;
const MSG_NO_MODULE =
  'Bluetooth needs a development build — it is not available in Expo Go.';

export interface InnovoPulseOxResult extends PulseOxInterface {
  spo2: number | null;
  perfusionIndex: number | null;
  deviceBPM: number | null;
  scanning: boolean;
  /** If BLE native module failed to load, this contains the error message */
  bleUnavailableReason: string | null;
  statusMessage: string | null;
}

// Singleton BleManager — must not be recreated per render
let sharedManager: any = null;
function getManager(): any | null {
  if (!BleManagerClass) {
    debugLog('BLE_INIT: manager is null — BleManagerClass failed to load');
    return null;
  }
  if (!sharedManager) {
    try {
      sharedManager = new BleManagerClass();
      debugLog('BLE_INIT: manager created');
    } catch (e: any) {
      console.warn('BLE_INIT: manager creation failed:', e?.message);
      return null;
    }
  }
  return sharedManager;
}

/**
 * Request Android runtime BLE permissions.
 * Returns null when granted, otherwise a user-facing explanation.
 *
 * Android 12+ (API 31): BLUETOOTH_SCAN is declared with
 * usesPermissionFlags="neverForLocation" (app.json + the ble-plx plugin), so
 * scanning needs no location permission and no Location Services toggle.
 * Android 11 and below still tie BLE scanning to fine location.
 */
async function requestBLEPermissions(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  debugLog('BLE_PERMS: requesting (API level=' + Platform.Version + ')');

  if (Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    const allGranted = Object.values(result).every(
      v => v === PermissionsAndroid.RESULTS.GRANTED,
    );
    debugLog('BLE_PERMS: granted=' + allGranted, JSON.stringify(result));
    if (!allGranted) {
      return 'Bluetooth permission was denied. Allow "Nearby devices" for this app in Settings, then tap to scan again.';
    }
    return null;
  }

  // Android < 12: location is what gates BLE scanning
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location Permission',
      message: 'On this Android version, Bluetooth scanning requires the Location permission.',
      buttonPositive: 'OK',
    },
  );
  debugLog('BLE_PERMS: granted=' + (granted === PermissionsAndroid.RESULTS.GRANTED));
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
    return 'Location permission was denied. On this Android version Bluetooth scanning needs it — allow it in Settings, then tap to scan again.';
  }
  return null;
}

/** useRef that constructs its value once, instead of on every render. */
function useLazyRef<T>(factory: () => T): { current: T } {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = factory();
  return ref as { current: T };
}

/**
 * @param deviationTolerance - Fractional deviation from the running median
 *   beyond which a beat counts against the signal-quality badge. Does not
 *   affect which beats reach the pipeline. Defaults to PPI_DEVIATION_MAX.
 */
export function useInnovoPulseOx(
  deviationTolerance: number = PPI_DEVIATION_MAX,
): InnovoPulseOxResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [latestBeat, setLatestBeat] = useState<PPIBeat | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [spo2, setSpo2] = useState<number | null>(null);
  const [deviceBPM, setDeviceBPM] = useState<number | null>(null);
  const [perfusionIndex, setPerfusionIndex] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Lazy-init: plain useRef(new X()) constructs a throwaway object on every
  // render (BLEPPGHandler builds a PPGProcessor + Butterworth coefficients).
  const handler = useLazyRef(() => new BLEPPGHandler(INNOVO_PPG_SAMPLE_RATE));
  const qualityGate = useLazyRef(() => new QualityGate(deviationTolerance));
  const reconnectPolicy = useLazyRef(() => new ReconnectPolicy());

  const seqRef = useRef(0);
  const subscriptionRef = useRef<any>(null);
  const fff0SubRef = useRef<any>(null);
  const disconnectSubRef = useRef<any>(null);
  const deviceRef = useRef<any>(null);
  const activeRef = useRef(false);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastNotificationAtRef = useRef(0);
  const unavailableAlertShownRef = useRef(false);
  // Breaks the setupConnectedDevice ↔ scheduleReconnect callback cycle
  const scheduleReconnectRef = useRef<(deviceId: string) => void>(() => {});

  const clearDeviceReadings = useCallback(() => {
    setSpo2(null);
    setDeviceBPM(null);
    setPerfusionIndex(null);
  }, []);

  const wireHandler = useCallback(() => {
    handler.current.onPPI = (ppi: number) => {
      const valid = qualityGate.current.check(ppi);
      if (valid) {
        seqRef.current++;
        setLatestPPI(ppi);
        // Sequence number guarantees a new identity even when two consecutive
        // PPIs are numerically equal — otherwise React bails out and the beat
        // is silently lost.
        setLatestBeat({ ppi, seq: seqRef.current });
      }
      setSignalQuality(qualityGate.current.getQualityLevel());
    };

    handler.current.onFingerPresenceChange = (present: boolean) => {
      if (!present) {
        setSignalQuality('poor');
        // A reading from a finger that is no longer in the sensor is not a
        // reading — the SpO2 card must not keep showing it under a
        // "signal lost" banner.
        clearDeviceReadings();
      }
    };

    handler.current.onStatus = (status: StatusPacket) => {
      // > 0, not >= 0: a device still acquiring emits 0, and "SpO2 0%" is an
      // alarming, meaningless reading. Show nothing until it's real — and
      // clear a previous value once the device stops reporting one.
      setSpo2(status.spo2 > 0 ? status.spo2 : null);
      setDeviceBPM(status.bpm > 0 ? status.bpm : null);
      setPerfusionIndex(status.perfusionIndex > 0 ? status.perfusionIndex : null);
    };
  }, [clearDeviceReadings, handler, qualityGate]);

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

  /** Leave the hook idle with an explanation the monitor can show. */
  const failDisconnected = useCallback((message: string | null) => {
    activeRef.current = false;
    setScanning(false);
    setConnectionStatus('disconnected');
    setSignalQuality('disconnected');
    setStatusMessage(message);
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

    // Enumerate services/characteristics — diagnostics only
    if (IS_DEV) {
      try {
        const services = await discovered.services();
        debugLog('BLE_DISCOVERY: found ' + services.length + ' services');
        for (const svc of services) {
          debugLog('BLE_DISCOVERY:   service=' + svc.uuid);
          const chars = await svc.characteristics();
          for (const ch of chars) {
            debugLog('BLE_DISCOVERY:     char=' + ch.uuid + ' notify=' + ch.isNotifiable + ' indicate=' + ch.isIndicatable);
          }
        }
      } catch (discErr: any) {
        debugLog('BLE_DISCOVERY: enumeration failed: ' + discErr.message);
      }
    }

    // 500ms settling time — some Android BLE stacks need this after
    // service discovery before subscriptions work reliably
    await new Promise(resolve => setTimeout(resolve, 500));

    // Abandon setup if the user disconnected or switched source during the
    // awaits above — otherwise we create subscriptions and an interval that
    // nothing will ever tear down.
    if (!activeRef.current) {
      console.log('BLE_SETUP: aborted — no longer active');
      connected.cancelConnection().catch(() => {});
      return;
    }

    let firstNotification = true;
    lastNotificationAtRef.current = Date.now();

    // Single subscription via manager-level API (confirmed working in testing)
    subscriptionRef.current = manager.monitorCharacteristicForDevice(
      discovered.id,
      NORDIC_UART_SERVICE_UUID,
      INNOVO_PPG_CHARACTERISTIC_UUID,
      (err: any, characteristic: any) => {
        if (err) {
          debugLog('BLE_ERROR: notification error: ' + err.message);
          return;
        }
        if (!characteristic?.value) return;

        if (firstNotification) {
          console.log('BLE_SUBSCRIBE: active — first notification received');
          firstNotification = false;
          // Reset backoff only once DATA actually flows. Resetting merely on
          // connect let a connected-but-silent link (CCCD enable dropped,
          // firmware in BP mode) cycle connect → stall → reconnect forever,
          // because attempts never accumulated toward the give-up cap.
          reconnectPolicy.current.reset();
        }

        lastNotificationAtRef.current = Date.now();
        const bytes = base64ToBytes(characteristic.value);
        handler.current.handleNotification(bytes, Date.now());
      },
      'txn_innovo_ppg',
    );

    // Subscribe to FFF0 indications to trigger PPG streaming on FFF1.
    // The device starts sending PPG data when its CCCD descriptor gets
    // the indicate-enable write ([0x02, 0x00] to 0x2902), which
    // monitorCharacteristicForDevice does automatically.
    fff0SubRef.current = manager.monitorCharacteristicForDevice(
      discovered.id,
      NORDIC_UART_SERVICE_UUID,
      FFF0_CHARACTERISTIC_UUID,
      (err: any, char: any) => {
        if (err) {
          debugLog('BLE_FFF0_INDICATE: error: ' + err.message);
          return;
        }
        if (char?.value) debugLog('BLE_FFF0_INDICATE:', char.value);
      },
      'txn_fff0_trigger',
    );
    console.log('BLE_SUBSCRIBE: FFF1 + FFF0 subscriptions created');

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

    setConnectionStatus('connected');
    setStatusMessage(null);
    setSignalQuality('poor'); // upgrades as data flows
  }, [handler, reconnectPolicy]);

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
    clearDeviceReadings();
    // Fresh gate too: a stale running median from before the dropout would
    // mis-flag the first beats after reconnect if the rate changed meanwhile.
    qualityGate.current = new QualityGate(deviationTolerance);
    wireHandler();

    const delay = reconnectPolicy.current.nextDelayMs();
    if (delay === null) {
      console.log('BLE_RECONNECT: giving up after ' + reconnectPolicy.current.attemptCount + ' attempts');
      reconnectPolicy.current.reset();
      failDisconnected(MSG_LINK_LOST);
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
  }, [setupConnectedDevice, wireHandler, clearDeviceReadings, failDisconnected, deviationTolerance, handler, qualityGate, reconnectPolicy]);
  scheduleReconnectRef.current = scheduleReconnect;

  const connect = useCallback(async (_deviceId?: string) => {
    if (activeRef.current) return;

    // Check if BLE native module is available
    const manager = getManager();
    if (!manager) {
      console.warn('BLE_CONNECT_BLOCKED: native module not available');
      setStatusMessage(MSG_NO_MODULE);
      // Alert once — this runs on every source change while a BLE source is
      // selected, and a dialog per switch made PPG-validation mode unusable.
      if (!unavailableAlertShownRef.current) {
        unavailableAlertShownRef.current = true;
        Alert.alert(
          'Bluetooth Not Available',
          bleLoadError || 'The Bluetooth module failed to load. BLE features require a development build (not Expo Go).',
        );
      }
      return;
    }

    // Claim the slot BEFORE any await. Setting this after the permission
    // await left a window where two rapid source switches both passed the
    // guard, started two scans, and orphaned the first scan timeout — which
    // later fired and marked a live streaming connection "disconnected".
    activeRef.current = true;
    setStatusMessage(null);
    setConnectionStatus('connecting');

    const permissionProblem = await requestBLEPermissions();
    // disconnect() may have run while the system dialog was open.
    if (!activeRef.current) return;
    if (permissionProblem) {
      failDisconnected(permissionProblem);
      return;
    }

    handler.current.reset();
    qualityGate.current = new QualityGate(deviationTolerance);
    reconnectPolicy.current.reset();
    wireHandler();
    clearDeviceReadings();

    // Bluetooth must be on. Do not wait indefinitely for it (that pinned the
    // header at "Scanning..." forever with no hint); on Android ask the
    // adapter to enable, then either proceed or explain.
    let state: string = 'Unknown';
    try {
      state = await manager.state();
    } catch (e: any) {
      debugLog('BLE_STATE: state() failed: ' + (e?.message || e));
    }
    if (!activeRef.current) return;
    debugLog('BLE_STATE: adapter=' + state);
    if (state !== 'PoweredOn') {
      let poweredOn = false;
      if (Platform.OS === 'android' && typeof manager.enable === 'function') {
        try {
          await manager.enable();
          poweredOn = (await manager.state()) === 'PoweredOn';
        } catch (e: any) {
          debugLog('BLE_STATE: enable() failed: ' + (e?.message || e));
        }
      }
      if (!activeRef.current) return;
      if (!poweredOn) {
        failDisconnected(state === 'Unauthorized' ? MSG_BLUETOOTH_UNAUTHORIZED : MSG_BLUETOOTH_OFF);
        return;
      }
    }

    setConnectionStatus('scanning');
    setScanning(true);
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
          failDisconnected('Bluetooth scan failed (' + error.message + '). Tap to scan again.');
          return;
        }
        if (!device) return;

        debugLog('BLE_SCAN: found device=' + (device.name || device.localName || '(unnamed)') + ' id=' + device.id);

        // Match by name or by specific deviceId
        const nameMatch = device.name?.includes(INNOVO_DEVICE_NAME)
          || device.localName?.includes(INNOVO_DEVICE_NAME);
        if (_deviceId && device.id !== _deviceId) return;
        if (!_deviceId && !nameMatch) return;

        // Found the device — stop scanning and connect
        console.log('BLE_SCAN: matched ' + device.id + ' — stopping scan');
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
        manager.stopDeviceScan();
        setScanning(false);
        setConnectionStatus('connecting');

        try {
          const connected = await device.connect({ timeout: 10000 });
          await setupConnectedDevice(manager, connected);
        } catch (err: any) {
          console.log('BLE_ERROR: connect failed: ' + (err?.message || err));
          // Setup can throw after it has already opened the device and created
          // the FFF1 subscription (e.g. FFF0 missing on some firmware). Without
          // this teardown the link stayed open and streaming while the UI said
          // "disconnected", and the next connect() opened a second one.
          teardownConnection();
          failDisconnected(`Could not connect to the ${INNOVO_DISPLAY_NAME}. Tap to scan again.`);
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
      failDisconnected(MSG_NOT_FOUND);
    }, SCAN_TIMEOUT_MS);
  }, [wireHandler, setupConnectedDevice, teardownConnection, clearDeviceReadings, failDisconnected, deviationTolerance, handler, qualityGate, reconnectPolicy]);

  const disconnect = useCallback(() => {
    activeRef.current = false;
    clearTimers();
    // Use the manager only if one already exists. Constructing it here
    // (getManager) instantiated CBCentralManager on iOS at first mount — even
    // in Simulated mode — which popped the Bluetooth permission dialog on top
    // of the onboarding intro.
    if (sharedManager) {
      try { sharedManager.stopDeviceScan(); } catch { /* not scanning */ }
    }
    setScanning(false);

    teardownConnection();

    handler.current.reset();
    reconnectPolicy.current.reset();
    setConnectionStatus('disconnected');
    setStatusMessage(null);
    setLatestPPI(null);
    setLatestBeat(null);
    setSignalQuality('disconnected');
    clearDeviceReadings();
  }, [clearTimers, teardownConnection, clearDeviceReadings, handler, reconnectPolicy]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      clearTimers();
      teardownConnection();
    };
  }, [clearTimers, teardownConnection]);

  return useMemo(() => ({
    devices: [],
    connect,
    disconnect,
    connectionStatus,
    latestPPI,
    latestBeat,
    signalQuality,
    sourceName: INNOVO_DISPLAY_NAME,
    statusMessage,
    spo2,
    perfusionIndex,
    deviceBPM,
    scanning,
    bleUnavailableReason: BleManagerClass ? null : (bleLoadError || 'BLE module not loaded'),
  }), [
    connect, disconnect, connectionStatus, latestPPI, latestBeat, signalQuality,
    statusMessage, spo2, perfusionIndex, deviceBPM, scanning,
  ]);
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
