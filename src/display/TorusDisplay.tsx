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
 * - Latest point: white pulsing ring
 * - Axis labels
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, {
  Rect, Line, Circle, Polyline, Text as SvgText,
} from 'react-native-svg';
import type { TorusPoint } from '../../shared/types';
import { getDanceColor } from '../../shared/dance-colors';

const TWO_PI = 2 * Math.PI;

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
  const color = getDanceColor(danceName);
  const padding = 24;
  const inner = size - 2 * padding;

  // Pulsing animation for latest point
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.6,
          duration: 600,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

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

        {/* Polyline connecting consecutive points */}
        {points.length >= 2 && (
          <Polyline
            points={polylineStr}
            fill="none"
            stroke={color}
            strokeWidth={1}
            strokeOpacity={0.2}
          />
        )}

        {/* Points — sized and opacified by recency */}
        {points.map((p, i) => {
          const x = angleToPixel(p.theta1, size, padding);
          const y = angleToPixel(p.theta2, size, padding);
          const recency = points.length > 1 ? i / (points.length - 1) : 1;
          const radius = 2 + recency * 4; // 2px oldest → 6px newest
          const opacity = 0.2 + recency * 0.8; // 0.2 → 1.0
          const isLatest = i === points.length - 1;

          return (
            <React.Fragment key={`pt-${p.beatIndex}`}>
              <Circle
                cx={x} cy={y} r={radius}
                fill={color}
                fillOpacity={opacity}
              />
              {/* White pulsing ring on latest point */}
              {isLatest && (
                <Circle
                  cx={x} cy={y} r={8}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  strokeOpacity={0.8}
                />
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
