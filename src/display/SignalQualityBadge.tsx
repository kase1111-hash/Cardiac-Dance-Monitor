/**
 * Signal quality badge — green/yellow/red/grey dot displayed top-right.
 * Per SPEC Section 4.1.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { SignalQuality } from '../ble/ble-service';

const QUALITY_COLORS: Record<SignalQuality, string> = {
  good: '#22c55e',
  fair: '#f59e0b',
  poor: '#ef4444',
  disconnected: '#64748b',
};

const QUALITY_LABELS: Record<SignalQuality, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Hold still',
  disconnected: 'No signal',
};

interface Props {
  quality: SignalQuality;
}

export function SignalQualityBadge({ quality }: Props) {
  const color = QUALITY_COLORS[quality];

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{QUALITY_LABELS[quality]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
