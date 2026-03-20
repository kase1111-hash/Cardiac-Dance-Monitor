/**
 * Camera PPG view — captures frames from rear camera with flash/torch ON,
 * extracts mean red channel intensity via VisionCamera frame processor,
 * feeds into PPG processor.
 *
 * Per SPEC Section 1.4:
 * - Rear camera at 30 fps, torch ON
 * - Red channel extraction (mean intensity per frame)
 * - User places fingertip over lens
 *
 * The frame processor runs on the worklet thread and samples a sparse grid
 * of pixels from the center of the frame. Since the finger covers the entire
 * lens, the whole frame is a uniform red glow — we just need its average
 * brightness as a single number. That's the PPG signal.
 *
 * Pixel format: We request 'rgb' (RGBA/BGRA 8-bit, 4 bytes per pixel).
 * On iOS the layout is BGRA, on Android it may be RGBA. Either way, we
 * take a weighted luminance from the R channel (byte offset 0 or 2) — but
 * since the finger-on-lens image is nearly monochromatic red, the specific
 * channel matters less than tracking the brightness variation over time.
 * We sample R at offset 0 on Android (RGBA) and offset 2 on iOS (BGRA),
 * but for robustness we just take max(byte0, byte2) which covers both.
 */
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';

interface Props {
  /** Called with mean red channel intensity and timestamp for each frame. */
  onFrame: (redMean: number, timestampMs: number) => void;
  /** Whether the camera should be active. */
  active: boolean;
  /** Current processing state for overlay text. */
  ppgState: 'idle' | 'detecting' | 'recording';
  /** Number of peaks detected so far. */
  peakCount: number;
}

/**
 * Number of pixels to sample per axis in the center crop.
 * Total samples = GRID_SIZE^2. 10x10 = 100 samples is plenty for a
 * uniform finger-on-lens image and runs well within 30fps budget.
 */
const GRID_SIZE = 10;
const CROP_SIZE = 100; // pixels — center crop dimensions

export function CameraPPGView({ onFrame, active, ppgState, peakCount }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Bridge from worklet thread → JS thread
  const handleRedMean = useRunOnJS((redMean: number, timestamp: number) => {
    onFrame(redMean, timestamp);
  }, [onFrame]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    const width = frame.width;
    const height = frame.height;

    // Compute center crop bounds
    const cropW = Math.min(CROP_SIZE, width);
    const cropH = Math.min(CROP_SIZE, height);
    const startX = Math.floor((width - cropW) / 2);
    const startY = Math.floor((height - cropH) / 2);

    // Step size: sample GRID_SIZE points across each axis
    const stepX = Math.max(1, Math.floor(cropW / GRID_SIZE));
    const stepY = Math.max(1, Math.floor(cropH / GRID_SIZE));

    // Copy pixel data from GPU → CPU
    const buffer = frame.toArrayBuffer();
    const data = new Uint8Array(buffer);
    const bytesPerRow = frame.bytesPerRow;

    // RGB pixel format: 4 bytes per pixel (RGBA or BGRA)
    const bytesPerPixel = 4;

    let sum = 0;
    let count = 0;

    for (let dy = 0; dy < GRID_SIZE; dy++) {
      const y = startY + dy * stepY;
      const rowOffset = y * bytesPerRow;

      for (let dx = 0; dx < GRID_SIZE; dx++) {
        const x = startX + dx * stepX;
        const pixelOffset = rowOffset + x * bytesPerPixel;

        // Take max of byte 0 and byte 2 to handle both RGBA and BGRA layouts.
        // For finger-on-lens PPG, the red channel dominates in both layouts.
        const byte0 = data[pixelOffset];     // R in RGBA, B in BGRA
        const byte2 = data[pixelOffset + 2]; // B in RGBA, R in BGRA
        const red = byte0 > byte2 ? byte0 : byte2;

        sum += red;
        count++;
      }
    }

    const redMean = count > 0 ? sum / count : 0;
    const timestamp = frame.timestamp / 1000000; // nanoseconds → milliseconds

    handleRedMean(redMean, timestamp);
  }, [handleRedMean]);

  // Permission states
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <Text
          style={styles.permissionLink}
          onPress={requestPermission}
        >
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
        fps={30}
        pixelFormat="rgb"
        frameProcessor={frameProcessor}
        preview={false}
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
