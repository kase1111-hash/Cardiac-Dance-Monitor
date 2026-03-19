/**
 * History tab — lists past sessions with date, duration, dominant dance, beat count.
 * Per SPEC Section 7.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList, TouchableOpacity, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SessionStore, MemoryStorage } from '../../src/session/session-store';
import type { Session } from '../../src/session/session-types';
import { getDanceColor, getDanceEmoji } from '../../shared/dance-colors';

// In production, this would use AsyncStorage. For now, use a shared instance.
// TODO: Replace with AsyncStorage adapter when integrating
const store = new SessionStore(new MemoryStorage());
export { store as sessionStore };

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useFocusEffect(
    useCallback(() => {
      store.getSessions().then(setSessions);
    }, []),
  );

  const handleDelete = (id: string) => {
    Alert.alert('Delete Session', 'Remove this session from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await store.deleteSession(id);
          const updated = await store.getSessions();
          setSessions(updated);
        },
      },
    ]);
  };

  const renderSession = ({ item }: { item: Session }) => {
    const duration = formatDuration(item.endTime - item.startTime);
    const color = getDanceColor(item.dominantDance);
    const emoji = getDanceEmoji(item.dominantDance);

    return (
      <TouchableOpacity
        style={styles.sessionRow}
        onLongPress={() => handleDelete(item.id)}
      >
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={styles.sessionInfo}>
          <Text style={[styles.danceName, { color }]}>{item.dominantDance}</Text>
          <Text style={styles.sessionMeta}>
            {formatDate(item.startTime)} • {duration} • {item.beatCount} beats
          </Text>
          {item.danceTransitions.length > 0 && (
            <Text style={styles.transitions}>
              {item.danceTransitions.length} transition{item.danceTransitions.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
        <View style={styles.stats}>
          <Text style={styles.statValue}>{item.summaryStats.bpmMean}</Text>
          <Text style={styles.statLabel}>BPM</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.count}>{sessions.length} sessions</Text>
      </View>
      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No sessions recorded yet</Text>
          <Text style={styles.emptySubtext}>
            Sessions are recorded automatically when receiving pulse data
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={item => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#05050a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: 16,
    paddingBottom: 8,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 24,
    fontWeight: '700',
  },
  count: {
    color: '#64748b',
    fontSize: 13,
  },
  list: {
    padding: 16,
    paddingTop: 0,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a0a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 14,
    marginBottom: 8,
  },
  emoji: {
    fontSize: 28,
    marginRight: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  danceName: {
    fontSize: 16,
    fontWeight: '600',
  },
  sessionMeta: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  transitions: {
    color: '#f59e0b',
    fontSize: 11,
    marginTop: 2,
  },
  stats: {
    alignItems: 'center',
    marginLeft: 12,
  },
  statValue: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 16,
  },
  emptySubtext: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
});
