/**
 * Onboarding — a first-run explainer for what the torus display means.
 *
 * Four slides with SVG illustrations drawn in the same idiom as the real
 * TorusDisplay (RR(n) vs RR(n+1) axes, identity diagonal, colored dots), so
 * the concept transfers directly to the live screen. Shown once on first
 * launch (persisted via useOnboarding) and replayable from Settings.
 */
import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import Svg, { Rect, Line, Circle, Path } from 'react-native-svg';
import { DANCE_COLORS } from '../../shared/dance-colors';

const BOX = 200;
const PAD = 16;
const INNER = BOX - 2 * PAD;

/** A mini torus frame: border, faint grid, identity diagonal. */
function TorusFrame({ children }: { children?: React.ReactNode }) {
  const grid = [0.25, 0.5, 0.75].map(f => PAD + f * INNER);
  return (
    <Svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Rect x={0} y={0} width={BOX} height={BOX} fill="#0a0a0f" rx={8} />
      <Rect x={PAD} y={PAD} width={INNER} height={INNER} fill="none" stroke="#1a1a2e" strokeWidth={1} />
      {grid.map((p, i) => (
        <React.Fragment key={i}>
          <Line x1={p} y1={PAD} x2={p} y2={BOX - PAD} stroke="#1a1a2e" strokeWidth={0.5} />
          <Line x1={PAD} y1={p} x2={BOX - PAD} y2={p} stroke="#1a1a2e" strokeWidth={0.5} />
        </React.Fragment>
      ))}
      <Line
        x1={PAD} y1={BOX - PAD} x2={BOX - PAD} y2={PAD}
        stroke="#1a1a2e" strokeWidth={1} strokeDasharray="4,4"
      />
      {children}
    </Svg>
  );
}

/** Map a 0-1 fraction to a pixel inside the frame (y inverted, SVG-style). */
const fx = (f: number) => PAD + f * INNER;
const fy = (f: number) => PAD + (1 - f) * INNER;

function dots(coords: Array<[number, number]>, color: string, r = 4) {
  return coords.map(([x, y], i) => (
    <Circle key={i} cx={fx(x)} cy={fy(y)} r={r} fill={color} fillOpacity={0.85} />
  ));
}

// Slide 1: R-peaks with varying gaps.
function SlidePeaks() {
  const peaks = [18, 58, 92, 140, 172]; // uneven spacing
  const baseY = 120;
  return (
    <Svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}>
      <Rect x={0} y={0} width={BOX} height={BOX} fill="#0a0a0f" rx={8} />
      <Line x1={8} y1={baseY} x2={BOX - 8} y2={baseY} stroke="#1a1a2e" strokeWidth={1} />
      {peaks.map((x, i) => (
        <Path
          key={i}
          d={`M ${x - 6} ${baseY} L ${x} ${baseY - 55} L ${x + 6} ${baseY}`}
          stroke="#22c55e" strokeWidth={2} fill="none" strokeLinejoin="round"
        />
      ))}
      {peaks.slice(1).map((x, i) => {
        const mid = (peaks[i] + x) / 2;
        return (
          <React.Fragment key={i}>
            <Line x1={peaks[i]} y1={baseY + 14} x2={x} y2={baseY + 14} stroke="#f59e0b" strokeWidth={1.5} />
            <Line x1={peaks[i]} y1={baseY + 10} x2={peaks[i]} y2={baseY + 18} stroke="#f59e0b" strokeWidth={1.5} />
            <Line x1={x} y1={baseY + 10} x2={x} y2={baseY + 18} stroke="#f59e0b" strokeWidth={1.5} />
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// Slide 2: a loose diagonal cluster — the Waltz.
function SlideMap() {
  const pts: Array<[number, number]> = [
    [0.35, 0.38], [0.45, 0.42], [0.52, 0.55], [0.6, 0.58],
    [0.55, 0.66], [0.48, 0.6], [0.42, 0.5], [0.38, 0.45],
  ];
  return <TorusFrame>{dots(pts, DANCE_COLORS['The Waltz'])}</TorusFrame>;
}

// Slide 4: baseline region + one outlier.
function SlideChange() {
  const cluster: Array<[number, number]> = [
    [0.4, 0.42], [0.46, 0.45], [0.5, 0.5], [0.44, 0.52], [0.52, 0.44], [0.48, 0.48],
  ];
  return (
    <TorusFrame>
      <Circle cx={fx(0.47)} cy={fy(0.47)} r={38} fill="#22c55e" fillOpacity={0.1} stroke="#22c55e" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3,3" />
      {dots(cluster, DANCE_COLORS['The Waltz'], 3.5)}
      <Circle cx={fx(0.8)} cy={fy(0.82)} r={6} fill={DANCE_COLORS['The Mosh Pit']} />
      <Circle cx={fx(0.8)} cy={fy(0.82)} r={11} fill="none" stroke={DANCE_COLORS['The Mosh Pit']} strokeWidth={1.5} strokeOpacity={0.6} />
    </TorusFrame>
  );
}

// Slide 3: three mini-shapes.
function MiniTorus({ pts, color }: { pts: Array<[number, number]>; color: string }) {
  const S = 92, p = 8, inner = S - 2 * p;
  const mx = (f: number) => p + f * inner;
  const my = (f: number) => p + (1 - f) * inner;
  return (
    <Svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
      <Rect x={0} y={0} width={S} height={S} fill="#0a0a0f" rx={6} />
      <Rect x={p} y={p} width={inner} height={inner} fill="none" stroke="#1a1a2e" strokeWidth={0.5} />
      <Line x1={p} y1={S - p} x2={S - p} y2={p} stroke="#1a1a2e" strokeWidth={0.5} strokeDasharray="3,3" />
      {pts.map(([x, y], i) => (
        <Circle key={i} cx={mx(x)} cy={my(y)} r={2.5} fill={color} fillOpacity={0.85} />
      ))}
    </Svg>
  );
}

function SlideShapes() {
  const lockStep: Array<[number, number]> = [
    [0.48, 0.5], [0.5, 0.52], [0.52, 0.49], [0.49, 0.48], [0.51, 0.51], [0.5, 0.5],
  ];
  const waltz: Array<[number, number]> = [
    [0.3, 0.35], [0.42, 0.45], [0.55, 0.58], [0.62, 0.66], [0.5, 0.55], [0.38, 0.42],
  ];
  const mosh: Array<[number, number]> = [
    [0.2, 0.7], [0.75, 0.3], [0.5, 0.85], [0.85, 0.6], [0.3, 0.25], [0.6, 0.5], [0.15, 0.4],
  ];
  return (
    <View style={styles.shapesRow}>
      <View style={styles.shapeCol}>
        <MiniTorus pts={lockStep} color={DANCE_COLORS['The Lock-Step']} />
        <Text style={[styles.shapeLabel, { color: DANCE_COLORS['The Lock-Step'] }]}>Lock-Step</Text>
        <Text style={styles.shapeSub}>tight cluster</Text>
      </View>
      <View style={styles.shapeCol}>
        <MiniTorus pts={waltz} color={DANCE_COLORS['The Waltz']} />
        <Text style={[styles.shapeLabel, { color: DANCE_COLORS['The Waltz'] }]}>Waltz</Text>
        <Text style={styles.shapeSub}>diagonal orbit</Text>
      </View>
      <View style={styles.shapeCol}>
        <MiniTorus pts={mosh} color={DANCE_COLORS['The Mosh Pit']} />
        <Text style={[styles.shapeLabel, { color: DANCE_COLORS['The Mosh Pit'] }]}>Mosh Pit</Text>
        <Text style={styles.shapeSub}>chaotic scatter</Text>
      </View>
    </View>
  );
}

interface Slide {
  title: string;
  body: string;
  art: React.ReactNode;
}

const SLIDES: Slide[] = [
  {
    title: 'Your heart is not a metronome',
    body: 'The gap between beats — the pulse interval — is never exactly the same twice. A healthy heart constantly varies it. Those tiny changes carry the signal.',
    art: <SlidePeaks />,
  },
  {
    title: 'Map each beat against the next',
    body: 'Plot every interval against the one after it: RR(n) across, RR(n+1) up. Beat after beat, the dots trace a path on a square that wraps into a donut (a torus). The pattern of that path is your rhythm’s fingerprint.',
    art: <SlideMap />,
  },
  {
    title: 'Different rhythms, different shapes',
    body: 'A rigid rhythm collapses to a tight knot. A healthy one orbits the diagonal. An irregular one scatters. The app names five of these shapes — dances, never diagnoses.',
    art: <SlideShapes />,
  },
  {
    title: 'The real question: has YOUR pattern changed?',
    body: 'Once the app learns your personal baseline, it watches for drift away from it. A point that lands far outside your normal cloud is what matters — continuous change detection, tuned to you, not to a textbook.',
    art: <SlideChange />,
  },
];

interface Props {
  visible: boolean;
  onDone: () => void;
}

export function Onboarding({ visible, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const next = () => {
    if (isLast) {
      setIndex(0);
      onDone();
    } else {
      setIndex(i => i + 1);
    }
  };

  const skip = () => {
    setIndex(0);
    onDone();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={skip}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Text style={styles.brand}>Cardiac Dance Monitor</Text>
          {!isLast && (
            <TouchableOpacity onPress={skip} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.artWrap}>{slide.art}</View>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.text}>{slide.body}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
          <TouchableOpacity style={styles.nextBtn} onPress={next}>
            <Text style={styles.nextText}>{isLast ? 'Start' : 'Next'}</Text>
          </TouchableOpacity>
        </View>

        {isLast && (
          <Text style={styles.disclaimer}>
            Research prototype — not a medical device. Displays rhythm patterns,
            never clinical diagnoses.
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05050a',
    paddingTop: 48,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  skip: {
    color: '#64748b',
    fontSize: 14,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
  },
  artWrap: {
    marginBottom: 32,
    alignItems: 'center',
  },
  title: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
  text: {
    color: '#94a3b8',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1a1a2e',
  },
  dotActive: {
    backgroundColor: '#22c55e',
    width: 20,
  },
  nextBtn: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  nextText: {
    color: '#05050a',
    fontSize: 16,
    fontWeight: '700',
  },
  disclaimer: {
    color: '#475569',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 16,
  },
  shapesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  shapeCol: {
    alignItems: 'center',
  },
  shapeLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  shapeSub: {
    color: '#475569',
    fontSize: 10,
    marginTop: 1,
  },
});
