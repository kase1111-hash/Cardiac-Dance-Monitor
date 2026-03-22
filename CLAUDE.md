# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A React Native (Expo) app that maps consecutive pulse intervals onto a flat torus T², computes geodesic curvature and Gini coefficient, and identifies one of five validated rhythm "dances." The primary value is **change detection** — continuous deviation from personal baseline using Mahalanobis distance. Research prototype, not a medical device.

Three data sources: BLE pulse oximeter (Innovo iP900BP-B via Nordic UART service), phone camera PPG (fingertip on rear camera), or simulated rhythms.

## Build and Run Commands

```bash
npm install                  # Install dependencies
npx expo start               # Start Expo dev server
npx expo start --android     # Start on Android
npx expo start --ios         # Start on iOS
npm test                     # Run all Jest tests
npm run test:watch           # Run tests in watch mode
npx jest path/to/test.ts     # Run a single test file
npx expo lint                # Lint
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
2. `useMonitorPipeline` hook owns ring buffers, computes torus points with both normalizations, runs dance matching every 10 beats
3. `BaselineService` learns personal baseline from first 200+ beats over 5+ minutes
4. `ChangeDetector` computes Mahalanobis distance from baseline every 10 beats
5. Monitor screen (`app/(tabs)/monitor.tsx`) composes all display components

### Directory Layout

- **`shared/`** — Platform-agnostic core: torus math (`torus-engine.ts`), dance matching (`dance-matcher.ts`), quality gate, constants, types, simulator. All math is pure TS with no external dependencies.
- **`src/`** — App-specific code:
  - `ble/` — BLE connection and Innovo pulse ox protocol (Nordic UART, 0xFFF1 characteristic)
  - `camera/` — Camera PPG pipeline: Butterworth filter, peak detector, PPG processor
  - `baseline/` — Baseline learning service and change detector
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
