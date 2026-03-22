/**
 * Large BPM display — shows current beats per minute with source label.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  bpm: number | null;
  bpm15?: number | null;
  sourceName: string;
}

export function BPMDisplay({ bpm, bpm15, sourceName }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.bpmValue}>
        {bpm !== null ? bpm : '--'}
      </Text>
      <Text style={styles.bpmUnit}>BPM</Text>
      {bpm15 !== null && bpm15 !== undefined && (
        <Text style={styles.bpm15}>
          {bpm15} avg₁₅
        </Text>
      )}
      <Text style={styles.source}>{sourceName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  bpmValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#e2e8f0',
    fontFamily: 'monospace',
  },
  bpmUnit: {
    fontSize: 14,
    color: '#64748b',
    fontFamily: 'monospace',
    marginTop: -4,
  },
  bpm15: {
    fontSize: 14,
    color: '#94a3b8',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  source: {
    fontSize: 11,
    color: '#475569',
    marginTop: 4,
  },
});
