/**
 * Export beat log CSV — tries expo-file-system + expo-sharing first,
 * falls back to clipboard copy via React Native's Clipboard.
 */
import { Alert } from 'react-native';
import { beatLogger } from './beat-logger';

function makeFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `cardiac-torus-${date}-${time}.csv`;
}

export async function exportBeatCSV(): Promise<void> {
  if (beatLogger.count === 0) {
    Alert.alert('No Data', 'No beats recorded yet. Start a session first.');
    return;
  }

  const csv = beatLogger.toCSV();
  const filename = makeFilename();

  // Try expo-file-system + expo-sharing first
  try {
    const FileSystem = await import('expo-file-system');
    const Sharing = await import('expo-sharing');

    if (FileSystem.cacheDirectory && Sharing.shareAsync) {
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, csv);
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Beat Data',
      });
      return;
    }
  } catch (_e) {
    // expo modules not available — fall through to clipboard
  }

  // Fallback: copy to clipboard
  try {
    const { default: Clipboard } = await import('expo-clipboard');
    if (Clipboard?.setStringAsync) {
      await Clipboard.setStringAsync(csv);
      Alert.alert('CSV Copied', `${beatLogger.count} beats copied to clipboard as CSV.`);
      return;
    }
  } catch (_e) {
    // expo-clipboard not available
  }

  // Last resort: React Native Clipboard
  try {
    const { Clipboard: RNClipboard } = require('react-native');
    if (RNClipboard?.setString) {
      RNClipboard.setString(csv);
      Alert.alert('CSV Copied', `${beatLogger.count} beats copied to clipboard as CSV.`);
      return;
    }
  } catch (_e) {
    // RN Clipboard not available
  }

  Alert.alert(
    'Export Unavailable',
    `${beatLogger.count} beats recorded but no export method is available. Install expo-sharing or expo-clipboard.`,
  );
}
