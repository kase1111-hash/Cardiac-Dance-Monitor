# Cardiac Dance Monitor

**See your heartbeat's dance on a $15 pulse oximeter.**

Your heart doesn't just beat — it dances. Map consecutive pulse intervals onto a flat torus, compute the geodesic curvature, and identify whether your heart is waltzing (healthy sinus), lock-stepping (heart failure), swaying (supraventricular), moshing (atrial fibrillation), or stumbling (ectopic beats). The math is 20 lines of code. It runs on a $5 chip. The display is a postage stamp with a donut on it.

> **⚠️ RESEARCH PROTOTYPE — NOT A MEDICAL DEVICE**
> This software has been validated retrospectively on ECG databases (9,917 records, 6 databases). PPG-derived pulse intervals have not been formally validated for torus analysis. This does not diagnose medical conditions. If you experience chest pain, shortness of breath, or dizziness, seek medical attention immediately.

---

## What It Does

The system answers three questions in real time:

| # | Question | How it's answered | Update rate |
|---|----------|-------------------|-------------|
| **1** | **Is it dancing?** | Consistent pulse intervals detected in a 10-beat window | Every beat |
| **2** | **Which dance?** | Nearest-neighbor to empirical centroids in (κ, Gini, spread) space | Every 10 beats |
| **3** | **Has it changed?** | Mahalanobis distance from personal baseline. 6σ = notice, 12σ = alert | Every 10 beats |

Question 3 is the primary product value: continuous, low-cost detection of rhythm deviation from YOUR normal pattern. Question 2 provides geometric context. Question 1 is the safety gate.

### The Five Dances

From Paper IV of the Cardiac Torus series, validated on 300 classified recordings:

| Dance | Clinical | κ | Gini | What it looks like on T² |
|-------|----------|---|------|--------------------------|
| 🟢 **The Waltz** | Normal Sinus | 10.7 | 0.391 | Smooth diagonal orbit with respiratory modulation |
| 🔴 **The Lock-Step** | Heart Failure | 24.0 | 0.353 | Tight compressed cluster — rigid, no variation |
| 🔵 **The Sway** | SVA | 7.6 | 0.510 | Loose structured orbit — organized irregularity |
| 🟣 **The Mosh Pit** | Atrial Fibrillation | 3.3 | 0.512 | Chaotic scatter — no repeating pattern |
| 🟡 **The Stumble** | PVCs / VA | 1.2 | 0.567 | Waltz + sudden launches from ectopic beats |

> The κ/Gini values above are the **Paper IV** figures. The running app uses
> its own centroids (in `shared/constants.ts`), empirically re-calibrated
> through the app's fixed-normalization pipeline — they differ from the paper
> because of the normalization step. Same five dances, app-specific numbers.

---

## In the App

| Screen | What it does |
|--------|--------------|
| **Onboarding** | First-run walkthrough of what the torus means (replayable from Settings → Help) |
| **Monitor** | Live torus trajectory, BPM/SpO₂, dance card, and a **rate-vs-geometry strip** showing how heart rate can stay flat while the rhythm's geometry transforms |
| **History** | Auto-recorded sessions (the current one is saved the moment you leave the Monitor tab); tap for detail (transitions, change events) and export as CSV / PDF / raw per-beat CSV |
| **Settings** | Pick a data source (simulated, Innovo, camera), choose the simulated rhythm, tune the quality indicator, reset the baseline, export the live beat log, replay the intro. Long-press **About** (3 s) for the Developer section: PPG validation mode, Establish Baseline Now, and the chest breathing-rate toggle |

**Three data sources:** simulated rhythms, an Innovo iP900BP-B Bluetooth
pulse oximeter, or the phone's rear camera as a PPG sensor. Simulated mode
runs on any build; the two sensors need a development or preview build (see
[BUILD.md](BUILD.md)). The baseline and session history persist across
restarts via AsyncStorage; simulated and sensor baselines are kept separately.

---

## Three Implementation Tiers

### Tier 1: Soft Mod — Phone App ($0–$40)

Pair a Bluetooth pulse oximeter with the phone app. Or use the phone camera as a PPG sensor (fingertip on rear camera + flash) for spot checks at $0.

```
┌──────────────┐      BLE       ┌──────────────┐
│  Pulse Ox     │──────────────▶│  Phone App    │
│  iP900BP-B   │  PPG + SpO₂   │  Torus + Dance│
│  ~$15-40      │               │  + Baseline   │
└──────────────┘               └──────────────┘
```

### Tier 2: Hard Mod — ESP32 + OLED ($20–$60) — vision, not in this repo

A standalone device that intercepts the BLE stream, computes the torus, and drives a dedicated display. No phone required after initial setup. (The CMS50D-BT in this diagram is part of the Tier 2 vision; the phone app supports the Innovo iP900BP-B.)

```
┌──────────────┐      BLE       ┌──────────────────────────┐
│  Pulse Ox     │──────────────▶│  ESP32-S3                │
│  CMS50D-BT   │  HR + PPI     │  ┌──────────────────┐    │
│  ~$15-40      │               │  │ torus_engine.cpp │    │
└──────────────┘               │  │ dance_matcher    │    │
                                │  │ baseline.cpp     │    │
                                │  └────────┬─────────┘    │
                                │           │ I²C          │
                                │  ┌────────▼─────────┐    │
                                │  │ SSD1306 OLED     │    │
                                │  │ 128×64 px        │    │
                                │  │ ┌────┐           │    │
                                │  │ │T²  │ WALTZ 78% │    │
                                │  │ └────┘ κ=10.7    │    │
                                │  │ 72bpm  G=0.391   │    │
                                │  └──────────────────┘    │
                                └──────────────────────────┘
```

### Tier 3: Product Vision — Custom Clip-On (Future)

Integrated PPG sensor + ESP32 + display in a single fingertip clip. Glance at your finger, see your dance.

---

## Architecture

```
Signal ──▶ Quality Gate ──▶ Torus Engine ──▶ Dance Matcher ──▶ Display
 (PPI)     (300-1500ms)    (θ₁,θ₂,κ,G)    (nearest centroid)  (name+torus)
                                │
                                ▼
                           Baseline Store
                           (personal σ)
                                │
                                ▼
                           Change Detector
                           (Mahalanobis d)
```

**Core computation per beat:** ~3 ms on ESP32 at 240 MHz. The chip is idle 99.7% of the time.

**Total state:** ~500 bytes (60 PPI ring buffer + 60 κ buffer + 5 centroids + baseline).

---

## Tech Stack

### Tier 1 (Phone App)

| Layer | Technology |
|-------|-----------|
| Framework | React Native + Expo Router (iOS + Android) |
| BLE | `react-native-ble-plx` (Innovo iP900BP-B via Nordic UART) |
| Camera PPG | `react-native-vision-camera` frame processor + red-channel peak detection |
| Math | Pure TS — no external libraries |
| Storage | AsyncStorage (baseline + session persistence) |
| Visualization | `react-native-svg` for torus, sparklines, and onboarding |

### Tier 2 (ESP32)

| Layer | Technology |
|-------|-----------|
| Platform | ESP-IDF or Arduino framework |
| BLE | NimBLE stack (ESP32 as BLE client) |
| Display | SSD1306 via I²C (Adafruit_SSD1306 or u8g2) |
| Math | C — ~50 lines for torus engine |
| Storage | NVS flash for baseline persistence |
| Power | LiPo 500–1000 mAh, 6–12 hour runtime |

---

## Getting Started

### Tier 1: Phone App

```bash
git clone https://github.com/kase1111-hash/cardiac-dance-monitor.git
cd cardiac-dance-monitor

npm install
npm test              # 400+ Jest tests, no device needed
eas build --profile preview --platform android   # self-contained demo APK
```

The preview APK is the demo path: it bundles the JS plus the camera and
Bluetooth native modules, so every mode works with no laptop attached. See
**[BUILD.md](BUILD.md)** for the one-time EAS setup, the developer build, and
a timed demo script.

`npx expo start` with Expo Go is a developer convenience for the simulated
mode only, and the Expo Go in the app stores no longer runs this project's
SDK 52 — use the SDK 52 build from https://expo.dev/go if you need it.

### Tier 2: ESP32 Hard Mod

The Tier 2 firmware is future work and is **not in this repository**. The
wiring and bill of materials below describe the intended hardware.

**Wiring:**

| ESP32 Pin | OLED Pin |
|-----------|----------|
| GPIO 21 (SDA) | SDA |
| GPIO 22 (SCL) | SCL |
| 3.3V | VCC |
| GND | GND |

---

## Project Structure

This repository is the **Tier 1 phone app**. (Tier 2 firmware and Tier 3
hardware are described above as the project vision; they are not in this repo.)

Useful commands: `npm test` (Jest), `npm run lint` (ESLint via
`eslint-config-expo`), `npm run replay path/to/beats.csv` (replay an
exported beat log through the real pipeline offline).

```
cardiac-dance-monitor/
├── app/                          # Expo Router screens
│   ├── (tabs)/
│   │   ├── monitor.tsx           # Main screen: torus, dance, comparison strip
│   │   ├── history.tsx           # Session list (tap → detail)
│   │   └── settings.tsx          # Data source, baseline, export, dev tools
│   ├── session/[id].tsx          # Session detail + CSV/PDF/raw export
│   ├── +not-found.tsx            # Fallback for unknown routes
│   ├── index.tsx                 # Redirects to the Monitor tab
│   └── _layout.tsx               # Root stack + error boundary
│
├── assets/                       # App icon, adaptive icon, splash image
│
├── shared/                       # Platform-agnostic core (pure TS, tested)
│   ├── torus-engine.ts           # Angle mapping, Menger curvature, Gini
│   ├── dance-matcher.ts          # Nearest-centroid dance identification
│   ├── quality-gate.ts           # PPI range + deviation filtering
│   ├── signal-watchdog.ts        # Dropout-gap detection
│   ├── constants.ts              # Empirical centroids, PPI bounds, thresholds
│   ├── dance-colors.ts, types.ts # Dance palette/emoji, shared types
│   └── simulator.ts              # Rhythm simulator (NSR, CHF, AF, PVC, transition)
│
├── src/                          # App-specific code
│   ├── alerts/                   # Notice/alert escalation + 30-min suppression
│   ├── ble/                      # BLE + Innovo Nordic UART protocol
│   ├── camera/                   # Camera PPG: Butterworth, peak detect, processor
│   ├── baseline/                 # Baseline learning + change detector (Mahalanobis)
│   ├── dance/                    # Dance transition tracker (hysteresis)
│   ├── pipeline/                 # PipelineCore: the React-free monitor pipeline
│   ├── replay/                   # Offline replay of exported beat CSVs
│   ├── hooks/                    # Data-source + monitor-pipeline + onboarding hooks
│   ├── display/                  # Torus, dance card, comparison strip, onboarding
│   ├── session/                  # Recording, CSV export, session store, sharing
│   ├── sensors/                  # Chest accelerometer for respiratory rate
│   └── context/                  # Data-source selection state
│
├── scripts/replay-session.ts     # CLI for the offline replay (npm run replay)
├── plugins/                      # Expo config plugins (Kotlin version guard)
├── BUILD.md                      # EAS build guide + timed demo script
└── CLAUDE.md                     # Architecture notes for contributors
```

Core math lives in `shared/` with no React or native dependencies, so it runs
under Jest directly (`npm test` — 416 tests across torus math, dance
matching, baseline, change detection, PPG pipeline, storage, and the
app-startup safety net).

---

## The Torus Math (Complete)

```
// Map consecutive pulse intervals to torus
θ₁ = 2π × clamp((PPI_n − PPI_min) / (PPI_max − PPI_min), 0, 1)
θ₂ = 2π × clamp((PPI_{n+1} − PPI_min) / (PPI_max − PPI_min), 0, 1)

// Geodesic distance (periodic boundaries)
d(a, b) = √[ min(|θa−θb|, 2π−|θa−θb|)² + min(|φa−φb|, 2π−|φa−φb|)² ]

// Menger curvature from three consecutive points
a = d(p2,p3),  b = d(p1,p3),  c = d(p1,p2)
s = (a+b+c)/2
κ = 4√(s(s−a)(s−b)(s−c)) / (a×b×c)

// Dance identification
nearest centroid in (κ_median, Gini, spread) space
confidence = (1/d_best) / Σ(1/d_i)

// Change detection
Mahalanobis distance from personal baseline
6σ = notice, 12σ = alert
```

**That's the entire algorithm.** Everything else is signal acquisition and display.

---

## Quality Gating

| Check | Threshold | Action |
|-------|-----------|--------|
| PPI range | 300–1500 ms (40–200 BPM) | Reject |
| PPI deviation | >40% from running median | Reject |
| Acceptance rate | >90% = good, 70–90% = fair, <70% = poor | Display quality badge |
| Minimum valid PPIs | 20 in 30-beat window | Required before torus computation |

---

## The PPG-to-Torus Gap

PPG-derived pulse intervals (PPI) are not identical to ECG-derived RR intervals. The pulse transit time (PTT) adds a delay of 150–300 ms, and PTT varies with blood pressure and autonomic tone. However, the torus maps consecutive interval PAIRS — and beat-to-beat PTT variability (2–5 ms) is small relative to RR interval variability (20–100 ms). The curvature geometry is preserved.

**What needs formal validation:**
- PPG vs ECG torus feature comparison (κ, Gini) using simultaneous recordings
- Datasets available: PPG-DaLiA (15 subjects), WESAD (15 subjects), MIMIC-III (thousands of patients)
- If PPG-derived dance identification matches ECG-derived, the entire Paper I validation transfers

---

## Roadmap

- [x] **Phase 1:** Phone app with BLE pulse ox pairing + torus visualization + dance ID (data-only, no alerts)
- [x] **Phase 2:** Camera PPG mode + baseline learning + change detection
- [ ] **Phase 3:** ESP32 firmware with OLED display (Tier 2 hard mod)
- [ ] **Phase 4:** PPG equivalence validation (PPG-DaLiA or WESAD dataset)
- [ ] **Phase 5:** 3D-printable enclosure + hardware assembly guide
- [ ] **Phase 6:** Longitudinal pilot (30+ days, 100+ users, baseline stability testing)

---

## Bill of Materials (Tier 2 Hard Mod)

| Component | Example | Cost |
|-----------|---------|------|
| BLE Pulse Oximeter | CMS50D-BT / BerryMed BM1000C (Tier 2 vision; the phone app supports the Innovo iP900BP-B) | $15–40 |
| ESP32-S3 module | Seeed XIAO ESP32-S3 | $3–5 |
| SSD1306 OLED 0.96" | 128×64, I²C, white | $2–4 |
| LiPo battery | 500 mAh, 3.7V, JST | $2–3 |
| 3D-printed enclosure | PLA, ~30 min print | $1–3 |
| Misc (wires, USB-C) | Perfboard or custom PCB | $2–5 |
| **TOTAL** | | **$25–60** |

---

## Use Cases

- **Personal rhythm awareness** — Learn what your normal heart pattern looks like. Notice when it changes.
- **AF burden tracking** — Log Mosh Pit episodes with timestamps and durations. Share with your cardiologist.
- **Post-ablation monitoring** — Did the rhythm stay corrected? Watch the dance shift from Mosh Pit back to Waltz.
- **Medication tracking** — How does your heart geometry change with new medications or dose adjustments?
- **The bedside clock** — ESP32 + OLED next to a hospital bed. Nurse glances: Waltz ✓ or Mosh Pit ⚠️.
- **Sleep monitoring** — Clip-on pulse ox overnight. Review your dance trajectory in the morning.

---

## Related

- [Cardiac Torus](https://github.com/kase1111-hash/Cardiac_Torus) — Full research pipeline, papers, and validation
- [Fetal Contraction Monitor](https://github.com/kase1111-hash/fetal-contraction-monitor) — Fetal monitoring via contraction-response geometry
- [Interactive Visualizer](https://cardiactorus.netlify.app/) — Paper I: 13 cardiac conditions on the torus
- [Trilogy Visualizer](https://cardiactorus-trilogy.netlify.app/) — Papers I–III: rhythm, imaging, sound

---

## Citation

```bibtex
@article{branham2026donut,
  title={The Donut Dance: A Universal Geometric Vocabulary for Cardiac Dynamics on T²},
  author={Branham, Kase},
  year={2026},
  note={Paper IV, Cardiac Torus Series. Independent Researcher, Portland, OR}
}
```

---

## License

MIT

---

*Not "your heart rate is 72" but "your heart is waltzing." Three questions. A $5 chip. A postage-stamp screen. The geometry of the pump, visible on your fingertip, for the rest of your life.*
