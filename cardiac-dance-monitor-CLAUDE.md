# CLAUDE.md — Cardiac Dance Monitor

## What This Is

A dual-platform system — React Native phone app (Tier 1) and ESP32 firmware (Tier 2) — that identifies the geometric "dance" of a user's heartbeat in real time. Consecutive pulse intervals are mapped onto a flat torus T², geodesic curvature and Gini coefficient are computed, and the result is matched to one of five validated rhythm dances. The primary value is change detection: has the user's rhythm deviated from their personal baseline? Validated on 9,917 ECG records across 6 databases (Papers I and IV, Cardiac Torus series). Research prototype, not a medical device.

## Core Insight

The primary product value is Question 3: "Has it changed?" — continuous detection of rhythm deviation from a personal baseline using low-dimensional geometry. Question 2 ("Which dance?") provides context but has limited accuracy (52.7% overall). Question 1 ("Is it dancing?") is a safety gate. Design the system so that change detection works independently of dance classification accuracy.

## Two Build Targets

### Tier 1: Phone App (React Native + Expo)
- Connects to BLE pulse oximeter OR uses phone camera PPG
- Full torus visualization, dance identification, baseline learning
- Target: iOS + Android

### Tier 2: ESP32 Firmware (C/C++)
- Connects to BLE pulse oximeter as a client
- Drives 128×64 SSD1306 OLED via I²C
- Standalone — no phone required after setup
- Target: ESP32-S3 or ESP32-C3

Both targets share the same torus math and dance centroids. The `shared/` directory contains canonical constants used by both.

## Tech Stack

### Tier 1 (Phone App)
- **Framework:** React Native with Expo (managed workflow)
- **Language:** TypeScript (strict mode)
- **BLE:** `react-native-ble-plx`
- **Camera:** `expo-camera` for PPG spot-check mode
- **State:** React Context + useReducer. No Redux.
- **Storage:** `@react-native-async-storage/async-storage` for baseline persistence
- **Charts:** `react-native-svg` for torus display. No charting libraries.
- **Navigation:** `expo-router` (file-based routing)
- **Testing:** Jest + React Native Testing Library

### Tier 2 (ESP32)
- **Framework:** Arduino or ESP-IDF (PlatformIO recommended)
- **Language:** C++ (Arduino-style for accessibility)
- **BLE:** NimBLE (ESP32 as BLE central/client)
- **Display:** Adafruit_SSD1306 or u8g2 for OLED
- **Storage:** ESP32 NVS (non-volatile storage) for baseline
- **Build:** PlatformIO

## Critical Discovery: Fixed vs Adaptive Normalization

Found during initial build (Steps 1–5): **dance identification requires fixed normalization bounds (PPI_MIN=300, PPI_MAX=1500), not adaptive percentile-based normalization.** When the angle mapping uses the individual's narrow PPI range (adaptive), κ and Gini shift to values that do NOT match the empirical centroids from the research papers. The centroids were calibrated against population-wide bounds.

**Rule:**
- **Dance identification** → fixed normalization (PPI_MIN/PPI_MAX constants)
- **Torus visualization** → adaptive normalization (2nd–98th percentile of last 60 beats) for better visual spread
- **Change detection** → either works (relative to personal baseline, not absolute centroids)

The `torus-engine` functions accept `min`/`max` parameters. The caller decides which bounds to pass depending on the use case. Do not hardcode either normalization strategy inside the engine.

## Architecture Principles

1. **Shared math, separate platforms.** The torus algorithm, dance centroids, and quality thresholds are defined once in `shared/` and consumed by both app and firmware. Any change to the math must update both.
2. **Change detection is primary.** The system is most valuable as a personal baseline deviation detector. Dance identification is secondary context. Design the UI and alerts around "has your pattern shifted?" not "you have condition X."
3. **All computation is local.** Zero cloud. Zero network. Zero data leaves the device unless the user explicitly exports.
4. **PPG is not ECG.** The research was validated on ECG-derived RR intervals. PPG-derived pulse intervals are an approximation. Be honest about this everywhere — in the UI, in the docs, in the disclaimers.
5. **Never diagnose.** Display dance names, not clinical condition names. The mapping (Mosh Pit → AF, Lock-Step → CHF) exists in the research papers but is NOT surfaced in the consumer interface. The app says "Your heart is doing the Mosh Pit" — never "You have atrial fibrillation."
6. **Graceful degradation.** If signal quality drops, show grey/unknown. If dance match confidence < 30%, show "Uncertain." If baseline not yet established, show "Learning your pattern..." Never fake certainty.

## Key Constants (Shared)

```typescript
// shared/constants.ts (also mirrored in firmware/src/constants.h)

// Quality gating
export const PPI_MIN = 300;          // ms (200 BPM max)
export const PPI_MAX = 1500;         // ms (40 BPM min)
export const PPI_DEVIATION_MAX = 0.4; // 40% from running median = artifact
export const QUALITY_GOOD = 0.9;     // >90% acceptance rate
export const QUALITY_FAIR = 0.7;     // 70-90%
export const MIN_VALID_PPI = 20;     // in 30-beat window before torus computation

// Torus computation
export const TORUS_WINDOW = 60;      // beats in rolling window
export const KAPPA_WINDOW = 60;      // beats for κ median/Gini computation
export const DANCE_UPDATE_INTERVAL = 10; // beats between dance re-identification

// Dance centroids (empirical, from Paper IV)
export const DANCE_CENTROIDS = [
  { name: 'The Waltz',     clinical: 'NSR', kappa: 10.7, gini: 0.391, spread: 1.0 },
  { name: 'The Lock-Step', clinical: 'CHF', kappa: 24.0, gini: 0.353, spread: 0.4 },
  { name: 'The Sway',      clinical: 'SVA', kappa: 7.6,  gini: 0.510, spread: 1.2 },
  { name: 'The Mosh Pit',  clinical: 'AF',  kappa: 3.3,  gini: 0.512, spread: 2.0 },
  { name: 'The Stumble',   clinical: 'VA',  kappa: 1.2,  gini: 0.567, spread: 2.5 },
] as const;

// Normalization scales for distance computation
export const KAPPA_SCALE = 25;       // normalizes κ range
export const GINI_SCALE = 0.3;      // normalizes Gini range
export const SPREAD_SCALE = 2.0;    // normalizes spread range

// Confidence
export const CONFIDENCE_UNCERTAIN = 0.30; // below this: display "Uncertain"
export const CONFIDENCE_LOW = 0.50;       // below this: dim the label

// Baseline / Change detection
export const BASELINE_DURATION = 300;     // seconds (5 minutes) for initial baseline
export const BASELINE_MIN_BEATS = 200;    // minimum beats before baseline is valid
export const CHANGE_NOTICE_SIGMA = 2;     // Mahalanobis distance for notice
export const CHANGE_ALERT_SIGMA = 3;      // Mahalanobis distance for alert
export const CHANGE_ALERT_SUSTAIN = 60;   // seconds sustained before alert fires

// Display
export const TORUS_DISPLAY_POINTS = 60;   // max points shown on torus
export const MINI_TORUS_SIZE = 32;        // pixels (Tier 2 OLED)
```

## Data Models

```typescript
interface PulseSample {
  timestamp: number;     // Unix ms
  ppiMs: number;         // pulse-to-pulse interval in milliseconds
  source: 'ble_rr' | 'ble_hr' | 'camera_ppg';
  valid: boolean;
}

interface TorusPoint {
  theta1: number;        // [0, 2π)
  theta2: number;        // [0, 2π)
  kappa: number;         // Menger curvature at this point
  beatIndex: number;
}

interface DanceMatch {
  name: string;          // "The Waltz", "The Lock-Step", etc.
  confidence: number;    // 0-1
  runnerUp: string;
  runnerUpConfidence: number;
  kappaMedian: number;
  gini: number;
  spread: number;
  bpm: number;
}

interface PersonalBaseline {
  kappaMean: number;
  kappaSd: number;
  giniMean: number;
  giniSd: number;
  spreadMean: number;
  spreadSd: number;
  bpmMean: number;
  recordedAt: number;    // Unix ms
  beatCount: number;
}

interface ChangeStatus {
  mahalanobisDistance: number;
  level: 'normal' | 'notice' | 'alert';
  sustainedSince: number | null; // Unix ms when level first entered
}
```

## The Torus Math (Canonical)

```typescript
const TWO_PI = 2 * Math.PI;

function toAngle(value: number, min: number, max: number): number {
  if (max - min < 0.001) return Math.PI;
  return TWO_PI * Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function geodesicDistance(a: [number, number], b: [number, number]): number {
  let d1 = Math.abs(a[0] - b[0]);
  d1 = Math.min(d1, TWO_PI - d1);
  let d2 = Math.abs(a[1] - b[1]);
  d2 = Math.min(d2, TWO_PI - d2);
  return Math.sqrt(d1 * d1 + d2 * d2);
}

function mengerCurvature(
  p1: [number, number], p2: [number, number], p3: [number, number]
): number {
  const a = geodesicDistance(p2, p3);
  const b = geodesicDistance(p1, p3);
  const c = geodesicDistance(p1, p2);
  if (a < 1e-8 || b < 1e-8 || c < 1e-8) return 0;
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c);
  if (area2 <= 0) return 0;
  return (4 * Math.sqrt(area2)) / (a * b * c);
}

function giniCoefficient(values: number[]): number {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return 0;
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  let weighted = 0;
  v.forEach((val, i) => { weighted += (i + 1) * val; });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function matchDance(kappaMedian: number, giniVal: number, spread: number): DanceMatch {
  const distances = DANCE_CENTROIDS.map(d => ({
    dance: d,
    dist: Math.sqrt(
      Math.pow((kappaMedian - d.kappa) / KAPPA_SCALE, 2) +
      Math.pow((giniVal - d.gini) / GINI_SCALE, 2) +
      Math.pow((spread - d.spread) / SPREAD_SCALE, 2)
    ),
  }));
  distances.sort((a, b) => a.dist - b.dist);
  const totalInvDist = distances.reduce((s, d) => s + 1 / (d.dist + 0.01), 0);
  const confidence = (1 / (distances[0].dist + 0.01)) / totalInvDist;
  return {
    name: distances[0].dance.name,
    confidence,
    runnerUp: distances[1].dance.name,
    runnerUpConfidence: (1 / (distances[1].dist + 0.01)) / totalInvDist,
    kappaMedian, gini: giniVal, spread, bpm: 0,
  };
}
```

## Screen Structure (Tier 1)

```
app/
├── (tabs)/
│   ├── monitor.tsx       # Live torus + dance ID + 3 questions + baseline status
│   ├── history.tsx       # Past sessions list
│   └── settings.tsx      # Device pairing, baseline reset, camera PPG, about
├── session/
│   ├── [id].tsx          # Review past session
│   └── export.tsx        # Export
└── _layout.tsx
```

### Main Monitor Screen Layout
1. **Dance card** — Large centered: emoji + dance name + confidence % + runner-up
2. **Torus display** — Square, ~260px. Beat-pair trajectory with curvature coloring.
3. **Three questions** — Row of three small cards: "Is it dancing?" / "Which dance?" / "Has it changed?"
4. **Metrics row** — BPM | κ median | Gini | Baseline distance (σ)
5. **Signal quality** — Top right badge

### OLED Layout (Tier 2, 128×64 pixels)
```
Row 0-9:    [72 bpm]          [signal ●]
Row 10-51:  [32×32 torus] [WALTZ  ]
                          [78%     ]
Row 52-63:  [κ=10.7] [G=0.39] [✓]
```

## File Naming and Style

- Files: kebab-case (`torus-engine.ts`, `dance-matcher.ts`)
- Components: PascalCase (`TorusDisplay.tsx`, `DanceCard.tsx`)
- Firmware files: snake_case (`torus_engine.cpp`, `ble_client.cpp`)
- Constants: UPPER_SNAKE_CASE
- Functions: camelCase (TS) / snake_case (C++)
- Types/Interfaces: PascalCase
- No default exports except screen components
- Every torus math function must have a JSDoc/doxygen comment citing the source paper

## What NOT To Build

- No clinical condition names in the UI — no "atrial fibrillation", "heart failure", "arrhythmia"
- No user accounts, no login, no backend, no analytics, no cloud
- No Apple Health / Google Fit integration (unnecessary complexity, privacy risk)
- No waveform display — this is not an ECG viewer. We analyze intervals, not morphology.
- No diagnosis, no action recommendations beyond "consider checking with your provider"
- No ads, no tracking, no monetization hooks
- No social features
