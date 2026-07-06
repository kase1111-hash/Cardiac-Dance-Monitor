# Building a Distributable App

The app has two runtime tiers:

| Mode | Needs a dev build? | Why |
|------|--------------------|-----|
| **Simulated** rhythms | No — Expo Go works | Pure JS, no native modules |
| **Camera PPG**, **BLE / Innovo**, **chest accel** | **Yes** | VisionCamera, BLE-PLX, and expo-sensors are native modules absent from Expo Go |

So for any *useful* demo — real heart-rate capture — you need a **development build** (or a preview APK). Expo Go can only show the simulator.

## One-time setup

```bash
npm install -g eas-cli      # if you don't have it
eas login                   # Expo account (free)
eas init                    # links this repo to an EAS project, writes extra.eas.projectId
```

`eas init` is required before the first cloud build because `eas.json` uses
`"appVersionSource": "remote"`. It only has to be run once.

## Build an installable Android APK

```bash
eas build --profile development --platform android
```

- Uses the `development` profile in `eas.json`: a **developer-client APK**,
  `distribution: internal`, built against the SDK 52 image.
- When it finishes, EAS prints a URL and QR code. Open it on the phone to
  download and install the APK (allow "install from unknown sources").
- Then start the JS server and scan the dev-client QR:

  ```bash
  npx expo start --dev-client
  ```

The APK is the native shell (camera, BLE, sensors); the dev server ships the
JS. Rebuild the APK only when native deps or `app.json` change — day-to-day JS
edits just need the dev server.

### No-laptop-at-demo option: a self-contained preview build

The dev-client APK needs the Metro server running. For a build that runs
standalone on any phone with the JS already bundled in:

```bash
eas build --profile preview --platform android
```

Install that APK and launch it directly — no `expo start` needed. This is the
one to put on a demo phone.

## iOS

```bash
eas build --profile development --platform ios
```

Requires an Apple Developer account for device installs (EAS walks you through
signing). Simulator builds don't have a camera, so PPG can't be demoed there.

## What the build includes

`app.json` already declares everything the native build needs:

- **Permissions**: `CAMERA`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`,
  `ACCESS_FINE_LOCATION` (Android); `NSCameraUsageDescription` and
  `NSBluetoothAlwaysUsageDescription` (iOS)
- **Config plugins**: `react-native-ble-plx`, `react-native-vision-camera`
  (with `enableFrameProcessors: true`), `expo-build-properties` (Kotlin
  pin), and `./plugins/withKotlinFix`
- **Babel**: `react-native-worklets-core/plugin`, required for the camera
  frame processor

Verify the resolved config anytime with:

```bash
npx expo config --type prebuild
```

## Quick demo script once installed

1. Settings → long-press **About** for 3s to reveal the Developer section.
2. Monitor tab → Camera mode → place fingertip on the rear lens; watch the
   torch-lit preview pulse and the console log `CAMERA_FRAME` lines.
3. Or Simulated mode → Settings → **Establish Baseline Now** after ~20 beats,
   then switch the scenario to Mosh Pit and watch the change detector fire and
   the rate-vs-geometry strip diverge.
