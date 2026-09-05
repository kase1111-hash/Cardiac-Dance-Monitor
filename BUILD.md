# Building and Demoing the App

The app has two runtime tiers:

| Mode | Needs a dev/preview build? | Why |
|------|----------------------------|-----|
| **Simulated** rhythms, chest breathing rate | No | Pure JS plus `expo-sensors`, which Expo Go bundles |
| **Camera PPG**, **Innovo BLE** | **Yes** | VisionCamera and BLE-PLX are native modules absent from Expo Go |

> **Expo Go caveat.** The project is pinned to Expo SDK 52. The Expo Go app in
> the stores only runs the *current* SDK, so it will refuse this project. For
> a demo, install the **preview APK** below; Expo Go is a developer
> convenience only, and needs the SDK 52 build from https://expo.dev/go.

## One-time setup

```bash
npm install -g eas-cli      # if you don't have it
eas login                   # Expo account (free)
eas init                    # links this repo to an EAS project, writes extra.eas.projectId
```

`eas init` is required before the first cloud build because `eas.json` uses
`"appVersionSource": "remote"`. It only has to be run once.

## The demo build: a self-contained preview APK

```bash
eas build --profile preview --platform android
```

Install that APK on the demo phone and launch it directly — no laptop, no
`expo start`. It contains the JS bundle, the app icon, the dark splash
screen, camera, Bluetooth and sensors. **This is the one to put on a demo
phone.**

## Developer build (day-to-day)

```bash
eas build --profile development --platform android   # dev-client APK
npx expo start --dev-client                           # then scan the QR
```

The APK is the native shell (camera, BLE, sensors); the dev server ships the
JS. Rebuild the APK only when native deps or `app.json` change — day-to-day JS
edits just need the dev server.

## iOS

```bash
eas build --profile development --platform ios
```

Requires an Apple Developer account for device installs (EAS walks you through
signing). Simulator builds don't have a camera, so PPG can't be demoed there.

## What the build includes

`app.json` already declares everything the native build needs:

- **Icon and splash**: `assets/icon.png`, `assets/adaptive-icon.png`,
  `assets/splash-icon.png` on the app's dark background
- **Permissions**: `CAMERA` and `BLUETOOTH_CONNECT` (Android); the
  `react-native-ble-plx` plugin adds `BLUETOOTH_SCAN` with
  `neverForLocation`, so Android 12+ needs no Location permission;
  `NSCameraUsageDescription` and `NSBluetoothAlwaysUsageDescription` (iOS)
- **Config plugins**: `expo-splash-screen`, `react-native-ble-plx`,
  `react-native-vision-camera` (with `enableFrameProcessors: true`),
  `expo-build-properties` (Kotlin pin), and `./plugins/withKotlinFix`
- **Babel**: `react-native-worklets-core/plugin`, required for the camera
  frame processor

Verify the resolved config anytime with:

```bash
npx expo config --type prebuild
```

## Pre-demo checklist

- Charge the phone; set the screen timeout to 10+ minutes; turn on Do Not Disturb.
- Bluetooth on (for the Innovo); camera permission granted (for camera mode).
- If the phone was used for rehearsal with a real sensor, Settings → **Reset
  Baseline** while that source is selected. Simulated and sensor baselines are
  stored separately, so a simulated rehearsal never affects the sensor one.
- Run the simulated script below once, end to end. Rehearsing it does not
  break the real run: a scenario switch while the baseline is learning
  restarts learning, and the alert banner's 30-minute suppression is cleared
  by every scenario switch.

## Demo script (simulated rhythms — works on any build)

Timings below were measured through the real pipeline at the simulator's
~75 BPM.

1. **First launch** shows a four-slide intro; the simulated source starts only
   after you tap **Start**. (Replay it later from Settings → Help.)
2. **Monitor tab, Waltz.** "Is it dancing? YES" at beat 10. The first dance
   name appears at beat 40 (~35 s); until then the card says "Waiting for
   data…". The torus fills with a diagonal orbit — the breathing rhythm.
3. **Baseline.** The indicator counts beats to 200, then observed rhythm to
   5:00. To skip the five-minute rule: Settings → long-press **About** for 3 s
   → **Developer** → **Establish Baseline Now**. It needs 200 beats and 10
   rhythm windows (about 3 minutes); a dialog confirms success or tells you
   how many beats are still needed. Do this while the Waltz is playing.
4. **The change.** Settings → Simulated Rhythm → **Mosh Pit**, then back to
   Monitor. "Has it changed?" reads "Checking…" for the first window, turns
   amber **Shifted** after ~30 s, and red **Changed** with a banner and three
   haptic pulses after ~90 s (the alert needs 60 s of sustained deviation —
   wait it out). The "Rate vs. rhythm geometry" strip keeps its Waltz history,
   so the flat heart-rate line and the jump in torus spread are visible side
   by side.
5. **Recovery.** Switch back to **Waltz**: after ~30 s the green "returned to
   baseline" banner appears and the third question reads **Stable**.
6. **History.** Tap the History tab: the current session is saved the moment
   you leave the Monitor tab, so it is already listed. Tap it for the
   transitions, change events, and CSV / PDF / raw-beat export.

Notes:
- A brief amber "Shifted" can occasionally flash on an unchanged Waltz right
  after a forced baseline; it clears on the next window.
- The **Transition** scenario switches from Waltz to Mosh Pit on its own at
  beat 100 and passes through in-between dance names for ~40 s while the
  60-beat window turns over. That is expected, not misidentification.
- Switching data source keeps the baseline (simulated and sensor baselines
  are separate); switching scenarios keeps an *established* baseline and
  restarts a *learning* one.

## Real sensors (preview or dev build)

**Camera:** Settings → **Camera** → grant the camera permission when
prompted → cover the rear lens *and* flash completely with a fingertip and
keep still. Beats start after about five detected pulses. Lifting the finger
stops the beats; "Signal lost" appears within 5 s. Confirm the BPM counter and
the signal badge update (CAMERA_FRAME console lines exist only in dev-client
builds attached to Metro).

**Innovo iP900BP-B:** power the oximeter on and insert a finger *before*
selecting **Innovo** in Settings. The scan gives up after 30 s; the Monitor
header then reads "tap to try again" with the reason (sensor not found,
Bluetooth off, permission denied). SpO₂ and the device's own BPM appear once
the oximeter locks on (5–10 s).
