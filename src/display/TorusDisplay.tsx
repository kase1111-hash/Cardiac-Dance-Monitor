/**
 * Torus display component — renders beat-pair trajectory on a flat torus T².
 *
 * Receives pre-computed TorusPoint[] (using adaptive normalization for visual spread).
 * Pure rendering component — does NOT compute features.
 *
 * Visual design:
 * - Dark background, grid lines at 25/50/75%
 * - Diagonal reference line (identity: RR_n = RR_{n+1})
 * - Old points: small, faded colored dots
 * - "Snake" trail: last N points (N = respiratory cycle period from autocorrelation)
 *   rendered as a thick fading polyline with per-segment opacity gradient.
 *   When RSA is present, the snake traces one complete respiratory ellipse.
 * - Head: large white dot + outer ring
 * - Beat counter + point count overlay
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Rect, Line, Circle, Text as SvgText,
} from 'react-native-svg';
import type { TorusPoint } from '../../shared/types';
import { getDanceColor } from '../../shared/dance-colors';

const TWO_PI = 2 * Math.PI;

interface Props {
  points: TorusPoint[];
  danceName: string | null;
  size: number;
  /** Dynamic trail length from autocorrelation (respiratory cycle). */
  trailLength?: number;
}

/** Map an angle [0, 2π) to pixel coordinate [padding, size - padding]. */
function angleToPixel(angle: number, size: number, padding: number): number {
  const usable = size - 2 * padding;
  return padding + (angle / TWO_PI) * usable;
}

export function TorusDisplay({ points, danceName, size, trailLength = 20 }: Props) {
  // Diagnostic: prove the component receives all points every beat
  const latest = points.length > 0 ? points[points.length - 1] : null;
  if (latest) {
    console.log(
      `TORUS_RENDER pts=${points.length} latest=#${latest.beatIndex}` +
      ` θ1=${latest.theta1.toFixed(2)} θ2=${latest.theta2.toFixed(2)}` +
      ` trail=${trailLength}`,
    );
  }

  const color = getDanceColor(danceName);
  const padding = 24;
  const inner = size - 2 * padding;

  // Grid positions at 25%, 50%, 75%
  const gridFractions = [0.25, 0.5, 0.75];
  const gridPositions = gridFractions.map(f => padding + f * inner);

  // Split points into old (before trail) and trail (last N)
  const effectiveTrail = Math.min(trailLength, points.length);
  const trailStart = Math.max(0, points.length - effectiveTrail);
  const oldPoints = points.slice(0, trailStart);
  const trailPoints = points.slice(trailStart);

  // Pre-compute trail pixel coordinates
  const trailCoords = trailPoints.map(p => ({
    x: angleToPixel(p.theta1, size, padding),
    y: angleToPixel(p.theta2, size, padding),
    beatIndex: p.beatIndex,
  }));

  // Beat count from latest point's beatIndex
  const beatCount = latest?.beatIndex ?? 0;

  // Dim polyline for ALL points (faint history trace)
  const allPolyStr = points
    .map(p => `${angleToPixel(p.theta1, size, padding)},${angleToPixel(p.theta2, size, padding)}`)
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

        {/* Old points — small, faded dots */}
        {oldPoints.map((p, i) => {
          const x = angleToPixel(p.theta1, size, padding);
          const y = angleToPixel(p.theta2, size, padding);
          const recency = points.length > 1 ? i / (points.length - 1) : 0;
          const radius = 1.5 + recency * 1.5;
          const opacity = 0.08 + recency * 0.15;

          return (
            <Circle
              key={`pt-${p.beatIndex}`}
              cx={x} cy={y} r={radius}
              fill={color}
              fillOpacity={opacity}
            />
          );
        })}

        {/* Snake trail — per-segment lines with fading width and opacity.
            Tail is thin and dim, head is thick and bright. */}
        {trailCoords.map((coord, i) => {
          if (i === 0) return null;
          const prev = trailCoords[i - 1];
          const frac = trailCoords.length > 1 ? i / (trailCoords.length - 1) : 1;
          // Width: 1px at tail → 3px at head
          const strokeWidth = 1 + frac * 2;
          // Opacity: 0.1 at tail → 0.8 at head
          const opacity = 0.1 + frac * 0.7;

          return (
            <Line
              key={`seg-${coord.beatIndex}`}
              x1={prev.x} y1={prev.y}
              x2={coord.x} y2={coord.y}
              stroke="#ffffff"
              strokeWidth={strokeWidth}
              strokeOpacity={opacity}
              strokeLinecap="round"
            />
          );
        })}

        {/* Trail dots — small dots along the snake body */}
        {trailCoords.map((coord, i) => {
          const isLatest = i === trailCoords.length - 1;
          if (isLatest) return null; // Head rendered separately
          const frac = trailCoords.length > 1 ? i / (trailCoords.length - 1) : 0;
          const radius = 1.5 + frac * 2.5;
          const opacity = 0.15 + frac * 0.5;

          return (
            <Circle
              key={`td-${coord.beatIndex}`}
              cx={coord.x} cy={coord.y} r={radius}
              fill={color}
              fillOpacity={opacity}
            />
          );
        })}

        {/* Snake head — large, bright, unmissable */}
        {trailCoords.length > 0 && (() => {
          const head = trailCoords[trailCoords.length - 1];
          return (
            <>
              {/* Outer glow */}
              <Circle
                cx={head.x} cy={head.y} r={14}
                fill="#ffffff"
                fillOpacity={0.08}
              />
              {/* White ring */}
              <Circle
                cx={head.x} cy={head.y} r={10}
                fill="none"
                stroke="#ffffff"
                strokeWidth={2}
                strokeOpacity={0.9}
              />
              {/* Bright white center */}
              <Circle
                cx={head.x} cy={head.y} r={5}
                fill="#ffffff"
                fillOpacity={1}
              />
              {/* Colored inner dot */}
              <Circle
                cx={head.x} cy={head.y} r={3}
                fill={color}
                fillOpacity={1}
              />
            </>
          );
        })()}

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
