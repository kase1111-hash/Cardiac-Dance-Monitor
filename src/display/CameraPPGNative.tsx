/**
 * Native VisionCamera implementation for Camera PPG.
 *
 * This file is NEVER imported directly by monitor.tsx or any other screen.
 * It is loaded via try-catch require() in CameraPPGView.tsx so that if
 * react-native-vision-camera crashes at module level (Expo Go, device
 * policy, missing native module, etc.), the error is caught and the rest
 * of the app continues working.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

interface Props {
  onFrame: (redMean: number, timestampMs: number) => void;
  active: boolean;
  ppgState: 'idle' | 'detecting' | 'recording';
  peakCount: number;
}

const GRID_SIZE = 10;
const CROP_SIZE = 100;

export default function CameraPPGNative({ onFrame, active, ppgState, peakCount }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const format = useCameraFormat(device, [
    { fps: 30 },
    { videoResolution: { width: 320, height: 240 } },
  ]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const handleRedMean = useRunOnJS((redMean: number, timestamp: number) => {
    onFrame(redMean, timestamp);
  }, [onFrame]);

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
    const timestamp = frame.timestamp / 1000000;

    handleRedMean(redMean, timestamp);
  }, [handleRedMean]);

  console.log('CAMERA device=' + !!device + ' format=' + !!format + ' permission=' + hasPermission);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <Text style={styles.permissionLink} onPress={requestPermission}>
          Tap to grant permission
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

  if (!active) {
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
        isActive={active}
        torch="on"
        format={format}
        fps={format ? 30 : undefined}
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
        preview={false}
        onError={(error) => {
          console.warn('CAMERA_ERROR:', error.message);
          setCameraError(error.message);
        }}
      />
      <View style={styles.overlay}>
        <Text style={styles.instruction}>
          Place fingertip over camera lens
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  instruction: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
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
