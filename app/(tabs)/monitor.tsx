/**
 * Main monitor screen — the full Phase 1 pipeline running end-to-end.
 *
 * Data flow:
 * 1. Data source (simulated or BLE) produces PPIs
 * 2. Quality gate filters PPIs (handled in simulated pulse ox)
 * 3. Valid PPIs feed into pipeline (dual normalization)
 * 4. Every beat: compute torus point (adaptive for display, fixed for features)
 * 5. Every 10 beats: compute κ median, Gini, spread → match dance
 * 6. Update all display components
 * 7. Session records all data
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSimulatedPulseOx } from '../../src/hooks/use-simulated-pulse-ox';
import { useMonitorPipeline } from '../../src/hooks/use-monitor-pipeline';
import { useSessionRecorder } from '../../src/hooks/use-session-recorder';
import { useDataSource } from '../../src/context/data-source-context';
import { SignalQualityBadge } from '../../src/display/SignalQualityBadge';
import { BPMDisplay } from '../../src/display/BPMDisplay';
import { TorusDisplay } from '../../src/display/TorusDisplay';
import { DanceCard } from '../../src/display/DanceCard';
import { ThreeQuestions } from '../../src/display/ThreeQuestions';
import { MetricsRow } from '../../src/display/MetricsRow';
import { BaselineIndicator } from '../../src/display/BaselineIndicator';
import { sessionStore } from './history';

export default function MonitorScreen() {
  const { width } = useWindowDimensions();
  const torusSize = Math.min(width - 32, 300);
  const { simulatedScenario } = useDataSource();
  const pulseOx = useSimulatedPulseOx(simulatedScenario);
  const { state, processPPI, reset } = useMonitorPipeline();
  const { recState, startSession, recordBeat, endSession } = useSessionRecorder();

  const sessionStarted = useRef(false);

  // Feed PPIs from pulse source into the pipeline
  useEffect(() => {
    if (pulseOx.latestPPI !== null) {
      processPPI(pulseOx.latestPPI);

      // Auto-start session on first valid PPI
      if (!sessionStarted.current) {
        startSession();
        sessionStarted.current = true;
      }

      // Record beat for session
      recordBeat(state.danceMatch);
    }
  }, [pulseOx.latestPPI]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-end session when disconnected
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pulseOx.connectionStatus === 'disconnected' && sessionStarted.current) {
      // Auto-end after 5 minutes of disconnection
      disconnectTimer.current = setTimeout(async () => {
        const session = endSession();
        if (session && session.beatCount > 0) {
          await sessionStore.saveSession(session);
        }
        sessionStarted.current = false;
        reset();
      }, 5 * 60 * 1000);
    } else if (disconnectTimer.current) {
      clearTimeout(disconnectTimer.current);
      disconnectTimer.current = null;
    }
    return () => {
      if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    };
  }, [pulseOx.connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const danceName = state.danceMatch?.name ?? null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Disclaimer banner */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>
            RESEARCH PROTOTYPE — Not a medical device
          </Text>
        </View>

        {/* Header: connection + signal quality */}
        <View style={styles.header}>
          <Text style={styles.connectionText}>
            {pulseOx.connectionStatus === 'connected'
              ? pulseOx.sourceName
              : pulseOx.connectionStatus === 'scanning'
                ? 'Scanning for sensor...'
                : 'Disconnected'}
          </Text>
          <SignalQualityBadge quality={pulseOx.signalQuality} />
        </View>

        {/* BPM display */}
        <BPMDisplay bpm={state.bpm} sourceName={pulseOx.sourceName} />

        {/* Dance card */}
        <DanceCard match={state.danceMatch} />

        {/* Torus display */}
        <TorusDisplay
          points={state.displayPoints}
          danceName={danceName}
          size={torusSize}
        />

        {/* Baseline indicator */}
        <BaselineIndicator
          isLearning={state.isLearningBaseline}
          progress={state.baselineLearningProgress}
          sampleCount={state.baselineBeatCount}
          baselineRecordedAt={!state.isLearningBaseline ? Date.now() : null}
          baselineBeatCount={!state.isLearningBaseline ? state.baselineBeatCount : null}
        />

        {/* Three questions */}
        <ThreeQuestions
          isDancing={state.isDancing}
          currentDance={state.danceMatch}
          changeLevel={state.changeLevel}
        />

        {/* Metrics row */}
        <MetricsRow
          bpm={state.bpm ?? 0}
          kappa={state.kappaMedian}
          gini={state.gini}
          sigma={state.changeStatus.mahalanobisDistance > 0 ? state.changeStatus.mahalanobisDistance : null}
        />

        {/* Session info */}
        {recState.isRecording && (
          <View style={styles.sessionInfo}>
            <Text style={styles.sessionText}>
              Recording • {recState.beatCount} beats •{' '}
              {Math.floor(recState.elapsedMs / 1000)}s
            </Text>
          </View>
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
    paddingBottom: 32,
  },
  disclaimer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 6,
    padding: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  disclaimerText: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  connectionText: {
    color: '#64748b',
    fontSize: 12,
  },
  sessionInfo: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  sessionText: {
    color: '#475569',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
