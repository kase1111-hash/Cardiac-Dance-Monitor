/**
 * Session detail screen — stats, transitions, change events, and export.
 * Pushed from the History tab. Route: /session/<id>
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sessionStore } from '../../src/session/session-store-instance';
import type { Session } from '../../src/session/session-types';
import { shareAsCSV, shareAsPDF, shareAsRawCSV } from '../../src/session/share-session';
import { getDanceColor, getDanceEmoji } from '../../shared/dance-colors';

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatOffset(timestamp: number, startTime: number): string {
  const totalSec = Math.max(0, Math.floor((timestamp - startTime) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof id === 'string') {
      sessionStore.getSession(id).then(s => {
        setSession(s);
        setLoaded(true);
      });
    } else {
      setLoaded(true);
    }
  }, [id]);

  const runExport = useCallback(async (fn: (s: Session) => Promise<void>, label: string) => {
    if (!session) return;
    try {
      await fn(session);
    } catch (e: any) {
      Alert.alert(`${label} Failed`, e?.message ?? 'Sharing is not available in this build.');
    }
  }, [session]);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}><Text style={styles.muted}>Loading...</Text></View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.muted}>Session not found</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const color = getDanceColor(session.dominantDance);
  const emoji = getDanceEmoji(session.dominantDance);
  const hasRaw = (session.rawBeats?.length ?? 0) > 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backLink}>‹ History</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.emoji}>{emoji}</Text>
          <View style={styles.headerText}>
            <Text style={[styles.danceName, { color }]}>{session.dominantDance}</Text>
            <Text style={styles.date}>{formatDateTime(session.startTime)}</Text>
          </View>
        </View>

        {/* Summary stats */}
        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{formatDuration(session.endTime - session.startTime)}</Text>
            <Text style={styles.statLabel}>Duration</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{session.beatCount}</Text>
            <Text style={styles.statLabel}>Beats</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{session.summaryStats.bpmMean}</Text>
            <Text style={styles.statLabel}>Mean BPM</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{session.summaryStats.kappaMedian.toFixed(1)}</Text>
            <Text style={styles.statLabel}>κ median</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{session.summaryStats.giniMean.toFixed(3)}</Text>
            <Text style={styles.statLabel}>Gini mean</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{session.rawBeats?.length ?? 0}</Text>
            <Text style={styles.statLabel}>Raw beats</Text>
          </View>
        </View>

        {/* Dance transitions */}
        <Text style={styles.sectionHeader}>Dance Transitions</Text>
        {session.danceTransitions.length === 0 ? (
          <Text style={styles.muted}>None — the rhythm held one dance throughout.</Text>
        ) : (
          session.danceTransitions.map((t, i) => (
            <View key={i} style={styles.eventRow}>
              <Text style={styles.eventTime}>{formatOffset(t.timestamp, session.startTime)}</Text>
              <Text style={styles.eventText}>
                <Text style={{ color: getDanceColor(t.from) }}>{t.from}</Text>
                <Text style={styles.muted}>  to  </Text>
                <Text style={{ color: getDanceColor(t.to) }}>{t.to}</Text>
              </Text>
            </View>
          ))
        )}

        {/* Change events */}
        <Text style={styles.sectionHeader}>Change Events</Text>
        {session.changeEvents.length === 0 ? (
          <Text style={styles.muted}>None — no sustained deviation from baseline.</Text>
        ) : (
          session.changeEvents.map((e, i) => (
            <View key={i} style={styles.eventRow}>
              <Text style={styles.eventTime}>{formatOffset(e.timestamp, session.startTime)}</Text>
              <View style={styles.eventBody}>
                <Text style={[styles.eventLevel, e.level === 'alert' ? styles.levelAlert : styles.levelNotice]}>
                  {e.level.toUpperCase()} · d = {e.distance.toFixed(1)}
                </Text>
                <Text style={styles.eventText}>
                  <Text style={{ color: getDanceColor(e.danceBefore) }}>{e.danceBefore}</Text>
                  <Text style={styles.muted}>  to  </Text>
                  <Text style={{ color: getDanceColor(e.danceAfter) }}>{e.danceAfter}</Text>
                </Text>
              </View>
            </View>
          ))
        )}

        {/* Export */}
        <Text style={styles.sectionHeader}>Export</Text>
        <TouchableOpacity style={styles.actionRow} onPress={() => runExport(shareAsCSV, 'CSV Export')}>
          <Text style={styles.actionLabel}>Share as CSV</Text>
          <Text style={styles.actionDesc}>Session summary, transitions, and change events</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={() => runExport(shareAsPDF, 'PDF Export')}>
          <Text style={styles.actionLabel}>Share as PDF</Text>
          <Text style={styles.actionDesc}>Formatted session report</Text>
        </TouchableOpacity>
        {hasRaw && (
          <TouchableOpacity style={styles.actionRow} onPress={() => runExport(shareAsRawCSV, 'Raw Export')}>
            <Text style={styles.actionLabel}>Share Raw Beat Data</Text>
            <Text style={styles.actionDesc}>
              Research-grade per-beat CSV ({session.rawBeats?.length} rows)
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#05050a',
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  backLink: {
    color: '#60a5fa',
    fontSize: 15,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  emoji: {
    fontSize: 40,
    marginRight: 14,
  },
  headerText: {
    flex: 1,
  },
  danceName: {
    fontSize: 22,
    fontWeight: '700',
  },
  date: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    paddingVertical: 8,
  },
  statCell: {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statValue: {
    color: '#e2e8f0',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  statLabel: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 10,
  },
  muted: {
    color: '#475569',
    fontSize: 13,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#12121f',
  },
  eventTime: {
    color: '#64748b',
    fontSize: 13,
    fontFamily: 'monospace',
    width: 52,
  },
  eventBody: {
    flex: 1,
  },
  eventLevel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  levelNotice: {
    color: '#f59e0b',
  },
  levelAlert: {
    color: '#ef4444',
  },
  eventText: {
    color: '#e2e8f0',
    fontSize: 14,
    flex: 1,
  },
  actionRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0a0a1a',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    marginBottom: 8,
  },
  actionLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  actionDesc: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
});
