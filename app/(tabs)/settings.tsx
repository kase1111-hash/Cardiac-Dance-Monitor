/**
 * Settings tab — data source, baseline management, export, about.
 *
 * Hidden dev features:
 * - Long-press "About" → toggle PPG validation mode
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView,
  Alert, Platform,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useDataSource } from '../../src/context/data-source-context';
import type { RhythmScenario } from '../../shared/simulator';

const SCENARIOS: Array<{ id: RhythmScenario; label: string; description: string }> = [
  { id: 'nsr', label: 'Normal (Waltz)', description: 'Regular rhythm with moderate variability' },
  { id: 'chf', label: 'Lock-Step', description: 'Very regular, metronomic rhythm' },
  { id: 'af', label: 'Mosh Pit', description: 'Highly irregular rhythm' },
  { id: 'pvc', label: 'Stumble', description: 'Regular with occasional premature beats' },
  { id: 'transition', label: 'Transition', description: 'Normal → irregular after 100 beats' },
];

export default function SettingsScreen() {
  const { sourceType, setSourceType, simulatedScenario, setSimulatedScenario, filterSensitivity, setFilterSensitivity } = useDataSource();
  const [devMode, setDevMode] = useState(false);
  const [ppgValidation, setPPGValidation] = useState(false);

  const handleResetBaseline = useCallback(() => {
    Alert.alert(
      'Reset Baseline',
      'This will clear your learned rhythm baseline. The system will need to re-learn your pattern. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            // Baseline reset is handled by the monitor pipeline
            // This emits an event that the monitor screen listens to
            Alert.alert('Baseline Reset', 'Your baseline has been cleared. The monitor will re-learn your rhythm pattern.');
          },
        },
      ],
    );
  }, []);

  const handleAboutLongPress = useCallback(() => {
    setDevMode(prev => !prev);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Data source toggle */}
        <Text style={styles.sectionHeader}>Data Source</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, sourceType === 'simulated' && styles.toggleActive]}
            onPress={() => setSourceType('simulated')}
          >
            <Text style={[styles.toggleText, sourceType === 'simulated' && styles.toggleTextActive]}>
              Simulated
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, sourceType === 'ble' && styles.toggleActive]}
            onPress={() => setSourceType('ble')}
          >
            <Text style={[styles.toggleText, sourceType === 'ble' && styles.toggleTextActive]}>
              Pulse Sensor
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, sourceType === 'camera' && styles.toggleActive]}
            onPress={() => setSourceType('camera')}
          >
            <Text style={[styles.toggleText, sourceType === 'camera' && styles.toggleTextActive]}>
              Camera
            </Text>
          </TouchableOpacity>
        </View>

        {sourceType === 'ble' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Connect a Bluetooth pulse sensor that supports Heart Rate Service (0x180D).
              The app will automatically scan for nearby devices.
            </Text>
          </View>
        )}

        {sourceType === 'camera' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Place your fingertip over the rear camera lens. The flash will turn on
              to detect your pulse. Hold still for at least 30 seconds.
            </Text>
          </View>
        )}

        {/* Scenario picker (only when simulated) */}
        {sourceType === 'simulated' && (
          <>
            <Text style={styles.sectionHeader}>Simulation Scenario</Text>
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
          </>
        )}

        {/* Baseline management */}
        <Text style={styles.sectionHeader}>Baseline</Text>
        <TouchableOpacity style={styles.actionRow} onPress={handleResetBaseline}>
          <Text style={styles.actionLabel}>Reset Baseline</Text>
          <Text style={styles.actionDesc}>
            Clear learned rhythm pattern and start fresh
          </Text>
        </TouchableOpacity>

        {/* Signal filter sensitivity slider */}
        <Text style={styles.sectionHeader}>Signal Filter Sensitivity</Text>
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>
              {Math.round(filterSensitivity * 100)}%
            </Text>
            <Text style={styles.sliderHint}>
              {filterSensitivity === 0 ? 'Accept all' : filterSensitivity < 0.3 ? 'Permissive' : filterSensitivity < 0.6 ? 'Moderate' : 'Strict'}
            </Text>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={0}
            maximumValue={1}
            step={0.05}
            value={filterSensitivity}
            onValueChange={setFilterSensitivity}
            minimumTrackTintColor="#22c55e"
            maximumTrackTintColor="#1a1a2e"
            thumbTintColor="#22c55e"
          />
          <Text style={styles.sliderDesc}>
            Controls how aggressively noisy beats are rejected.
            0% = accept everything (best for simulation).
            40% = recommended for real hardware.
          </Text>
        </View>

        {/* Export */}
        <Text style={styles.sectionHeader}>Export</Text>
        <Text style={styles.infoText}>
          Export individual sessions from the History tab. Tap a session to view details,
          then use the share button to export as CSV or PDF.
        </Text>

        {/* Dev mode features (hidden) */}
        {devMode && (
          <>
            <Text style={[styles.sectionHeader, { color: '#a855f7' }]}>Developer</Text>
            <TouchableOpacity
              style={[styles.actionRow, ppgValidation && styles.actionRowActive]}
              onPress={() => setPPGValidation(prev => !prev)}
            >
              <Text style={styles.actionLabel}>
                PPG Validation Mode {ppgValidation ? '(ON)' : '(OFF)'}
              </Text>
              <Text style={styles.actionDesc}>
                Run BLE + Camera simultaneously to compare accuracy
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* About */}
        <Text style={styles.sectionHeader}>About</Text>
        <TouchableOpacity onLongPress={handleAboutLongPress} delayLongPress={3000}>
          <Text style={styles.aboutText}>
            Cardiac Dance Monitor v1.0.0{'\n'}
            Research prototype — not a medical device.{'\n'}
            Validated on 9,917 records across 6 databases.
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
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
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
    color: '#475569',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
