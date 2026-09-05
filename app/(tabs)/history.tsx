/**
 * History tab — lists past sessions with date, duration, dominant dance, beat count.
 * Per SPEC Section 7. The session currently recording on the Monitor tab is
 * checkpointed whenever that tab loses focus, so it appears here too.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { sessionStore } from '../../src/session/session-store-instance';
import type { Session } from '../../src/session/session-types';
import { getDanceColor, getDanceEmoji } from '../../shared/dance-colors';

const store = sessionStore;

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
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(() => {
    store.getSessions()
      .then(setSessions)
      .catch(e => console.warn('HISTORY_LOAD_FAILED:', e?.message ?? e));
  }, []);

  useFocusEffect(refresh);

  const handleDelete = (id: string) => {
    Alert.alert('Delete Session', 'Remove this session from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await store.deleteSession(id);
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message ?? 'Storage is unavailable.');
          }
          refresh();
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
        onPress={() => router.push(`/session/${item.id}`)}
        onLongPress={() => handleDelete(item.id)}
      >
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={styles.sessionInfo}>
          <Text style={[styles.danceName, { color }]}>{item.dominantDance}</Text>
          <Text style={styles.sessionMeta}>
            {formatDate(item.startTime)} • {duration} • {item.beatCount} beats
          </Text>
          {(item.danceTransitions?.length ?? 0) > 0 && (
            <Text style={styles.transitions}>
              {item.danceTransitions.length} transition{item.danceTransitions.length !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
        <View style={styles.stats}>
          <Text style={styles.statValue}>{item.summaryStats?.bpmMean || '--'}</Text>
          <Text style={styles.statLabel}>BPM</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.count}>
          {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </Text>
      </View>
      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No sessions yet</Text>
          <Text style={styles.emptySubtext}>
            Sessions record automatically on the Monitor tab and appear here
            as soon as you leave that tab. Tap a session for details and
            export; long-press to delete.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={item => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
          ListFooterComponent={
            <Text style={styles.footer}>Tap for details and export · long-press to delete</Text>
          }
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
  chevron: {
    color: '#64748b',
    fontSize: 22,
    marginLeft: 10,
  },
  footer: {
    color: '#64748b',
    fontSize: 11,
    textAlign: 'center',
    paddingVertical: 12,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 16,
  },
  emptySubtext: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
  },
});
