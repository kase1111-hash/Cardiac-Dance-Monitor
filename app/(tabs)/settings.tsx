/**
 * Settings tab — data source, baseline management, export, about.
 *
 * Hidden dev features: long-press "About" (3 s) reveals the Developer
 * section (PPG validation mode, Establish Baseline Now, Chest mode on the
 * Monitor header).
 */
import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useDataSource, type DataSourceType } from '../../src/context/data-source-context';
import { sessionStore } from '../../src/session/session-store-instance';
import { shareAsRawCSV } from '../../src/session/share-session';
import { exportBeatCSV } from '../../src/session/export-beat-csv';
import { beatLogger } from '../../src/session/beat-logger';
import { BASELINE_MIN_BEATS } from '../../shared/constants';
import { FORCE_ESTABLISH_MIN_SAMPLES } from '../../src/baseline/baseline-service';
import type { RhythmScenario } from '../../shared/simulator';

const SCENARIOS: { id: RhythmScenario; label: string; description: string }[] = [
  { id: 'nsr', label: 'Waltz', description: 'Regular rhythm with gentle breathing variability' },
  { id: 'chf', label: 'Lock-Step', description: 'Very regular, metronomic rhythm' },
  { id: 'af', label: 'Mosh Pit', description: 'Highly irregular rhythm' },
  { id: 'pvc', label: 'Stumble', description: 'Regular with occasional premature beats' },
  {
    id: 'transition', label: 'Transition',
    description: 'Waltz, then Mosh Pit after 100 beats. The label passes through in-between dances for ~40 s while the 60-beat window turns over.',
  },
];

const SOURCES: { id: DataSourceType; label: string }[] = [
  { id: 'simulated', label: 'Simulated' },
  { id: 'ble_innovo', label: 'Innovo' },
  { id: 'camera', label: 'Camera' },
];

export default function SettingsScreen() {
  const {
    sourceType, setSourceType, simulatedScenario, setSimulatedScenario,
    filterSensitivity, setFilterSensitivity, requestBaselineReset, requestForceBaseline,
    ppgValidationMode, setPPGValidationMode, requestReplayOnboarding, devMode, setDevMode,
  } = useDataSource();

  const handleResetBaseline = useCallback(() => {
    Alert.alert(
      'Reset Baseline',
      'This will clear your learned rhythm baseline for the current source. The system will need to re-learn your pattern. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            requestBaselineReset();
            Alert.alert('Baseline Reset', 'Your baseline has been cleared. The monitor will re-learn your rhythm pattern.');
          },
        },
      ],
    );
  }, [requestBaselineReset]);

  const handleExportRawData = useCallback(async () => {
    try {
      const sessions = await sessionStore.getSessions();
      if (sessions.length === 0) {
        Alert.alert('No Sessions', 'Record a session first on the Monitor tab. It appears here once you leave the Monitor tab or background the app.');
        return;
      }
      const latest = await sessionStore.getSession(sessions[0].id);
      if (!latest || !latest.rawBeats || latest.rawBeats.length === 0) {
        Alert.alert('No Raw Data', 'The most recent session has no per-beat data yet.');
        return;
      }
      await shareAsRawCSV(latest);
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Sharing is not available in this build.');
    }
  }, []);

  const handleAboutLongPress = useCallback(() => {
    setDevMode(!devMode);
  }, [devMode, setDevMode]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Data source toggle */}
        <Text style={styles.sectionHeader}>Data Source</Text>
        <View style={styles.toggleRow}>
          {SOURCES.map(s => (
            <TouchableOpacity
              key={s.id}
              style={[styles.toggleBtn, sourceType === s.id && styles.toggleActive]}
              onPress={() => setSourceType(s.id)}
            >
              <Text
                style={[styles.toggleText, sourceType === s.id && styles.toggleTextActive]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {sourceType === 'ble_innovo' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Scans for an Innovo iP900BP-B pulse oximeter over Bluetooth.
              Turn the device on and insert a finger before selecting it —
              the scan gives up after 30 seconds (tap the header on the Monitor
              tab to scan again). Provides the raw pulse waveform plus SpO₂ and BPM.
            </Text>
          </View>
        )}

        {sourceType === 'camera' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Cover the rear camera lens and flash completely with a fingertip.
              Beats start after about five detected pulses; keep the finger
              still. Needs a development or preview build (not Expo Go).
            </Text>
          </View>
        )}

        {/* Scenario picker (only when simulated) */}
        {sourceType === 'simulated' && (
          <>
            <Text style={styles.sectionHeader}>Simulated Rhythm</Text>
            {SCENARIOS.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.scenarioRow, simulatedScenario === s.id && styles.scenarioActive]}
                onPress={() => setSimulatedScenario(s.id)}
              >
                <Text style={[styles.scenarioLabel, simulatedScenario === s.id && styles.scenarioLabelActive]}>
                  {s.label}
                </Text>
                <Text style={styles.scenarioDesc}>{s.description}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.hint}>
              Switching rhythms while the baseline is still learning restarts
              learning on the new rhythm. An established baseline is kept, so
              switching is how you show change detection.
            </Text>
          </>
        )}

        {/* Baseline management */}
        <Text style={styles.sectionHeader}>Baseline</Text>
        <TouchableOpacity style={styles.actionRow} onPress={handleResetBaseline}>
          <Text style={styles.actionLabel}>Reset Baseline</Text>
          <Text style={styles.actionDesc}>
            Clear the learned rhythm pattern for the current source and start fresh
          </Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Simulated rhythms and real sensors keep separate baselines, so
          switching source never discards one.
        </Text>

        {/* Signal quality tolerance slider */}
        <Text style={styles.sectionHeader}>Signal Quality Tolerance</Text>
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>
              ±{Math.round(filterSensitivity * 100)}%
            </Text>
            <Text style={styles.sliderHint}>
              {filterSensitivity <= 0.25 ? 'Strict' : filterSensitivity < 0.6 ? 'Moderate' : 'Permissive'}
            </Text>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={0.1}
            maximumValue={1}
            step={0.05}
            value={filterSensitivity}
            onValueChange={setFilterSensitivity}
            minimumTrackTintColor="#22c55e"
            maximumTrackTintColor="#1a1a2e"
            thumbTintColor="#22c55e"
          />
          <Text style={styles.sliderDesc}>
            How far a beat may sit from your running median before it counts
            against the signal-quality indicator. Lower = quicker to report a
            poor signal. 40% is the calibrated default.
            {'\n\n'}
            This affects the quality indicator only. It never decides which
            beats are analysed — irregular beats are real data, not noise, and
            are always included.
          </Text>
        </View>

        {/* Export */}
        <Text style={styles.sectionHeader}>Export</Text>
        <TouchableOpacity style={styles.actionRow} onPress={() => { void exportBeatCSV(); }}>
          <Text style={styles.actionLabel}>Export live beat log (CSV)</Text>
          <Text style={styles.actionDesc}>
            Every beat since the source was last started — {beatLogger.count} beats so far
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionRow} onPress={handleExportRawData}>
          <Text style={styles.actionLabel}>Export Raw Data</Text>
          <Text style={styles.actionDesc}>
            Per-beat CSV with PPI, SpO₂, dance metrics, and baseline distance (most recent session)
          </Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Sessions are also exportable individually from the History tab (CSV, PDF, raw beats).
        </Text>

        {/* Dev mode features (hidden) */}
        {devMode && (
          <>
            <Text style={[styles.sectionHeader, { color: '#a855f7' }]}>Developer</Text>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => requestForceBaseline()}
            >
              <Text style={styles.actionLabel}>Establish Baseline Now</Text>
              <Text style={styles.actionDesc}>
                Skip the 5-minute learning period and freeze the baseline from the data
                collected so far. Needs {BASELINE_MIN_BEATS} beats and {FORCE_ESTABLISH_MIN_SAMPLES} rhythm
                windows (about 3 minutes at 75 BPM); the result is confirmed in a dialog.
                For demos: establish during the Waltz, then switch the rhythm to Mosh Pit
                and watch “Has it changed?” go amber (~30 s) and then red with a banner (~90 s).
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionRow, ppgValidationMode && styles.actionRowActive]}
              onPress={() => setPPGValidationMode(!ppgValidationMode)}
            >
              <Text style={styles.actionLabel}>
                PPG Validation Mode {ppgValidationMode ? '(ON)' : '(OFF)'}
              </Text>
              <Text style={styles.actionDesc}>
                Run BLE + Camera simultaneously on the Monitor tab and compare
                rolling BPM live. Requires a dev build with both modules.
              </Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              Developer mode also shows the “Chest” breathing-rate toggle in the Monitor header.
            </Text>
          </>
        )}

        {/* Intro replay */}
        <Text style={styles.sectionHeader}>Help</Text>
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => {
            requestReplayOnboarding();
            Alert.alert('Intro', 'Open the Monitor tab to watch the walkthrough of how the torus works.');
          }}
        >
          <Text style={styles.actionLabel}>Replay Intro</Text>
          <Text style={styles.actionDesc}>
            Show the walkthrough of what the torus display means
          </Text>
        </TouchableOpacity>

        {/* About */}
        <Text style={styles.sectionHeader}>About</Text>
        <TouchableOpacity onLongPress={handleAboutLongPress} delayLongPress={3000}>
          <Text style={styles.aboutText}>
            Cardiac Dance Monitor v1.0.0{'\n'}
            Research prototype — not a medical device.{'\n'}
            The method was validated retrospectively on 9,917 ECG records
            across 6 databases. Pulse-derived (PPG) intervals are not yet
            formally validated.
            {devMode ? '\n\nDeveloper mode enabled.' : ''}
          </Text>
        </TouchableOpacity>
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
  title: {
    color: '#e2e8f0',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#0a0a1a',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: {
    borderColor: '#22c55e',
    backgroundColor: '#0a1a0f',
  },
  toggleText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#22c55e',
  },
  infoBox: {
    marginTop: 8,
    padding: 12,
    backgroundColor: '#0a0a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  infoText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  hint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  scenarioRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0a0a1a',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    marginBottom: 8,
  },
  scenarioActive: {
    borderColor: '#22c55e',
    backgroundColor: '#0a1a0f',
  },
  scenarioLabel: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  scenarioLabelActive: {
    color: '#22c55e',
  },
  scenarioDesc: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
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
  actionRowActive: {
    borderColor: '#a855f7',
    backgroundColor: '#1a0a2e',
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
    lineHeight: 16,
  },
  aboutText: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
  },
  sliderContainer: {
    backgroundColor: '#0a0a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 16,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sliderLabel: {
    color: '#22c55e',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  sliderHint: {
    color: '#64748b',
    fontSize: 13,
  },
  sliderDesc: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
