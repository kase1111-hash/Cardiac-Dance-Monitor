/**
 * ComparisonStrip — the "same heart rate, different geometry" story.
 *
 * Two stacked sparklines over the same rolling window (one sample per
 * 10-beat feature update):
 * - BPM on a fixed 40-140 axis: what a conventional pulse monitor sees.
 * - Torus spread on a fixed 0-4 axis: what the rhythm geometry sees.
 *
 * The fixed axes are deliberate: when the rhythm changes character the top
 * line staying flat while the bottom line transforms IS the demo, so the
 * scales must never auto-zoom to the data.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Polyline } from 'react-native-svg';
import type { FeatureSample } from '../hooks/use-monitor-pipeline';
import { sparklinePoints, BPM_DOMAIN, SPREAD_DOMAIN } from './sparkline-math';

// Validated pair for the dark surface (dataviz six-checks: lightness band,
// chroma, CVD separation, contrast).
const BPM_COLOR = '#3b82f6';
const SPREAD_COLOR = '#d97706';

const CHART_HEIGHT = 44;

interface Props {
  history: FeatureSample[];
  /** Full strip width in px (matches the torus display width). */
  width: number;
}

interface RowProps {
  title: string;
  color: string;
  values: number[];
  domain: readonly [number, number];
  valueText: string;
  axisLabels: [string, string];
  chartWidth: number;
}

function SparklineRow({ title, color, values, domain, valueText, axisLabels, chartWidth }: RowProps) {
  const points = sparklinePoints(values, domain[0], domain[1], chartWidth, CHART_HEIGHT);
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={[styles.swatch, { backgroundColor: color }]} />
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowValue}>{valueText}</Text>
      </View>
      <View style={styles.chartArea}>
        <Svg width={chartWidth} height={CHART_HEIGHT}>
          <Line
            x1={0} y1={CHART_HEIGHT / 2} x2={chartWidth} y2={CHART_HEIGHT / 2}
            stroke="#1a1a2e" strokeWidth={1}
          />
          {points !== '' && (
            <Polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </Svg>
        <View style={styles.axisLabels}>
          <Text style={styles.axisLabel}>{axisLabels[0]}</Text>
          <Text style={styles.axisLabel}>{axisLabels[1]}</Text>
        </View>
      </View>
    </View>
  );
}

export function ComparisonStrip({ history, width }: Props) {
  // Inner padding (12) on each side, and 24px reserved for axis labels.
  const chartWidth = Math.max(60, width - 24 - 24);

  if (history.length < 2) {
    return (
      <View style={[styles.container, { width }]}>
        <Text style={styles.heading}>Rate vs. rhythm geometry</Text>
        <Text style={styles.empty}>
          Collecting rhythm windows... (updates every 10 beats)
        </Text>
      </View>
    );
  }

  const bpms = history.map(h => h.bpm);
  const spreads = history.map(h => h.spread);
  const latest = history[history.length - 1];
  const beatSpan = latest.beat - history[0].beat;

  return (
    <View style={[styles.container, { width }]}>
      <Text style={styles.heading}>Rate vs. rhythm geometry</Text>
      <SparklineRow
        title="Heart rate — what a pulse monitor sees"
        color={BPM_COLOR}
        values={bpms}
        domain={BPM_DOMAIN}
        valueText={`${Math.round(latest.bpm)} BPM`}
        axisLabels={['140', '40']}
        chartWidth={chartWidth}
      />
      <SparklineRow
        title="Torus spread — what the geometry sees"
        color={SPREAD_COLOR}
        values={spreads}
        domain={SPREAD_DOMAIN}
        valueText={latest.spread.toFixed(2)}
        axisLabels={['4', '0']}
        chartWidth={chartWidth}
      />
      <Text style={styles.caption}>
        Last {beatSpan} beats. A rhythm can change character while the average
        rate barely moves — the spread of the torus pattern is what shifts.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    padding: 12,
    marginTop: 12,
  },
  heading: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  empty: {
    color: '#475569',
    fontSize: 12,
    paddingVertical: 12,
  },
  row: {
    marginBottom: 10,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  swatch: {
    width: 12,
    height: 3,
    borderRadius: 1.5,
    marginRight: 6,
  },
  rowTitle: {
    color: '#64748b',
    fontSize: 11,
    flex: 1,
  },
  rowValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  axisLabels: {
    width: 24,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  axisLabel: {
    color: '#475569',
    fontSize: 9,
    fontFamily: 'monospace',
  },
  caption: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
});
