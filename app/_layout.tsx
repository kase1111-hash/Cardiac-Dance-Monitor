// DIAGNOSTIC BUILD — all require() to guarantee execution order
// (ES import statements get hoisted, defeating sequential logging)
console.log('APP_BOOT: _layout.tsx executing');

// === Probe native modules one by one ===
console.log('APP_BOOT: testing react-native-ble-plx...');
try {
  require('react-native-ble-plx');
  console.log('APP_BOOT: BLE OK');
} catch (e: any) {
  console.log('APP_BOOT: BLE FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-vision-camera...');
try {
  require('react-native-vision-camera');
  console.log('APP_BOOT: CAMERA OK');
} catch (e: any) {
  console.log('APP_BOOT: CAMERA FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-worklets-core...');
try {
  require('react-native-worklets-core');
  console.log('APP_BOOT: WORKLETS OK');
} catch (e: any) {
  console.log('APP_BOOT: WORKLETS FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-reanimated...');
try {
  require('react-native-reanimated');
  console.log('APP_BOOT: REANIMATED OK');
} catch (e: any) {
  console.log('APP_BOOT: REANIMATED FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-screens...');
try {
  require('react-native-screens');
  console.log('APP_BOOT: SCREENS OK');
} catch (e: any) {
  console.log('APP_BOOT: SCREENS FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-gesture-handler...');
try {
  require('react-native-gesture-handler');
  console.log('APP_BOOT: GESTURE OK');
} catch (e: any) {
  console.log('APP_BOOT: GESTURE FAILED: ' + e.message);
}

console.log('APP_BOOT: testing react-native-svg...');
try {
  require('react-native-svg');
  console.log('APP_BOOT: SVG OK');
} catch (e: any) {
  console.log('APP_BOOT: SVG FAILED: ' + e.message);
}

console.log('APP_BOOT: all native module probes complete');

// === Load app dependencies via require() to maintain order ===
console.log('APP_BOOT: loading React...');
const React = require('react');
console.log('APP_BOOT: React loaded');

console.log('APP_BOOT: loading expo-router...');
const { Stack } = require('expo-router');
console.log('APP_BOOT: expo-router loaded');

console.log('APP_BOOT: loading expo-status-bar...');
const { StatusBar } = require('expo-status-bar');
console.log('APP_BOOT: expo-status-bar loaded');

console.log('APP_BOOT: loading DataSourceProvider...');
const { DataSourceProvider } = require('../src/context/data-source-context');
console.log('APP_BOOT: DataSourceProvider loaded');

console.log('APP_BOOT: defining RootLayout');

export default function RootLayout() {
  console.log('APP_BOOT: RootLayout rendering');
  return (
    <DataSourceProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#05050a' },
        }}
      />
    </DataSourceProvider>
  );
}
