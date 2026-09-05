/**
 * Three questions row — the core value proposition of the system.
 *
 * 1. "Is it dancing?" → "YES" (green) or "Checking..." (grey)
 * 2. "Which dance?" → dance name (colored) or "Uncertain" or "..." (no data)
 * 3. "Has it changed?" → "Learning..." / "Checking..." / "Stable" / "Shifted" / "Changed"
 *
 * Per SPEC Section 4.1.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { DanceMatch } from '../../shared/types';
import { CONFIDENCE_UNCERTAIN } from '../../shared/constants';
import { getDanceColor } from '../../shared/dance-colors';

type ChangeLevel = 'learning' | 'normal' | 'notice' | 'alert';

interface Props {
  isDancing: boolean;
  currentDance: DanceMatch | null;
  changeLevel: ChangeLevel;
  /**
   * Whether the baseline is still being learned. The pipeline reports
   * 'learning' for a few windows after any geometry reset even when a
   * baseline exists; that is a warm-up, not learning, and must not read as
   * "the baseline was lost" right under an established-baseline indicator.
   */
  isLearningBaseline?: boolean;
}

const CHANGE_DISPLAY: Record<ChangeLevel, { label: string; color: string }> = {
  learning: { label: 'Learning...', color: '#64748b' },
  normal: { label: 'Stable', color: '#22c55e' },
  notice: { label: 'Shifted', color: '#f59e0b' },
  alert: { label: 'Changed', color: '#ef4444' },
};

function ThreeQuestionsComponent({ isDancing, currentDance, changeLevel, isLearningBaseline = true }: Props) {
  // Question 1: Is it dancing?
  const q1Color = isDancing ? '#22c55e' : '#64748b';
  const q1Answer = isDancing ? 'YES' : 'Checking...';

  // Question 2: Which dance? (same guard as DanceCard: NaN is not confident)
  const isUncertain = !currentDance
    || !Number.isFinite(currentDance.confidence)
    || currentDance.confidence < CONFIDENCE_UNCERTAIN;
  const q2Answer = !currentDance ? '...' : isUncertain ? 'Uncertain' : currentDance.name.replace('The ', '');
  const q2Color = isUncertain ? '#64748b' : getDanceColor(currentDance?.name ?? null);

  // Question 3: Has it changed?
  const warmingUp = changeLevel === 'learning' && !isLearningBaseline;
  const { label: q3Answer, color: q3Color } = warmingUp
    ? { label: 'Checking...', color: '#64748b' }
    : CHANGE_DISPLAY[changeLevel];

  return (
    <View style={styles.row}>
      <QuestionCard question="Is it dancing?" answer={q1Answer} answerColor={q1Color} />
      <QuestionCard question="Which dance?" answer={q2Answer} answerColor={q2Color} />
      <QuestionCard question="Has it changed?" answer={q3Answer} answerColor={q3Color} />
    </View>
  );
}

export const ThreeQuestions = React.memo(ThreeQuestionsComponent);

function QuestionCard({
  question, answer, answerColor,
}: {
  question: string; answer: string; answerColor: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.question}>{question}</Text>
      <Text style={[styles.answer, { color: answerColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {answer}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  card: {
    flex: 1,
    backgroundColor: '#0a0a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 10,
    alignItems: 'center',
  },
  question: {
    color: '#64748b',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 4,
  },
  answer: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
