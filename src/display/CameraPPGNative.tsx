/**
 * Native VisionCamera implementation for Camera PPG.
 *
 * This file is NEVER imported directly by monitor.tsx or any other screen.
 * It is loaded via try-catch require() in CameraPPGView.tsx so that if
 * react-native-vision-camera crashes at module level (Expo Go, device
 * policy, missing native module, etc.), the error is caught and the rest
 * of the app continues working.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Linking, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { IS_DEV } from '../../shared/debug';

interface Props {
  onFrame: (redMean: number, timestampMs: number) => void;
  active: boolean;
  ppgState: 'idle' | 'detecting' | 'recording';
  peakCount: number;
}

const GRID_SIZE = 10;
const CROP_SIZE = 100;

// VisionCamera's frame.timestamp is in NANOSECONDS on Android (CameraX
// ImageInfo.getTimestamp) but already in MILLISECONDS on iOS
// (CMTimeGetSeconds * 1000). Dividing both by 1e6 put iOS frames 0.00003 ms
// apart, so no interval ever cleared PPI_MIN and iOS never produced a beat.
const FRAME_TIMESTAMP_DIVISOR = Platform.OS === 'ios' ? 1 : 1_000_000;

// Throttle frame logs to once per second (avoid flooding)
let lastFrameLogTime = 0;
let frameCount = 0;

function CameraPPGNative({ onFrame, active, ppgState, peakCount }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { fps: 30 },
    { videoResolution: { width: 320, height: 240 } },
  ]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Ask for the camera as soon as this mounts. Previously the only prompt was
  // a small "tap to grant" link inside a 120 px box that presenters missed.
  useEffect(() => {
    if (hasPermission) return;
    let cancelled = false;
    requestPermission().then(granted => {
      if (!cancelled && !granted) setPermissionDenied(true);
    }).catch(() => { /* prompt unavailable — the link below still works */ });
    return () => { cancelled = true; };
  }, [hasPermission, requestPermission]);

  // The camera (and torch) must not run while another tab is showing or the
  // app is in the background — otherwise the flashlight stays on and frames
  // keep flowing from a lens nobody is touching.
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setAppActive(next === 'active'));
    return () => sub.remove();
  }, []);
  const running = active && focused && appActive;

  // The parent's callback identity changes per render; route frames through a
  // ref so the runOnJS bridge and the native frame processor are built once
  // instead of being re-installed several times per second.
  const onFrameRef = useRef(onFrame);
  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  const handleRedMean = useRunOnJS((redMean: number, timestamp: number) => {
    if (IS_DEV) {
      frameCount++;
      const now = Date.now();
      if (now - lastFrameLogTime > 1000) {
        console.log('CAMERA_FRAME: red=' + redMean.toFixed(1) + ' ts=' + timestamp.toFixed(0) + ' frames/sec=' + frameCount);
        frameCount = 0;
        lastFrameLogTime = now;
      }
    }
    onFrameRef.current(redMean, timestamp);
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    const width = frame.width;
    const height = frame.height;

    const cropW = Math.min(CROP_SIZE, width);
    const cropH = Math.min(CROP_SIZE, height);
    const startX = Math.floor((width - cropW) / 2);
    const startY = Math.floor((height - cropH) / 2);

    const stepX = Math.max(1, Math.floor(cropW / GRID_SIZE));
    const stepY = Math.max(1, Math.floor(cropH / GRID_SIZE));

    const buffer = frame.toArrayBuffer();
    const data = new Uint8Array(buffer);
    const bytesPerRow = frame.bytesPerRow;
    const bytesPerPixel = 4;

    let sum = 0;
    let count = 0;

    for (let dy = 0; dy < GRID_SIZE; dy++) {
      const y = startY + dy * stepY;
      const rowOffset = y * bytesPerRow;

      for (let dx = 0; dx < GRID_SIZE; dx++) {
        const x = startX + dx * stepX;
        const pixelOffset = rowOffset + x * bytesPerPixel;

        const byte0 = data[pixelOffset];
        const byte2 = data[pixelOffset + 2];
        const red = byte0 > byte2 ? byte0 : byte2;

        sum += red;
        count++;
      }
    }

    const redMean = count > 0 ? sum / count : 0;
    const timestamp = frame.timestamp / FRAME_TIMESTAMP_DIVISOR;

    handleRedMean(redMean, timestamp);
  }, [handleRedMean]);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <Text
          style={styles.permissionLink}
          onPress={() => {
            if (permissionDenied) {
              void Linking.openSettings();
            } else {
              requestPermission().then(granted => setPermissionDenied(!granted)).catch(() => {});
            }
          }}
        >
          {permissionDenied ? 'Open Settings to allow the camera' : 'Tap to allow the camera'}
        </Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>No back camera found</Text>
      </View>
    );
  }

  if (!running) {
    return null;
  }

  if (cameraError) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera not available on this device</Text>
        <Text style={styles.subtext}>{cameraError}</Text>
      </View>
    );
  }

  const overlayText = ppgState === 'detecting'
    ? `Detecting pulse... (${peakCount}/5 peaks)`
    : ppgState === 'recording'
      ? 'Recording — hold still'
      : 'Starting camera...';

  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        device={device}
        isActive={running}
        torch={running ? 'on' : 'off'}
        format={format}
        fps={format ? 30 : undefined}
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
        onError={(error) => {
          console.log('CAMERA_ERROR: ' + error.message + ' (code=' + (error as any).code + ')');
          setCameraError(error.message);
        }}
        onStarted={() => {
          if (IS_DEV) console.log('CAMERA_STARTED: Camera.onStarted fired');
        }}
      />
      <View style={styles.overlay}>
        <Text style={styles.instruction}>
          Cover the rear lens and flash with a fingertip
        </Text>
        <View style={styles.statusBadge}>
          <View style={[
            styles.statusDot,
            ppgState === 'recording' ? styles.dotRecording : styles.dotDetecting,
          ]} />
          <Text style={styles.statusText}>{overlayText}</Text>
        </View>
      </View>
    </View>
  );
}

export default React.memo(CameraPPGNative);

const styles = StyleSheet.create({
  container: {
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0a0a1a',
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
  },
  instruction: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotDetecting: {
    backgroundColor: '#f59e0b',
  },
  dotRecording: {
    backgroundColor: '#22c55e',
  },
  statusText: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  text: {
    color: '#94a3b8',
    fontSize: 14,
  },
  permissionLink: {
    color: '#60a5fa',
    fontSize: 14,
    marginTop: 8,
    textDecorationLine: 'underline',
  },
  subtext: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
});
