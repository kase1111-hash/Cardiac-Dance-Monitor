/**
 * Metrics row — four compact metric displays: BPM, κ, Gini, σ.
 * Per SPEC Section 4.1.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  bpm: number;
  kappa: number;
  gini: number;
  sigma: number | null;
}

export function MetricsRow({ bpm, kappa, gini, sigma }: Props) {
  return (
    <View style={styles.row}>
      <MetricCell label="BPM" value={bpm > 0 ? String(bpm) : '--'} />
      <MetricCell label="\u03BA" value={kappa > 0 ? kappa.toFixed(1) : '--'} />
      <MetricCell label="Gini" value={gini > 0 ? gini.toFixed(3) : '--'} />
      <MetricCell label="\u03C3" value={sigma !== null ? sigma.toFixed(1) : '\u2014'} />
    </View>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  cell: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 10,
    alignItems: 'center',
  },
  value: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  label: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
});
