/**
 * SpO2 display — shows blood oxygen saturation from BLE status packets.
 * Only rendered when a BLE device provides SpO2 data (Innovo pulse ox).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  /** SpO2 percentage (0-100), or -1 if unavailable/searching. */
  spo2: number;
  /** Perfusion index (0.0-25.5), or 0 if unavailable. */
  perfusionIndex?: number;
}

export function SpO2Display({ spo2, perfusionIndex }: Props) {
  const isValid = spo2 >= 0 && spo2 <= 100;
  const isLow = isValid && spo2 < 95;
  const isCritical = isValid && spo2 < 90;

  return (
    <View style={styles.container}>
      <View style={styles.spo2Section}>
        <Text style={[
          styles.value,
          isCritical ? styles.critical : isLow ? styles.low : styles.normal,
        ]}>
          {isValid ? `${spo2}` : '--'}
        </Text>
        <Text style={styles.unit}>% SpO2</Text>
      </View>
      {perfusionIndex !== undefined && perfusionIndex > 0 && (
        <View style={styles.piSection}>
          <Text style={styles.piValue}>{perfusionIndex.toFixed(1)}</Text>
          <Text style={styles.piLabel}>PI%</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 24,
  },
  spo2Section: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  value: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  normal: {
    color: '#60a5fa',
  },
  low: {
    color: '#f59e0b',
  },
  critical: {
    color: '#ef4444',
  },
  unit: {
    fontSize: 14,
    color: '#64748b',
    fontFamily: 'monospace',
    marginLeft: 4,
  },
  piSection: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  piValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  piLabel: {
    fontSize: 11,
    color: '#64748b',
    marginLeft: 2,
  },
});
