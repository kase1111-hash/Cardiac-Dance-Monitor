/**
 * Fallback for unknown routes (bad deep link, stale session id). Without it
 * expo-router shows its own developer "Unmatched Route" screen.
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.center}>
        <Text style={styles.title}>Nothing here</Text>
        <Text style={styles.body}>That screen does not exist.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(tabs)/monitor')}>
          <Text style={styles.buttonText}>Back to Monitor</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#05050a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  title: { color: '#e2e8f0', fontSize: 22, fontWeight: '700' },
  body: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  button: {
    marginTop: 12, backgroundColor: '#22c55e', paddingHorizontal: 24,
    paddingVertical: 12, borderRadius: 10,
  },
  buttonText: { color: '#05050a', fontSize: 15, fontWeight: '700' },
});
