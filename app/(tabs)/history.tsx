/**
 * History tab — placeholder. Lists past sessions (Step 12).
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Past sessions will appear here</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#05050a',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 8,
  },
});
