/**
 * Dance card — central display showing the identified dance.
 *
 * Shows: emoji (48px), dance name in bold, confidence %, runner-up in muted text.
 * If confidence < CONFIDENCE_UNCERTAIN: shows grey "Uncertain" with ❓.
 * If confidence < CONFIDENCE_LOW: the name is dimmed and marked low confidence.
 *
 * Per SPEC Section 4.1 and CLAUDE.md Architecture Principle #5:
 * No clinical condition names. Dance names only.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DanceMatch } from '../../shared/types';
import { CONFIDENCE_UNCERTAIN, CONFIDENCE_LOW } from '../../shared/constants';
import { getDanceColor, getDanceEmoji } from '../../shared/dance-colors';

interface Props {
  match: DanceMatch | null;
}

function DanceCardComponent({ match }: Props) {
  // Number.isFinite guard: a NaN confidence fails `< CONFIDENCE_UNCERTAIN`, so
  // a poisoned match rendered as a confident dance at "NaN%" instead of
  // degrading to Uncertain — the opposite of the intended safety net.
  const isUncertain = !match
    || !Number.isFinite(match.confidence)
    || match.confidence < CONFIDENCE_UNCERTAIN;
  const isLow = !isUncertain && match!.confidence < CONFIDENCE_LOW;
  const displayName = isUncertain ? 'Uncertain' : match!.name;
  const color = isUncertain ? '#64748b' : getDanceColor(displayName);
  const emoji = isUncertain ? '\u{2753}' : getDanceEmoji(displayName);
  const confidence = match ? Math.round(match.confidence * 100) : 0;

  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <Text style={[styles.emoji, isLow && styles.dimmed]}>{emoji}</Text>
      <Text style={[styles.name, { color }, isLow && styles.dimmed]}>{displayName}</Text>
      {match && (
        <>
          <Text style={styles.confidence}>
            {confidence}% confidence{isLow ? ' · low' : ''}
          </Text>
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

export const DanceCard = React.memo(DanceCardComponent);

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
  dimmed: {
    opacity: 0.6,
  },
  confidence: {
    color: '#94a3b8',
    fontSize: 14,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  runnerUp: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 6,
  },
  waiting: {
    color: '#64748b',
    fontSize: 14,
    fontStyle: 'italic',
  },
});
