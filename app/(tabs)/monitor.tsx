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
import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, useWindowDimensions,
  TouchableOpacity,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { exportBeatCSV } from '../../src/session/export-beat-csv';
import {
  startChestAccel, stopChestAccel, clearAccelBuffer,
  getAccelBuffer, isAccelAvailable, detectMotionArtifact,
} from '../../src/sensors/chest-accel';
import {
  getBreathRate, getLatestIBI, getFilteredZForDisplay,
} from '../../src/sensors/respiratory';
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
import { beatLogger } from '../../src/session/beat-logger';

// NO top-level camera import. CameraPPGView is loaded via conditional
// require() inside the component, only when sourceType === 'camera'.
// This ensures VisionCamera module-level crashes never affect BLE or
// simulated modes.

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

  // Chest mode state
  const [chestMode, setChestMode] = useState(false);
  const [showChestOverlay, setShowChestOverlay] = useState(false);
  const [breathRate, setBreathRate] = useState<number | null>(null);
  const [breathWaveform, setBreathWaveform] = useState<{ timestamp: number; value: number }[]>([]);
  const breathUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Chest mode toggle handler
  const toggleChestMode = useCallback(() => {
    if (!chestMode) {
      if (!isAccelAvailable()) {
        const { Alert } = require('react-native');
        Alert.alert('Chest Mode Unavailable', 'Requires dev build with expo-sensors.');
        return;
      }
      const started = startChestAccel();
      if (started) {
        setChestMode(true);
        setShowChestOverlay(true);
        // Auto-dismiss overlay after 5 seconds
        setTimeout(() => setShowChestOverlay(false), 5000);
        // Update breath rate and waveform every 2 seconds
        breathUpdateRef.current = setInterval(() => {
          const buf = getAccelBuffer();
          setBreathRate(getBreathRate(buf));
          setBreathWaveform(getFilteredZForDisplay(buf, 20000));
        }, 2000);
      }
    } else {
      stopChestAccel();
      setChestMode(false);
      setBreathRate(null);
      setBreathWaveform([]);
      if (breathUpdateRef.current) {
        clearInterval(breathUpdateRef.current);
        breathUpdateRef.current = null;
      }
    }
  }, [chestMode]);

  // Cleanup chest mode on unmount
  useEffect(() => {
    return () => {
      if (breathUpdateRef.current) clearInterval(breathUpdateRef.current);
      stopChestAccel();
    };
  }, []);

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
      beatLogger.clear();
      clearAccelBuffer();
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

      // Append to CSV beat logger for research export
      const dp = state.displayPoints;
      const lastPt = dp.length > 0 ? dp[dp.length - 1] : null;
      const now = Date.now();
      const accelBuf = chestMode ? getAccelBuffer() : [];
      beatLogger.append({
        timestamp: new Date().toISOString(),
        beat_number: state.totalBeats + 1,
        ppi_ms: ppi,
        source: sourceType,
        spo2: sourceType === 'ble_innovo' ? ble.spo2 : null,
        bpm: state.bpm,
        pi_percent: sourceType === 'ble_innovo' ? ble.perfusionIndex : null,
        dance_name: state.danceMatch?.name ?? null,
        dance_confidence: state.danceMatch ? Math.round(state.danceMatch.confidence * 100) : null,
        kappa: state.kappaMedian,
        gini: state.gini,
        sigma: state.spread,
        theta1: lastPt?.theta1 ?? 0,
        theta2: lastPt?.theta2 ?? 0,
        trail_length: state.trailLength,
        motion_artifact: chestMode ? detectMotionArtifact(now, ppi) : false,
        breath_rate: chestMode ? getBreathRate(accelBuf) : null,
        ibi_ms: chestMode ? getLatestIBI(accelBuf) : null,
      });
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

  // Convert breath waveform to SVG polyline points string
  const breathWaveformToPoints = (
    data: { timestamp: number; value: number }[],
    w: number,
    h: number,
  ): string => {
    if (data.length < 2) return '';
    const tMin = data[0].timestamp;
    const tMax = data[data.length - 1].timestamp;
    const tRange = tMax - tMin || 1;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const d of data) {
      if (d.value < vMin) vMin = d.value;
      if (d.value > vMax) vMax = d.value;
    }
    const vRange = vMax - vMin || 1;
    const pad = 2;
    return data.map(d => {
      const x = ((d.timestamp - tMin) / tRange) * w;
      const y = pad + (1 - (d.value - vMin) / vRange) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };

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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={[styles.chestToggle, chestMode && styles.chestToggleActive]}
              onPress={toggleChestMode}
            >
              <Text style={[styles.chestToggleText, chestMode && styles.chestToggleTextActive]}>
                Chest
              </Text>
            </TouchableOpacity>
            <SignalQualityBadge quality={pulseOx.signalQuality} />
          </View>
        </View>

        {/* Chest mode instruction overlay */}
        {showChestOverlay && (
          <TouchableOpacity
            style={styles.chestOverlay}
            onPress={() => setShowChestOverlay(false)}
            activeOpacity={0.9}
          >
            <Text style={styles.chestOverlayText}>
              Place phone flat on chest.{'\n'}Look forward, breathe naturally.
            </Text>
            <Text style={styles.chestOverlayDismiss}>Tap to dismiss</Text>
          </TouchableOpacity>
        )}

        {/* Camera PPG view — loaded via conditional require() so
             VisionCamera is never evaluated unless camera mode is active.
             CameraPPGView itself wraps CameraPPGNative in a try-catch,
             so even if VisionCamera crashes on require(), we get a
             graceful fallback instead of a dead monitor screen. */}
        {sourceType === 'camera' && (() => {
          try {
            const CameraView = require('../../src/display/CameraPPGView').default;
            return (
              <CameraView
                onFrame={handleCameraFrame}
                active={camera.connectionStatus === 'connected'}
                ppgState={camera.ppgState}
                peakCount={camera.peakCount}
              />
            );
          } catch (e: any) {
            console.warn('CAMERA_REQUIRE_FAILED:', e?.message);
            return (
              <View style={{
                height: 120, borderRadius: 12, backgroundColor: '#0a0a1a',
                marginBottom: 12, justifyContent: 'center', alignItems: 'center',
              }}>
                <Text style={{ color: '#94a3b8', fontSize: 14 }}>
                  Camera unavailable
                </Text>
              </View>
            );
          }
        })()}

        {/* BPM display */}
        <BPMDisplay bpm={state.bpm} bpm15={state.bpm15} sourceName={pulseOx.sourceName} />

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

        {/* Breath rate display + waveform (chest mode only) */}
        {chestMode && (
          <View style={styles.breathSection}>
            <Text style={styles.breathRateText}>
              BR: {breathRate !== null ? `${breathRate} /min` : '--'}
            </Text>
            {breathWaveform.length > 2 && (
              <View style={styles.breathWaveContainer}>
                <Svg width={torusSize} height={40}>
                  <Polyline
                    points={breathWaveformToPoints(breathWaveform, torusSize, 40)}
                    fill="none"
                    stroke="rgba(96,165,250,0.3)"
                    strokeWidth="1.5"
                  />
                </Svg>
              </View>
            )}
          </View>
        )}

        {/* Export CSV button */}
        {state.totalBeats > 0 && (
          <TouchableOpacity style={styles.exportButton} onPress={exportBeatCSV}>
            <Text style={styles.exportButtonText}>
              Export CSV ({beatLogger.count} beats)
            </Text>
          </TouchableOpacity>
        )}

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
  chestToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  chestToggleActive: {
    backgroundColor: '#1e3a5f',
    borderColor: '#60a5fa',
  },
  chestToggleText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  chestToggleTextActive: {
    color: '#60a5fa',
  },
  chestOverlay: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 12,
    alignItems: 'center',
  },
  chestOverlayText: {
    color: '#e2e8f0',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  chestOverlayDismiss: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 12,
  },
  breathSection: {
    alignItems: 'center',
    marginBottom: 8,
  },
  breathRateText: {
    color: '#60a5fa',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  breathWaveContainer: {
    alignItems: 'center',
  },
  exportButton: {
    alignSelf: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 12,
  },
  exportButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: 'monospace',
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
