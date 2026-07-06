/**
 * ValidationCard — PPG validation mode readout (dev feature).
 *
 * Shown when validation mode runs BLE and camera simultaneously. Collects
 * the last 15 PPIs from each source and compares rolling BPM, so camera
 * PPG accuracy can be checked against the pulse oximeter live.
 *
 * Sources expose only latestPPI (no sequence number), so consecutive
 * identical PPIs are deduped — acceptable for a dev readout since real
 * sensor PPIs in ms rarely repeat exactly.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';

const WINDOW = 15;

interface Props {
  blePPI: number | null;
  bleConnected: boolean;
  cameraPPI: number | null;
  cameraConnected: boolean;
}

interface SourceStats {
  bpm: number | null;
  beats: number;
}

function useRollingBPM(ppi: number | null): SourceStats {
  const buffer = useRef<number[]>([]);
  const count = useRef(0);
  const [stats, setStats] = useState<SourceStats>({ bpm: null, beats: 0 });

  useEffect(() => {
    if (ppi === null) return;
    buffer.current.push(ppi);
    if (buffer.current.length > WINDOW) buffer.current.shift();
    count.current++;
    const m = buffer.current.reduce((s, v) => s + v, 0) / buffer.current.length;
    const bpm = Math.round(60000 / m);
    console.log(`VALIDATION_BEAT n=${count.current} ppi=${ppi} bpm=${bpm}`);
    setStats({ bpm, beats: count.current });
  }, [ppi]);

  return stats;
}

export function ValidationCard({ blePPI, bleConnected, cameraPPI, cameraConnected }: Props) {
  const ble = useRollingBPM(blePPI);
  const camera = useRollingBPM(cameraPPI);

  const delta = ble.bpm !== null && camera.bpm !== null
    ? camera.bpm - ble.bpm
    : null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>PPG Validation — BLE vs Camera</Text>
      <View style={styles.grid}>
        <View style={styles.cell}>
          <Text style={styles.cellValue}>
            {bleConnected ? (ble.bpm ?? '--') : 'off'}
          </Text>
          <Text style={styles.cellLabel}>Pulse Ox BPM ({ble.beats})</Text>
        </View>
        <View style={styles.cell}>
          <Text style={styles.cellValue}>
            {cameraConnected ? (camera.bpm ?? '--') : 'off'}
          </Text>
          <Text style={styles.cellLabel}>Camera BPM ({camera.beats})</Text>
        </View>
        <View style={styles.cell}>
          <Text style={[styles.cellValue, delta !== null && Math.abs(delta) > 5 && styles.deltaBad]}>
            {delta !== null ? (delta > 0 ? `+${delta}` : `${delta}`) : '--'}
          </Text>
          <Text style={styles.cellLabel}>Δ BPM</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        Both sources run live; 15-beat rolling means. Per-beat pairs are
        logged to the console as VALIDATION_BEAT for offline analysis.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a0a2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#a855f7',
    padding: 12,
    marginBottom: 12,
  },
  heading: {
    color: '#a855f7',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    alignItems: 'center',
  },
  cellValue: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  deltaBad: {
    color: '#ef4444',
  },
  cellLabel: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  caption: {
    color: '#64748b',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 8,
  },
});
