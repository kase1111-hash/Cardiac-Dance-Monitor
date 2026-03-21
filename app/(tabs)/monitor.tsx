/**
 * Main monitor screen — the full pipeline running end-to-end.
 *
 * Data flow:
 * 1. Data source (simulated, BLE, or camera) produces PPIs
 * 2. Quality gate filters PPIs
 * 3. Valid PPIs feed into pipeline (dual normalization)
 * 4. Every beat: compute torus point (adaptive for display, fixed for features)
 * 5. Every 10 beats: compute κ median, Gini, spread → match dance
 * 6. Update all display components
 * 7. Session records all data
 */
import React, { useEffect, useRef, useCallback, Suspense } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSimulatedPulseOx } from '../../src/hooks/use-simulated-pulse-ox';
import { useCameraPPG } from '../../src/hooks/use-camera-ppg';
import { useInnovoPulseOx } from '../../src/ble/use-innovo-pulse-ox';
import { useMonitorPipeline } from '../../src/hooks/use-monitor-pipeline';
import { useSessionRecorder } from '../../src/hooks/use-session-recorder';
import { useDataSource } from '../../src/context/data-source-context';
import { SignalQualityBadge } from '../../src/display/SignalQualityBadge';
import { BPMDisplay } from '../../src/display/BPMDisplay';
import { SpO2Display } from '../../src/display/SpO2Display';
import { TorusDisplay } from '../../src/display/TorusDisplay';
import { DanceCard } from '../../src/display/DanceCard';
import { ThreeQuestions } from '../../src/display/ThreeQuestions';
import { MetricsRow } from '../../src/display/MetricsRow';
import { BaselineIndicator } from '../../src/display/BaselineIndicator';
import { sessionStore } from '../../src/session/session-store-instance';

// Lazy-load CameraPPGView so react-native-vision-camera is never imported
// unless the user actually selects camera mode. If VisionCamera is broken
// or unavailable (Expo Go, device policy, etc.), only camera mode is affected.
const LazyCameraPPGView = React.lazy(() => import('../../src/display/CameraPPGView'));

/**
 * Error boundary that catches any crash from VisionCamera (import failure,
 * device policy restriction, missing native module, etc.) and shows a
 * graceful fallback instead of killing the entire monitor screen.
 */
class CameraErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  state = { hasError: false, errorMsg: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message || 'Unknown error' };
  }

  componentDidCatch(error: Error) {
    console.warn('CAMERA_BOUNDARY_CATCH:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{
          height: 120, borderRadius: 12, overflow: 'hidden',
          backgroundColor: '#0a0a1a', marginBottom: 12,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>
            Camera unavailable
          </Text>
          <Text style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            {this.state.errorMsg}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function MonitorScreen() {
  const { width } = useWindowDimensions();
  const torusSize = Math.min(width - 32, 300);
  const { sourceType, simulatedScenario, baselineResetCounter } = useDataSource();
  const simulated = useSimulatedPulseOx(simulatedScenario, false); // no auto-start
  const camera = useCameraPPG();
  const ble = useInnovoPulseOx();

  // Select active source based on sourceType
  const pulseOx = sourceType === 'camera' ? camera
    : sourceType === 'ble_innovo' || sourceType === 'ble' ? ble
    : simulated;

  const handleCameraFrame = useCallback((redMean: number, timestampMs: number) => {
    camera.processFrame(redMean, timestampMs);
  }, [camera]);
  const { state, processPPI, reset, resetBaseline } = useMonitorPipeline();
  const { recState, startSession, recordBeat, endSession } = useSessionRecorder();

  const sessionStarted = useRef(false);
  const prevResetCounter = useRef(baselineResetCounter);

  // Connect/disconnect all sources when sourceType changes + reset pipeline
  const prevSourceType = useRef(sourceType);
  useEffect(() => {
    console.log('SOURCE_ACTIVE:', sourceType);

    // Disconnect all sources first
    simulated.disconnect();
    camera.disconnect();
    ble.disconnect();

    // Connect the selected source
    if (sourceType === 'simulated') {
      simulated.connect();
    } else if (sourceType === 'camera') {
      camera.connect('camera');
    } else if (sourceType === 'ble_innovo' || sourceType === 'ble') {
      ble.connect();
    }

    // Reset pipeline when source actually changes (not on first mount)
    if (prevSourceType.current !== sourceType) {
      prevSourceType.current = sourceType;
      reset();
      resetBaseline();
      // End current session so old data doesn't mix
      if (sessionStarted.current) {
        const session = endSession();
        if (session && session.beatCount > 0) {
          sessionStore.saveSession(session);
        }
        sessionStarted.current = false;
      }
    }
  }, [sourceType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch for baseline reset requests from Settings
  useEffect(() => {
    if (baselineResetCounter > prevResetCounter.current) {
      prevResetCounter.current = baselineResetCounter;
      resetBaseline();
    }
  }, [baselineResetCounter, resetBaseline]);

  // Use latestBeat (includes sequence counter) so every beat triggers the effect,
  // even if two consecutive PPIs happen to have the same numeric value.
  const latestBeat = 'latestBeat' in pulseOx ? (pulseOx as any).latestBeat : null;

  // Feed PPIs from pulse source into the pipeline
  useEffect(() => {
    const ppi = latestBeat?.ppi ?? pulseOx.latestPPI;
    if (ppi !== null && ppi !== undefined) {
      console.log('BEAT', state.totalBeats + 1, 'ppi=', ppi, 'source=', sourceType);
      processPPI(ppi);

      // Auto-start session on first valid PPI
      if (!sessionStarted.current) {
        startSession();
        sessionStarted.current = true;
      }

      // Build per-beat raw data for research export
      const rawSource = sourceType === 'ble_innovo' ? 'ble_ppg' as const
        : sourceType === 'camera' ? 'camera' as const
        : sourceType === 'ble' ? 'ble_hr' as const
        : 'simulated' as const;
      const rawBeat = {
        timestamp_ms: Date.now(),
        ppi_ms: ppi,
        source: rawSource,
        raw_ppg: null as number | null,
        spo2: (sourceType === 'ble_innovo' ? ble.spo2 : null) as number | null,
        device_bpm: (sourceType === 'ble_innovo' ? ble.deviceBPM : null) as number | null,
        baseline_distance: state.changeStatus.level !== 'learning'
          ? state.changeStatus.mahalanobisDistance : null,
        trail_length: state.trailLength,
      };

      // Record beat for session (with raw data)
      recordBeat(state.danceMatch, rawBeat);
    }
  }, [latestBeat, pulseOx.latestPPI]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* Camera PPG view — lazy-loaded + error boundary so VisionCamera
             crashes never affect the rest of the monitor screen */}
        {sourceType === 'camera' && (
          <CameraErrorBoundary>
            <Suspense fallback={
              <View style={{
                height: 120, borderRadius: 12, backgroundColor: '#0a0a1a',
                marginBottom: 12, justifyContent: 'center', alignItems: 'center',
              }}>
                <Text style={{ color: '#94a3b8', fontSize: 14 }}>
                  Loading camera...
                </Text>
              </View>
            }>
              <LazyCameraPPGView
                onFrame={handleCameraFrame}
                active={camera.connectionStatus === 'connected'}
                ppgState={camera.ppgState}
                peakCount={camera.peakCount}
              />
            </Suspense>
          </CameraErrorBoundary>
        )}

        {/* BPM display */}
        <BPMDisplay bpm={state.bpm} sourceName={pulseOx.sourceName} />

        {/* SpO2 display (Innovo BLE source — free data from status packets) */}
        {sourceType === 'ble_innovo' && ble.spo2 !== null && (
          <SpO2Display spo2={ble.spo2} perfusionIndex={ble.perfusionIndex ?? undefined} />
        )}

        {/* Dance card */}
        <DanceCard match={state.danceMatch} />

        {/* Torus display */}
        <TorusDisplay
          points={state.displayPoints}
          danceName={danceName}
          size={torusSize}
          trailLength={state.trailLength}
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
