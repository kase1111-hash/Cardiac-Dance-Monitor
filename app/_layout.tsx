/**
 * Root layout — wraps every screen in the data-source context and a dark
 * native stack. Screens live under app/(tabs) and app/session.
 */
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DataSourceProvider } from '../src/context/data-source-context';

// Re-export expo-router's error boundary so a render-time exception on any
// screen shows a retry screen instead of closing the app.
export { ErrorBoundary } from 'expo-router';

// A cold deep link (e.g. /session/<id>) builds a stack containing only that
// screen, so "back" had nowhere to go. Anchoring the tabs as the initial
// route makes back always land on the app.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
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
