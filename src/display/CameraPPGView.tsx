/**
 * Camera PPG view — safe wrapper that loads VisionCamera via try-catch.
 *
 * This file has ZERO imports from react-native-vision-camera. The actual
 * VisionCamera component lives in CameraPPGNative.tsx and is loaded via
 * require() inside a try-catch. If the native module crashes on import
 * (Expo Go, device policy, missing binary, etc.), we catch it here and
 * show a fallback — the rest of the app (BLE, simulated) is unaffected.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  onFrame: (redMean: number, timestampMs: number) => void;
  active: boolean;
  ppgState: 'idle' | 'detecting' | 'recording';
  peakCount: number;
}

// Try to load the native VisionCamera component. If it fails, NativeCamera
// stays null and we render a fallback message instead.
let NativeCamera: React.ComponentType<Props> | null = null;
let loadError: string | null = null;

try {
  NativeCamera = require('./CameraPPGNative').default;
} catch (e: any) {
  loadError = e?.message || 'VisionCamera not available';
  console.warn('CAMERA_LOAD_FAILED:', loadError);
}

export default function CameraPPGView(props: Props) {
  if (!NativeCamera) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera unavailable</Text>
        <Text style={styles.subtext}>{loadError || 'VisionCamera failed to load'}</Text>
      </View>
    );
  }

  return <NativeCamera {...props} />;
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
  text: {
    color: '#94a3b8',
    fontSize: 14,
  },
  subtext: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 16,
    textAlign: 'center',
  },
});
