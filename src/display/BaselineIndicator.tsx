/**
 * Baseline indicator — shows baseline status below the dance card.
 * "Baseline: 3 days ago (4,200 beats)" or "Learning baseline... 142/200 beats"
 * then, once the beat rule is met, "Learning baseline... 3:10 of 5:00 observed".
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BASELINE_MIN_BEATS, BASELINE_DURATION } from '../../shared/constants';

interface Props {
  isLearning: boolean;
  progress: number; // 0-1
  /** Raw beats counted toward the baseline (or behind an established one). */
  sampleCount: number;
  /** Rhythm observed toward the 5-minute rule, in ms. */
  observedMs?: number;
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

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function BaselineIndicatorComponent({
  isLearning, progress, sampleCount, observedMs = 0, baselineRecordedAt, baselineBeatCount,
}: Props) {
  if (isLearning) {
    const pct = Math.round(progress * 100);
    // Show whichever rule is still binding. Printing the raw beat count
    // alone read "312/200 samples" for the last two minutes of learning.
    const label = sampleCount < BASELINE_MIN_BEATS
      ? `Learning baseline... ${sampleCount}/${BASELINE_MIN_BEATS} beats`
      : `Learning baseline... ${formatClock(Math.min(observedMs / 1000, BASELINE_DURATION))} of ${formatClock(BASELINE_DURATION)} observed`;
    return (
      <View style={styles.container}>
        <Text style={styles.learningText}>{label}</Text>
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
        ({(baselineBeatCount ?? 0).toLocaleString()} beats)
      </Text>
    </View>
  );
}

export const BaselineIndicator = React.memo(BaselineIndicatorComponent);

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
    color: '#64748b',
    fontSize: 11,
  },
});
