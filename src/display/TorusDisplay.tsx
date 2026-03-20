/**
 * Torus display component — renders beat-pair trajectory on a flat torus T².
 *
 * Receives pre-computed TorusPoint[] (using adaptive normalization for visual spread).
 * Pure rendering component — does NOT compute features.
 *
 * Per SPEC Section 4.1:
 * - Dark background, grid lines at 25/50/75%
 * - Diagonal reference line (identity: RR_n = RR_{n+1})
 * - Points sized/opacified by recency
 * - Polyline connecting consecutive points
 * - Latest point: large white ring + bright inner dot
 * - Trail: last 5 points highlighted with gradient fade
 * - Beat counter overlay so user can see live updates
 * - Axis labels
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Rect, Line, Circle, Polyline, Text as SvgText,
} from 'react-native-svg';
import type { TorusPoint } from '../../shared/types';
import { getDanceColor } from '../../shared/dance-colors';

const TWO_PI = 2 * Math.PI;
const TRAIL_LENGTH = 5;

interface Props {
  points: TorusPoint[];
  danceName: string | null;
  size: number;
}

/** Map an angle [0, 2π) to pixel coordinate [padding, size - padding]. */
function angleToPixel(angle: number, size: number, padding: number): number {
  const usable = size - 2 * padding;
  return padding + (angle / TWO_PI) * usable;
}

export function TorusDisplay({ points, danceName, size }: Props) {
  // Diagnostic: prove the component receives all points every beat
  const latest = points.length > 0 ? points[points.length - 1] : null;
  if (latest) {
    console.log(
      `TORUS_RENDER pts=${points.length} latest=#${latest.beatIndex}` +
      ` θ1=${latest.theta1.toFixed(2)} θ2=${latest.theta2.toFixed(2)}`,
    );
  }

  const color = getDanceColor(danceName);
  const padding = 24;
  const inner = size - 2 * padding;

  // Grid positions at 25%, 50%, 75%
  const gridFractions = [0.25, 0.5, 0.75];
  const gridPositions = gridFractions.map(f => padding + f * inner);

  // Polyline points string
  const polylineStr = points
    .map(p => {
      const x = angleToPixel(p.theta1, size, padding);
      const y = angleToPixel(p.theta2, size, padding);
      return `${x},${y}`;
    })
    .join(' ');

  // Trail: highlight the last TRAIL_LENGTH points with brighter connecting lines
  const trailStart = Math.max(0, points.length - TRAIL_LENGTH);
  const trailPoints = points.slice(trailStart);
  const trailStr = trailPoints
    .map(p => {
      const x = angleToPixel(p.theta1, size, padding);
      const y = angleToPixel(p.theta2, size, padding);
      return `${x},${y}`;
    })
    .join(' ');

  // Beat count from latest point's beatIndex
  const beatCount = latest?.beatIndex ?? 0;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background */}
        <Rect x={0} y={0} width={size} height={size} fill="#0a0a0f" rx={8} />

        {/* Border */}
        <Rect
          x={padding} y={padding}
          width={inner} height={inner}
          fill="none" stroke="#1a1a2e" strokeWidth={1}
        />

        {/* Grid lines */}
        {gridPositions.map((pos, i) => (
          <React.Fragment key={`grid-${i}`}>
            <Line
              x1={pos} y1={padding} x2={pos} y2={size - padding}
              stroke="#1a1a2e" strokeWidth={0.5}
            />
            <Line
              x1={padding} y1={pos} x2={size - padding} y2={pos}
              stroke="#1a1a2e" strokeWidth={0.5}
            />
          </React.Fragment>
        ))}

        {/* Diagonal reference line (identity: RR_n = RR_{n+1}) */}
        <Line
          x1={padding} y1={padding}
          x2={size - padding} y2={size - padding}
          stroke="#1a1a2e" strokeWidth={1} strokeDasharray="4,4"
        />

        {/* Polyline connecting all points (dim) */}
        {points.length >= 2 && (
          <Polyline
            points={polylineStr}
            fill="none"
            stroke={color}
            strokeWidth={1}
            strokeOpacity={0.15}
          />
        )}

        {/* Trail polyline — bright line for last N points */}
        {trailPoints.length >= 2 && (
          <Polyline
            points={trailStr}
            fill="none"
            stroke="#ffffff"
            strokeWidth={2}
            strokeOpacity={0.5}
          />
        )}

        {/* Older points — small and faded */}
        {points.slice(0, trailStart).map((p, i) => {
          const x = angleToPixel(p.theta1, size, padding);
          const y = angleToPixel(p.theta2, size, padding);
          const recency = points.length > 1 ? i / (points.length - 1) : 0;
          const radius = 1.5 + recency * 2;
          const opacity = 0.1 + recency * 0.3;

          return (
            <Circle
              key={`pt-${p.beatIndex}`}
              cx={x} cy={y} r={radius}
              fill={color}
              fillOpacity={opacity}
            />
          );
        })}

        {/* Trail points — gradient from dim to bright */}
        {trailPoints.map((p, i) => {
          const x = angleToPixel(p.theta1, size, padding);
          const y = angleToPixel(p.theta2, size, padding);
          const isLatest = i === trailPoints.length - 1;
          // Trail fade: 0.4 → 0.7 → 1.0 across trail
          const trailFrac = trailPoints.length > 1 ? i / (trailPoints.length - 1) : 1;
          const radius = isLatest ? 7 : 3 + trailFrac * 3;
          const opacity = isLatest ? 1.0 : 0.4 + trailFrac * 0.4;

          return (
            <React.Fragment key={`trail-${p.beatIndex}`}>
              {/* Glow behind trail points */}
              <Circle
                cx={x} cy={y} r={radius + 3}
                fill={isLatest ? '#ffffff' : color}
                fillOpacity={isLatest ? 0.15 : opacity * 0.2}
              />
              {/* Trail dot */}
              <Circle
                cx={x} cy={y} r={radius}
                fill={isLatest ? '#ffffff' : color}
                fillOpacity={opacity}
              />
              {/* Latest point: outer ring */}
              {isLatest && (
                <>
                  <Circle
                    cx={x} cy={y} r={12}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                  />
                  {/* Inner colored dot */}
                  <Circle
                    cx={x} cy={y} r={4}
                    fill={color}
                    fillOpacity={1}
                  />
                </>
              )}
            </React.Fragment>
          );
        })}

        {/* Axis labels */}
        <SvgText
          x={size / 2} y={size - 4}
          fill="#475569" fontSize={10}
          textAnchor="middle" fontFamily="monospace"
        >
          {'RR(n) \u2192'}
        </SvgText>
        <SvgText
          x={8} y={size / 2}
          fill="#475569" fontSize={10}
          textAnchor="middle" fontFamily="monospace"
          rotation={-90}
          originX={8} originY={size / 2}
        >
          {'RR(n+1) \u2192'}
        </SvgText>

        {/* Beat counter + point count — top-right corner */}
        <SvgText
          x={size - padding - 4} y={padding + 16}
          fill="#94a3b8" fontSize={14} fontWeight="bold"
          textAnchor="end" fontFamily="monospace"
        >
          {`#${beatCount}`}
        </SvgText>
        <SvgText
          x={size - padding - 4} y={padding + 30}
          fill="#475569" fontSize={10}
          textAnchor="end" fontFamily="monospace"
        >
          {`${points.length} pts`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
    borderRadius: 8,
    overflow: 'hidden',
  },
});
