/**
 * Settings tab — dev toggle for simulated vs BLE source + scenario picker.
 */
import React from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView,
} from 'react-native';
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
  const { sourceType, setSourceType, simulatedScenario, setSimulatedScenario } = useDataSource();

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
        </View>

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

        {/* About */}
        <Text style={styles.sectionHeader}>About</Text>
        <Text style={styles.aboutText}>
          Cardiac Dance Monitor v1.0.0{'\n'}
          Research prototype — not a medical device.{'\n'}
          Validated on 9,917 records across 6 databases.
        </Text>
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
  aboutText: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
  },
});
