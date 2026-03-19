/**
 * Dance card — central display showing the identified dance.
 *
 * Shows: emoji (48px), dance name in bold, confidence %, runner-up in muted text.
 * If confidence < CONFIDENCE_UNCERTAIN: shows grey "Uncertain" with ❓.
 *
 * Per SPEC Section 4.1 and CLAUDE.md Architecture Principle #5:
 * No clinical condition names. Dance names only.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DanceMatch } from '../../shared/types';
import { CONFIDENCE_UNCERTAIN } from '../../shared/constants';
import { getDanceColor, getDanceEmoji } from '../../shared/dance-colors';

interface Props {
  match: DanceMatch | null;
}

export function DanceCard({ match }: Props) {
  const isUncertain = !match || match.confidence < CONFIDENCE_UNCERTAIN;
  const displayName = isUncertain ? 'Uncertain' : match!.name;
  const color = isUncertain ? '#64748b' : getDanceColor(displayName);
  const emoji = isUncertain ? '\u{2753}' : getDanceEmoji(displayName);
  const confidence = match ? Math.round(match.confidence * 100) : 0;

  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.name, { color }]}>{displayName}</Text>
      {match && (
        <>
          <Text style={styles.confidence}>{confidence}% confidence</Text>
          {!isUncertain && (
            <Text style={styles.runnerUp}>
              Runner-up: {match.runnerUp} ({Math.round(match.runnerUpConfidence * 100)}%)
            </Text>
          )}
        </>
      )}
      {!match && (
        <Text style={styles.waiting}>Waiting for data...</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    marginVertical: 8,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
  },
  confidence: {
    color: '#94a3b8',
    fontSize: 14,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  runnerUp: {
    color: '#475569',
    fontSize: 12,
    marginTop: 6,
  },
  waiting: {
    color: '#475569',
    fontSize: 14,
    fontStyle: 'italic',
  },
});
