# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A React Native (Expo) app that maps consecutive pulse intervals onto a flat torus T², computes geodesic curvature and Gini coefficient, and identifies one of five validated rhythm "dances." The primary value is **change detection** — continuous deviation from personal baseline using Mahalanobis distance. Research prototype, not a medical device.

Three data sources: simulated rhythms, BLE pulse oximeter (Innovo iP900BP-B via Nordic UART service), or phone camera PPG (fingertip on rear camera). A generic Heart Rate Service (0x180D) source is parsed in `ble-service.ts` but is not offered in the UI.

## Build and Run Commands

```bash
npm install                  # Install dependencies
npx expo start               # Start Expo dev server
npx expo start --android     # Start on Android
npx expo start --ios         # Start on iOS
npm test                     # Run all Jest tests
npm run test:watch           # Run tests in watch mode
npx jest path/to/test.ts     # Run a single test file
npm run lint                 # ESLint (eslint-config-expo, config in .eslintrc.js)
npm run replay beats.csv     # Replay an exported beat CSV through the pipeline (ts-node)
```

Tests use `ts-jest` with `node` environment. Test roots are `shared/` and `src/`. Test files live in `__tests__/` directories and must match `**/__tests__/**/*.test.ts`.

## Architecture

```
Signal Source → Quality Gate → Monitor Pipeline → Display
  (PPI)         (range+dev)    (dual normalization)
                                 ├── Adaptive → Torus display points
                                 └── Fixed    → κ, Gini, spread → Dance match
                                                      │
                                                 Baseline Service
                                                 (personal σ)
                                                      │
                                                 Change Detector
                                                 (Mahalanobis d)
```

### Dual Normalization (Critical Design Decision)

Dance identification uses **fixed normalization** (PPI_MIN=300, PPI_MAX=1500) because the empirical centroids were calibrated against population-wide bounds. Torus visualization uses **adaptive normalization** (2nd–98th percentile of rolling window) for visual spread. The `torus-engine` functions accept `min`/`max` parameters — the caller decides which bounds to pass. Do not hardcode either strategy inside the engine.

### Key Data Flow

1. Data source hook (`use-simulated-pulse-ox`, `use-innovo-pulse-ox`, or `use-camera-ppg`) produces PPIs
2. `useMonitorPipeline` hook is a thin React wrapper around `PipelineCore` (`src/pipeline/pipeline-core.ts`), which owns ring buffers, computes torus points with both normalizations, runs dance matching every 10 beats. The core is React-free and time-injected (every beat carries a timestamp) so `src/replay/session-replay.ts` can replay recorded/exported beat CSVs through the identical code path offline
3. `BaselineService` learns personal baseline from 200+ beats over 5+ minutes of *observed* rhythm. Progress is persisted while learning and reloaded on the next launch, so the thresholds accumulate across sessions; dropouts and the time between sessions are not credited. Baselines are namespaced per source kind (`simulated` vs `sensor`), so switching source never wipes one; switching simulated scenarios while still *learning* restarts learning so a rehearsed rhythm cannot widen the baseline. "Establish Baseline Now" (Developer mode) skips the 5-minute rule but still needs 200 beats and 10 feature windows
4. `ChangeDetector` computes Mahalanobis distance from baseline every 10 beats
5. Monitor screen (`app/(tabs)/monitor.tsx`) composes all display components. The in-progress session is checkpointed (upserted by id) whenever the Monitor tab loses focus, so History shows it immediately; per-beat data is stored under its own key per session
6. The displayed dance has two-window hysteresis in `PipelineCore`: a new name is adopted only when two consecutive feature windows agree

### Directory Layout

- **`shared/`** — Platform-agnostic core: torus math (`torus-engine.ts`), dance matching (`dance-matcher.ts`), quality gate, constants, types, simulator. All math is pure TS with no external dependencies.
- **`src/`** — App-specific code:
  - `ble/` — BLE connection and Innovo pulse ox protocol (Nordic UART, 0xFFF1 characteristic)
  - `camera/` — Camera PPG pipeline: Butterworth filter, peak detector, PPG processor
  - `alerts/` — Notice/alert escalation with 30-minute suppression
  - `baseline/` — Baseline learning service and change detector
  - `dance/` — Dance transition tracker (hysteresis, per SPEC 2.6)
  - `pipeline/` — `PipelineCore`: the pure, React-free pipeline shared by the live hook and replay
  - `replay/` — Session replay harness: parse exported beat CSVs and re-run them through the real pipeline deterministically
  - `hooks/` — React hooks for data sources and monitor pipeline
  - `display/` — UI components: TorusDisplay, DanceCard, ThreeQuestions, MetricsRow, etc.
  - `session/` — Session recording, CSV export, beat logging
  - `sensors/` — Chest accelerometer for respiratory rate
  - `context/` — Data source context (source selection state)
- **`app/`** — Expo Router screens: tabs for monitor, history, settings
- **`plugins/`** — Expo config plugins (Kotlin version fix)

### Innovo BLE Protocol

The Innovo iP900BP-B uses Nordic UART Service (`6e400001-b5a3-f393-e0a9-e50e24dcca9e`), NOT the standard Heart Rate Service. Data arrives on characteristic `0xFFF1` in two packet types:
- **2-byte**: raw PPG waveform at ~28 Hz (`01 XX`)
- **13-byte**: status packet with SpO2, HR, perfusion index (`3E SS 00 HR 00 PI ...`)

See `innovo-ble-protocol.md` for full protocol details.

## Design Rules

- **Never diagnose.** Display dance names ("The Mosh Pit"), never clinical condition names ("atrial fibrillation").
- **All computation is local.** Zero cloud, zero network, zero data leaves the device unless user explicitly exports.
- **Diagnostics go through `shared/debug.ts`** (`debugLog`, `IS_DEV`). React Native keeps `console.*` in release builds, so hot-path logging (per beat, per BLE sample, per render) must be dev-only.
- **Graceful degradation.** Signal quality drops → show grey/unknown. Confidence < 30% → "Uncertain." Baseline not established → "Learning your pattern..."
- **PPG is not ECG.** Be honest about this everywhere. The research was validated on ECG-derived RR intervals.
- **Dance centroids are empirically calibrated.** The values in `shared/constants.ts` were derived from 10 trials × 200 beats through the actual fixed-normalization pipeline. They differ from the Paper IV values due to the normalization difference.

## Naming Conventions

- Files: `kebab-case.ts`
- Components: `PascalCase.tsx`
- Constants: `UPPER_SNAKE_CASE`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- No default exports except screen components
- Path alias: `@shared/*` maps to `shared/*`

## TypeScript

Strict mode enabled. Extends `expo/tsconfig.base`. Target ESNext, module commonjs.

## Camera PPG Isolation

`CameraPPGView` is loaded via conditional `require()` inside the monitor component, never at the top level. This ensures VisionCamera crashes never affect BLE or simulated modes.
