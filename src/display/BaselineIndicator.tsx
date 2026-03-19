/**
 * Baseline indicator — shows baseline status below the dance card.
 * "Baseline: 3 days ago (4,200 beats)" or "Learning baseline... 142/200 beats"
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BASELINE_MIN_BEATS } from '../../shared/constants';

interface Props {
  isLearning: boolean;
  progress: number; // 0-1
  sampleCount: number;
  baselineRecordedAt: number | null; // Unix ms
  baselineBeatCount: number | null;
}

function formatAge(recordedAt: number): string {
  const ms = Date.now() - recordedAt;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BaselineIndicator({
  isLearning, progress, sampleCount, baselineRecordedAt, baselineBeatCount,
}: Props) {
  if (isLearning) {
    const pct = Math.round(progress * 100);
    return (
      <View style={styles.container}>
        <Text style={styles.learningText}>
          Learning baseline... {sampleCount}/{BASELINE_MIN_BEATS} samples
        </Text>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.establishedText}>
        Baseline: {baselineRecordedAt ? formatAge(baselineRecordedAt) : 'unknown'}{' '}
        ({baselineBeatCount ?? 0} samples)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  learningText: {
    color: '#64748b',
    fontSize: 12,
    marginBottom: 4,
  },
  progressBar: {
    width: '60%',
    height: 3,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  establishedText: {
    color: '#475569',
    fontSize: 11,
  },
});
