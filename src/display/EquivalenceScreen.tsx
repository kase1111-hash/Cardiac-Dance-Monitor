/**
 * PPG Equivalence Test screen — hidden dev tool.
 *
 * Per SPEC Section 8.5:
 * - Runs BLE + Camera simultaneously for 60 seconds
 * - Shows live PPI counts from both sources
 * - Computes and displays correlation, dance agreement, viability
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { EquivalenceAnalyzer, type EquivalenceResult } from '../camera/equivalence-analyzer';

interface Props {
  /** Called with BLE PPI from the monitor pipeline */
  onBlePPI?: (ppi: number) => void;
  /** Called with Camera PPI from camera source */
  onCameraPPI?: (ppi: number) => void;
}

export function EquivalenceScreen() {
  const analyzer = useRef(new EquivalenceAnalyzer());
  const [bleCount, setBleCount] = useState(0);
  const [cameraCount, setCameraCount] = useState(0);
  const [result, setResult] = useState<EquivalenceResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    analyzer.current.reset();
    setBleCount(0);
    setCameraCount(0);
    setResult(null);
    setIsRunning(true);
    setElapsed(0);
    startTime.current = Date.now();
    timer.current = setInterval(() => {
      setElapsed(Date.now() - startTime.current);
    }, 1000);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (analyzer.current.canAnalyze()) {
      setResult(analyzer.current.analyze());
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  /** Public methods for parent to feed PPIs. */
  const addBlePPI = useCallback((ppi: number) => {
    if (!isRunning) return;
    analyzer.current.addBlePPI(ppi, Date.now());
    setBleCount(analyzer.current.getBleCount());
  }, [isRunning]);

  const addCameraPPI = useCallback((ppi: number) => {
    if (!isRunning) return;
    analyzer.current.addCameraPPI(ppi, Date.now());
    setCameraCount(analyzer.current.getCameraCount());
  }, [isRunning]);

  const viabilityColor = (v: string) => {
    switch (v) {
      case 'viable': return '#22c55e';
      case 'screening': return '#f59e0b';
      default: return '#ef4444';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>PPG Equivalence Test</Text>
      <Text style={styles.subtitle}>
        Compare BLE pulse ox vs camera PPG side-by-side
      </Text>

      <View style={styles.countsRow}>
        <View style={styles.countBox}>
          <Text style={styles.countLabel}>BLE PPIs</Text>
          <Text style={styles.countValue}>{bleCount}</Text>
        </View>
        <View style={styles.countBox}>
          <Text style={styles.countLabel}>Camera PPIs</Text>
          <Text style={styles.countValue}>{cameraCount}</Text>
        </View>
      </View>

      <Text style={styles.elapsed}>
        {isRunning ? `Recording... ${Math.floor(elapsed / 1000)}s` : 'Ready'}
      </Text>

      <TouchableOpacity
        style={[styles.button, isRunning ? styles.stopButton : styles.startButton]}
        onPress={isRunning ? stop : start}
      >
        <Text style={styles.buttonText}>
          {isRunning ? 'Stop & Analyze' : 'Start Test'}
        </Text>
      </TouchableOpacity>

      {result && (
        <View style={styles.results}>
          <Text style={styles.resultTitle}>Results</Text>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>PPI Correlation:</Text>
            <Text style={styles.resultValue}>
              {result.ppiCorrelation.toFixed(3)}
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Mean PPI Diff:</Text>
            <Text style={styles.resultValue}>
              {result.meanPPIDiffMs.toFixed(1)} ms
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Dance Agreement:</Text>
            <Text style={styles.resultValue}>
              {result.danceAgreementPct.toFixed(0)}%
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Viability:</Text>
            <Text style={[
              styles.resultValue,
              { color: viabilityColor(result.viability) },
            ]}>
              {result.viability.toUpperCase()}
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>Paired PPIs:</Text>
            <Text style={styles.resultValue}>{result.pairedCount}</Text>
          </View>

          {result.bleDances.length > 0 && (
            <View style={styles.danceList}>
              <Text style={styles.danceListTitle}>Dance ID Comparison:</Text>
              {result.bleDances.map((ble, i) => (
                <Text key={i} style={styles.danceRow}>
                  W{i + 1}: BLE={ble} | Cam={result.cameraDances[i] ?? '?'}
                  {ble === result.cameraDances[i] ? ' ✓' : ' ✗'}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05050a',
  },
  content: {
    padding: 16,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  countsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  countBox: {
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    width: '40%',
  },
  countLabel: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 4,
  },
  countValue: {
    color: '#e2e8f0',
    fontSize: 24,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  elapsed: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  startButton: {
    backgroundColor: '#22c55e',
  },
  stopButton: {
    backgroundColor: '#ef4444',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  results: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 16,
  },
  resultTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  resultLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  resultValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  danceList: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a4e',
    paddingTop: 12,
  },
  danceListTitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 6,
  },
  danceRow: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
});
