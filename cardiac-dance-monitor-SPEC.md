# SPEC.md — Cardiac Dance Monitor

## Overview

Build two targets from one shared math core:

**Tier 1 (Phone App):** React Native (Expo) app that connects to a BLE pulse oximeter or uses phone camera PPG, computes torus geometry, identifies the dance, tracks baseline deviation, and displays results.

**Tier 2 (ESP32 Firmware):** C++ firmware for ESP32 + SSD1306 OLED that connects to a BLE pulse oximeter, computes torus geometry, identifies the dance, and displays on a 128×64 pixel screen. No phone required.

Both share: torus math, dance centroids, quality thresholds, test vectors.

---

## 1. BLE Signal Acquisition

### 1.1 BLE Heart Rate Service

**Service UUID:** `0x180D`
**Characteristic UUID:** `0x2A37` (Heart Rate Measurement)

**Parsing (both platforms):**

```
Byte 0 (Flags):
  Bit 0: HR format (0 = uint8, 1 = uint16)
  Bit 4: RR-Interval present

Byte 1 (or 1-2): Heart Rate (BPM)

Remaining bytes (if RR flag set):
  Each RR interval = 2 bytes, uint16, units of 1/1024 second
  Convert: ppi_ms = rr_raw / 1.024
  Multiple RR values may be packed in one notification
```

**Priority:** Use RR intervals when available (true pulse timing). Fall back to HR-derived intervals (`ppi_ms = 60000 / hr_bpm`) only if RR flag is not set.

### 1.2 Connection Flow

**Tier 1 (Phone):**
1. Scan for BLE devices advertising `0x180D`
2. Show device list with name + RSSI
3. User selects → connect → subscribe to `0x2A37` notifications
4. On disconnect: auto-reconnect every 5 seconds for 2 minutes, then prompt user

**Tier 2 (ESP32):**
1. On boot, scan for BLE devices advertising `0x180D`
2. Connect to strongest signal (or saved MAC address from NVS)
3. Subscribe to `0x2A37`
4. On disconnect: continuous reconnect attempts, display "Scanning..." on OLED
5. Store last connected MAC in NVS for faster reconnection

### 1.3 Quality Gate

Applied per incoming PPI value:

```
IF ppi < 300 OR ppi > 1500:
    REJECT (outside 40-200 BPM range)

IF abs(ppi - runningMedian) > 0.4 * runningMedian:
    REJECT (likely artifact)

Track acceptance rate over last 30 beats:
    > 90% = GOOD
    70-90% = FAIR
    < 70% = POOR (display "Hold still" or "Check sensor")
```

Running median: maintained over last 15 valid PPIs (simple insertion sort on small buffer).

### 1.4 Phone Camera PPG (Tier 1 Only)

For spot checks when no external pulse ox is available:

1. Activate rear camera at 30 fps with flash on
2. User places fingertip over lens
3. Extract red channel mean intensity per frame
4. Band-pass filter: 0.5–4 Hz (30–240 BPM range)
5. Peak detection on filtered signal → PPI between consecutive peaks
6. Quality: require at least 10 consistent peaks before torus computation begins
7. Display "Place finger on camera..." → "Detecting pulse..." → "Recording..."

Camera PPG is noisier than BLE pulse ox. Set quality expectations lower: GOOD > 80% acceptance, FAIR > 60%.

---

## 2. Torus Computation

### 2.1 PPI Ring Buffer

Maintain a ring buffer of the last `TORUS_WINDOW` (60) valid PPIs.

**Normalization:** Compute 2nd and 98th percentiles of the buffer for adaptive angle mapping. Update percentiles every 10 new beats.

```typescript
// Adaptive normalization
const sorted = [...ppiBuffer].sort((a, b) => a - b);
const ppiMin = sorted[Math.floor(sorted.length * 0.02)];
const ppiMax = sorted[Math.floor(sorted.length * 0.98)];
```

### 2.2 Beat-Pair Points

For each new valid PPI (when buffer has ≥ 2 values):

```typescript
const theta1 = toAngle(ppiBuffer[n - 1], ppiMin, ppiMax);
const theta2 = toAngle(ppiBuffer[n], ppiMin, ppiMax);
torusPoints.push({ theta1, theta2, kappa: 0, beatIndex: totalBeats });
```

Keep last `TORUS_DISPLAY_POINTS` (60) for rendering.

### 2.3 Curvature

After each new point (when ≥ 3 points exist):

```typescript
const pts = torusPoints;
const n = pts.length;
pts[n - 2].kappa = mengerCurvature(
  [pts[n - 3].theta1, pts[n - 3].theta2],
  [pts[n - 2].theta1, pts[n - 2].theta2],
  [pts[n - 1].theta1, pts[n - 1].theta2]
);
kappaBuffer.push(pts[n - 2].kappa);
```

Maintain a `kappaBuffer` ring of last `KAPPA_WINDOW` (60) curvature values.

### 2.4 Feature Computation

Every `DANCE_UPDATE_INTERVAL` (10) beats:

```typescript
const positiveKappas = kappaBuffer.filter(k => k > 0);

const kappaMedian = median(positiveKappas);
const gini = giniCoefficient(positiveKappas);
const spread = std(thetas1) + std(thetas2);  // sum of angular standard deviations
const bpm = Math.round(60000 / mean(ppiBuffer));
```

### 2.5 Dance Matching

```typescript
const match = matchDance(kappaMedian, gini, spread);
// Returns: { name, confidence, runnerUp, runnerUpConfidence, ... }

if (match.confidence < CONFIDENCE_UNCERTAIN) {
  displayName = "Uncertain";
} else {
  displayName = match.name;
}
```

### 2.6 Dance Transition Handling

Track the identified dance over time:

```
IF newDance !== currentDance:
    IF newDance sustained for < 20 seconds (< ~25 beats):
        label = "transient" — display briefly but don't update current
    IF newDance sustained for ≥ 30 seconds:
        log transition: { from: currentDance, to: newDance, timestamp }
        currentDance = newDance
        IF newDance !== baselineDance:
            trigger change evaluation
```

This hysteresis prevents "Waltz → Sway → Waltz" flicker from normal autonomic variation.

---

## 3. Baseline and Change Detection

### 3.1 Baseline Learning

**First use:** The first 5 minutes (or `BASELINE_MIN_BEATS` = 200 beats, whichever is longer) of valid data establishes the personal baseline.

Display during learning: "Learning your pattern... X/200 beats"

```typescript
function computeBaseline(kappas: number[], ginis: number[], spreads: number[]): PersonalBaseline {
  return {
    kappaMean: mean(kappas),
    kappaSd: std(kappas),
    giniMean: mean(ginis),
    giniSd: std(ginis),
    spreadMean: mean(spreads),
    spreadSd: std(spreads),
    bpmMean: currentBpm,
    recordedAt: Date.now(),
    beatCount: kappas.length,
  };
}
```

Baseline is stored persistently (AsyncStorage on phone, NVS on ESP32). It survives app restarts and power cycles.

### 3.2 Mahalanobis Distance

Every `DANCE_UPDATE_INTERVAL` beats, compute distance from current features to baseline:

```typescript
function mahalanobisDistance(
  current: { kappa: number; gini: number; spread: number },
  baseline: PersonalBaseline
): number {
  const dk = (current.kappa - baseline.kappaMean) / Math.max(baseline.kappaSd, 0.01);
  const dg = (current.gini - baseline.giniMean) / Math.max(baseline.giniSd, 0.001);
  const ds = (current.spread - baseline.spreadMean) / Math.max(baseline.spreadSd, 0.01);
  return Math.sqrt(dk * dk + dg * dg + ds * ds);
}
```

### 3.3 Change Status

```
IF baseline not established:
    level = 'learning'

ELSE IF distance < CHANGE_NOTICE_SIGMA (2):
    level = 'normal'

ELSE IF distance < CHANGE_ALERT_SIGMA (3):
    level = 'notice'
    sustainedSince = first timestamp where distance crossed 2σ

ELSE IF distance >= CHANGE_ALERT_SIGMA (3):
    IF sustained for >= CHANGE_ALERT_SUSTAIN (60 seconds):
        level = 'alert'
    ELSE:
        level = 'notice'  // waiting for persistence
```

### 3.4 Baseline Management

- **User reset:** Settings → "Reset my baseline" → requires confirmation → clears stored baseline → re-enters learning mode
- **When to reset:** After cardioversion, new medication, major health event
- **Display:** Show baseline age: "Baseline recorded 3 days ago (4,200 beats)"

---

## 4. Display Components

### 4.1 Tier 1: Phone App

#### DanceCard
**Props:** `match: DanceMatch`, `changeStatus: ChangeStatus`

Central element. Shows:
- Emoji (🟢🔴🔵🟣🟡) sized 48px
- Dance name in large bold text, colored by dance
- Confidence percentage below
- Runner-up in small muted text
- Change status indicator in top-right corner: ✓ (normal), △ (notice), ! (alert)

If `confidence < CONFIDENCE_UNCERTAIN`: show grey "?" emoji with "Uncertain" label.
If baseline not established: show "Learning..." instead of change indicator.

#### TorusDisplay
**Props:** `points: TorusPoint[]`, `matchColor: string`, `size: number`

Square SVG, dark background. Grid lines at 25/50/75%. Diagonal reference line (the identity line: RR_n = RR_{n+1}). Points colored by recency (dim → bright). Line connecting consecutive points at low opacity. Latest point: white pulsing ring. Tap a point for details tooltip.

#### ThreeQuestions
**Props:** `isDancing: boolean`, `currentDance: string`, `changeLevel: string`

Row of three cards:
- "Is it dancing?" → "YES" (green) or "Checking..." (grey)
- "Which dance?" → dance name (colored) or "Uncertain" (grey)
- "Has it changed?" → "Stable" (green) / "Shifted" (yellow) / "Changed" (red) / "Learning" (grey)

#### MetricsRow
**Props:** `bpm: number`, `kappa: number`, `gini: number`, `sigma: number`

Horizontal row of four compact metric displays: BPM, κ, Gini, σ (baseline distance).

#### SignalQualityBadge
Same as fetal monitor spec — green/yellow/red/grey dot, top-right.

#### SessionHistory
List of past sessions. Each entry: date, duration, dominant dance, any change events. Tap to review.

### 4.2 Tier 2: OLED (128×64 pixels)

All rendering via SSD1306 library. White-on-black. No greyscale.

```
┌────────────────────────────────────┐
│ 72bpm                          [●] │  <- Row 0-9: BPM left, signal dot right
│ ┌──────┐                          │
│ │      │  WALTZ                    │  <- Row 10-51: 32×32 torus left, dance right
│ │  T²  │  78%                      │
│ │      │                           │
│ └──────┘                          │
│ κ=10.7  G=0.39  ✓                  │  <- Row 52-63: metrics + status
└────────────────────────────────────┘
```

**Mini-torus (32×32):** Each torus point maps to a pixel: `x = floor(theta1 / TWO_PI * 31)`, `y = floor(theta2 / TWO_PI * 31)`. Plot last 30 points. Newest point blinks (toggle every 500ms). Older points are static white pixels.

**Dance name:** Uppercase, 6×8 font. Max 10 characters fits comfortably.

**Status icon:** ✓ (normal), △ (notice), ! (alert), ? (learning/uncertain). Right-aligned bottom row.

**Update rate:** Refresh display once per beat or 1 Hz, whichever is slower. This prevents excessive OLED writes and reduces power.

---

## 5. Notification and Alert Logic

### 5.1 Change Alerts (Primary)

| Level | Visual (Phone) | Visual (OLED) | Haptic | Action |
|-------|---------------|---------------|--------|--------|
| learning | Grey "Learning..." | "?" icon | None | "Recording your baseline pattern..." |
| normal | Green ✓ | ✓ | None | None |
| notice | Yellow △ | △ | None | Log event. No notification. |
| alert | Red ! (pulsing) | ! (blinking) | Vibrate ×3 | "Your heart rhythm has shifted from your usual pattern. Consider checking with your provider." |

**Alert suppression:** Only one alert notification per 30-minute window to prevent notification fatigue during sustained rhythm changes.

### 5.2 Dance Transitions (Secondary)

When `currentDance` changes (sustained ≥ 30 seconds):
- Phone: Toast notification "Waltz → Mosh Pit" with timestamp
- OLED: Brief animation (old name slides left, new name slides in)
- Log the transition

### 5.3 Signal Loss

| Condition | Display |
|-----------|---------|
| BLE disconnected | "Scanning for sensor..." |
| Quality POOR (>30% rejection) | "Signal poor — hold still" |
| Quality FAIR (10-30% rejection) | Yellow signal badge, normal operation |
| No valid data for 30+ seconds | Grey state, "No pulse data" |

### 5.4 Safety Constraints

Identical to CLAUDE.md: no diagnosis, no clinical names, no action recommendations beyond "consider checking with your provider." Persistent disclaimer on phone. Brief disclaimer on OLED at boot: "Wellness tool — not medical" for 3 seconds.

---

## 6. ESP32 Firmware Modules

### 6.1 Module Map

```
firmware/src/
├── main.cpp              # Setup + loop. ~80 lines.
├── ble_client.cpp/.h     # BLE central: scan, connect, subscribe, parse 0x2A37
├── quality_gate.cpp/.h   # PPI validation: range, deviation, acceptance tracking
├── torus_engine.cpp/.h   # Ring buffers, angle mapping, curvature, Gini, spread
├── dance_matcher.cpp/.h  # Centroid lookup, confidence, transition hysteresis
├── baseline.cpp/.h       # NVS read/write, Mahalanobis computation, change status
├── display.cpp/.h        # SSD1306 rendering: mini-torus, text, icons, animations
└── config.h              # All constants (mirrors shared/constants.ts)
```

### 6.2 Main Loop

```cpp
void setup() {
    initDisplay();           // SSD1306 I²C init
    showSplash();            // "Cardiac Dance Monitor" + disclaimer, 3 sec
    loadBaseline();          // from NVS
    initBLE();               // start scanning
}

void loop() {
    // BLE notifications arrive via callback → onPPIReceived()
    // Main loop handles display refresh at 1 Hz
    if (millis() - lastDisplayUpdate > 1000) {
        renderDisplay();
        lastDisplayUpdate = millis();
    }
}

// BLE callback (runs on BLE task)
void onPPIReceived(uint16_t ppi_ms) {
    if (!qualityGate(ppi_ms)) return;
    pushPPI(ppi_ms);
    computeTorusPoint();
    computeCurvature();
    beatCount++;

    if (beatCount % DANCE_UPDATE_INTERVAL == 0) {
        computeFeatures();
        matchDance();
        if (baselineValid) {
            computeChangeStatus();
        } else if (beatCount >= BASELINE_MIN_BEATS) {
            establishBaseline();
        }
    }
}
```

### 6.3 Memory Layout

```
Ring buffers:
  ppiBuffer[60]     = 120 bytes (uint16_t)
  kappaBuffer[60]   = 240 bytes (float)
  torusTheta1[60]   = 240 bytes (float)
  torusTheta2[60]   = 240 bytes (float)

Dance centroids:    = 60 bytes (5 × 3 floats)
Baseline:           = 56 bytes (7 floats + timestamp)
Display framebuf:   = 1024 bytes (128×64 / 8)

Total RAM:          ≈ 2 KB of 512 KB available
```

### 6.4 Wiring

| ESP32 Pin | Component | Pin |
|-----------|-----------|-----|
| GPIO 21 | SSD1306 OLED | SDA |
| GPIO 22 | SSD1306 OLED | SCL |
| 3.3V | SSD1306 OLED | VCC |
| GND | SSD1306 OLED | GND |
| USB-C | Power | — |

No other connections needed. BLE is internal to ESP32.

---

## 7. Session Management (Tier 1 Only)

### 7.1 Auto-Record

The app automatically records while connected to a pulse source. No explicit "start/stop" required. A session begins when the first valid PPI arrives and ends when disconnected for > 5 minutes or the user navigates away.

### 7.2 Session Storage

```typescript
interface Session {
  id: string;
  startTime: number;
  endTime: number;
  dominantDance: string;
  beatCount: number;
  changeEvents: Array<{
    timestamp: number;
    level: 'notice' | 'alert';
    distance: number;
    danceBefore: string;
    danceAfter: string;
  }>;
  danceTransitions: Array<{
    timestamp: number;
    from: string;
    to: string;
  }>;
  summaryStats: {
    bpmMean: number;
    kappaMedian: number;
    giniMean: number;
  };
}
```

Store in AsyncStorage. Keep last 100 sessions. Export as CSV or PDF.

### 7.3 Export

**CSV:** One row per 10-beat window with: timestamp, bpm, κ_median, gini, spread, dance, confidence, baseline_distance.

**PDF:** One-page summary: session date/duration, dominant dance with torus snapshot, any change events, metrics summary, disclaimer.

---

## 8. Camera PPG Module (Tier 1 Only)

### 8.1 Activation

Settings → "Spot Check (Camera)" OR auto-offered if no BLE device is paired.

### 8.2 Pipeline

```
Camera (30fps, rear, flash ON)
    → Extract red channel mean per frame
    → Band-pass filter (Butterworth 2nd order, 0.5-4 Hz)
    → Peak detection (minimum 300ms inter-peak)
    → PPI = inter-peak interval in ms
    → Feed into same quality gate + torus pipeline
```

### 8.3 UI Flow

1. "Place your fingertip over the camera lens" + illustration
2. Camera preview turns on. Flash activates.
3. "Detecting pulse..." (waiting for first 5 consistent peaks)
4. "Recording... Hold still for 30 seconds" (torus begins computing)
5. After 30+ seconds with sufficient quality: show dance result
6. User can extend recording or tap "Done"

### 8.4 Constraints

- 30-second minimum for meaningful torus computation (~35-50 beats)
- Cannot run in background (camera requires foreground)
- Higher artifact rate than BLE pulse ox — quality thresholds relaxed
- Not suitable for continuous monitoring — spot check only

### 8.5 Camera vs Pulse Ox Equivalence Test

This is the cheapest possible validation experiment and should be run early in development. The question: does camera PPG preserve enough timing resolution for the torus geometry to work?

**Protocol:**
1. User wears BLE pulse oximeter on one hand
2. User places other hand's fingertip on phone camera (flash on)
3. App records both PPI streams simultaneously for 60 seconds
4. Compute torus features (κ median, Gini, spread) from both streams independently
5. Compare: Bland-Altman plot of κ_camera vs κ_pulseox, same for Gini
6. Compute dance identification from both — do they agree?

**Expected result:** At 30 fps, timing jitter (±33 ms) will inflate κ and blur Gini. The dance identification may still work for high-contrast dances (Lock-Step vs Mosh Pit) but fail for subtle distinctions (Waltz vs Sway). At 60 fps, results should be substantially better.

**What this tells us:**
- If camera PPG produces the same dance as pulse ox in >80% of trials: camera mode is viable as a standalone, and the $15 pulse ox becomes optional.
- If agreement is 50-80%: camera works for screening ("is something unusual?") but not identification.
- If agreement is <50%: camera PPG lacks the timing resolution for torus geometry, and the pulse ox is required.

**Implementation:** Build this as a hidden developer tool (Settings → "PPG Validation Mode"). Not user-facing — it's a research instrument. Output results as a CSV for offline analysis. This experiment should be one of the first things run after Phase 1 is complete.

**Finger position matters:** Fingertip on the camera lens (standard PPG position) will outperform any other body location. The flash provides the light source, the capillary bed provides the signal, and the thin tissue provides good transillumination. Do NOT test against veins, wrists, or other locations — they will be worse, not better.

---

## 9. Build Order

### Tier 1 Phase 1 (Data-only, no alerts):

1. Expo project scaffold with TypeScript strict + expo-router
2. Shared torus math module (`torus-engine.ts`) with full unit tests
3. Shared dance matcher module (`dance-matcher.ts`) with unit tests
4. BLE module — scan, connect, parse 0x2A37, extract RR/HR
5. Quality gate module — PPI filtering, acceptance tracking
6. Live BPM display + signal quality badge
7. Torus display component — SVG beat-pair trajectory
8. Dance card component — name, confidence, emoji
9. Three questions row
10. Metrics row (BPM, κ, Gini)
11. Session auto-record + history list
12. Simulation mode (5 rhythm scenarios for testing)

### Tier 1 Phase 2 (Baseline + alerts):

13. Baseline learning module — 5-min initial recording, NVS storage
14. Mahalanobis change detection
15. Change status display (normal/notice/alert)
16. Alert notifications + haptics
17. Dance transition hysteresis (transient vs sustained)
18. Camera PPG module
19. **Camera vs Pulse Ox equivalence test** (hidden dev tool — run immediately, report results before proceeding)
20. Session export (CSV + PDF)
21. Settings screen (device pairing, baseline reset, about)

### Tier 2 (ESP32):

22. PlatformIO project scaffold with ESP32-S3 target
23. Port torus math to C (`torus_engine.cpp`) with test harness
24. Port dance matcher to C (`dance_matcher.cpp`)
25. BLE client module (NimBLE, scan + connect + parse)
26. Quality gate (C port)
27. SSD1306 OLED display module — text, mini-torus, icons
28. Baseline module (NVS read/write, Mahalanobis)
29. Main loop integration
30. 3D enclosure design (STL)

---

## 10. Testing Checklist

### Torus Math
- [ ] `toAngle(300, 300, 1500)` → `0`
- [ ] `toAngle(1500, 300, 1500)` → `≈ 2π`
- [ ] `toAngle(900, 300, 1500)` → `≈ π`
- [ ] `geodesicDistance([0, 0], [π, π])` → `≈ π√2`
- [ ] `geodesicDistance([0.01, 0], [TWO_PI - 0.01, 0])` → `≈ 0.02` (wraps correctly)
- [ ] `mengerCurvature` of collinear points → `0`
- [ ] `giniCoefficient([1, 1, 1, 1])` → `0`
- [ ] `giniCoefficient([0.001, 0.001, 0.001, 100])` → `≈ 0.75`

### Dance Matching
- [ ] Input (κ=10.7, G=0.391, S=1.0) → "The Waltz" with high confidence
- [ ] Input (κ=24.0, G=0.353, S=0.4) → "The Lock-Step"
- [ ] Input (κ=3.3, G=0.512, S=2.0) → "The Mosh Pit"
- [ ] Input (κ=1.2, G=0.567, S=2.5) → "The Stumble"
- [ ] Input (κ=15, G=0.45, S=1.5) → some result with confidence < 0.5 (between dances)

### Quality Gate
- [ ] PPI = 299 → rejected
- [ ] PPI = 1501 → rejected
- [ ] PPI = 300 → accepted
- [ ] PPI = 1500 → accepted
- [ ] PPI = 800 when median = 800 → accepted
- [ ] PPI = 1200 when median = 800 → rejected (>40% deviation)

### Baseline & Change
- [ ] Baseline not established with < 200 beats → level = 'learning'
- [ ] Mahalanobis distance = 0 when current = baseline → level = 'normal'
- [ ] Mahalanobis distance = 2.5 → level = 'notice'
- [ ] Mahalanobis distance = 3.5 sustained 60s → level = 'alert'
- [ ] Mahalanobis distance = 3.5 sustained 30s → level = 'notice' (not sustained enough)

### BLE
- [ ] Parse 0x2A37 with RR flag set → extract correct PPI
- [ ] Parse 0x2A37 without RR flag → derive PPI from HR
- [ ] Reconnection after disconnect resumes without data loss

### Simulation
- [ ] NSR simulation → dominant dance "The Waltz"
- [ ] CHF simulation → dominant dance "The Lock-Step"
- [ ] AF simulation → dominant dance "The Mosh Pit"
- [ ] PVC simulation → dominant dance "The Stumble"
- [ ] Dance transition scenario → logged transition event

### ESP32 Specific
- [ ] Firmware compiles for ESP32-S3 target
- [ ] OLED displays splash screen on boot
- [ ] Mini-torus renders 30 points correctly in 32×32 space
- [ ] NVS baseline survives power cycle
- [ ] Total RAM usage < 10 KB

### Camera PPG Validation
- [ ] Camera PPG detects pulse within 10 seconds on fingertip
- [ ] Simultaneous camera + pulse ox: PPI correlation r > 0.8
- [ ] Simultaneous camera + pulse ox: κ median agreement within 30%
- [ ] Simultaneous camera + pulse ox: dance identification agrees >60% of 10-beat windows
- [ ] 60 fps mode produces measurably better PPI agreement than 30 fps
