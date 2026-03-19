import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DataSourceProvider } from '../src/context/data-source-context';

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
