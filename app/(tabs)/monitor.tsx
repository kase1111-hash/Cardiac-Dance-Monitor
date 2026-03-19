/**
 * Main monitor screen — live torus + dance ID + BPM + signal quality.
 * This is the primary user-facing screen. Data flows from pulse source →
 * quality gate → pipeline → display components.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
import { useSimulatedPulseOx } from '../../src/hooks/use-simulated-pulse-ox';
import { useMonitorPipeline } from '../../src/hooks/use-monitor-pipeline';
import { useDataSource } from '../../src/context/data-source-context';
import { SignalQualityBadge } from '../../src/display/SignalQualityBadge';
import { BPMDisplay } from '../../src/display/BPMDisplay';

export default function MonitorScreen() {
  const { simulatedScenario } = useDataSource();
  const pulseOx = useSimulatedPulseOx(simulatedScenario);
  const { state, processPPI } = useMonitorPipeline();

  // Feed PPIs from pulse source into the pipeline
  useEffect(() => {
    if (pulseOx.latestPPI !== null) {
      processPPI(pulseOx.latestPPI);
    }
  }, [pulseOx.latestPPI, processPPI]);

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

        {/* Placeholder: Torus display goes here (Step 8) */}
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>Torus Display</Text>
          <Text style={styles.placeholderSub}>
            {state.totalBeats} beats • {state.displayPoints.length} points
          </Text>
        </View>

        {/* Placeholder: Dance card (Step 9) */}
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            {state.danceMatch
              ? `${state.danceMatch.name} (${Math.round(state.danceMatch.confidence * 100)}%)`
              : 'Waiting for data...'}
          </Text>
        </View>

        {/* Placeholder: Three questions (Step 10) */}
        {/* Placeholder: Metrics row (Step 11) */}
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
  placeholder: {
    backgroundColor: '#0a0a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 24,
    marginVertical: 8,
    alignItems: 'center',
  },
  placeholderText: {
    color: '#64748b',
    fontSize: 16,
  },
  placeholderSub: {
    color: '#475569',
    fontSize: 12,
    marginTop: 4,
  },
});
