/**
 * Share session — handles file I/O and sharing via expo APIs.
 *
 * Uses:
 * - expo-file-system for writing temp files
 * - expo-sharing for native share sheet
 * - expo-print for HTML → PDF conversion
 *
 * These are runtime-only (not available in Jest). The formatting logic
 * is tested via session-export.test.ts.
 */
import type { Session } from './session-types';
import { SessionExporter } from './session-export';

/**
 * Share session as CSV.
 * Requires expo-file-system and expo-sharing at runtime.
 */
export async function shareAsCSV(session: Session): Promise<void> {
  // Dynamic imports to avoid breaking Jest
  const FileSystem = await import('expo-file-system');
  const Sharing = await import('expo-sharing');

  const csv = SessionExporter.toCSV(session);
  const filename = SessionExporter.getFilename(session, 'csv');
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(fileUri, csv);
  await Sharing.shareAsync(fileUri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export Session CSV',
  });
}

/**
 * Share session as PDF.
 * Requires expo-print and expo-sharing at runtime.
 */
export async function shareAsPDF(session: Session): Promise<void> {
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');

  const html = SessionExporter.toHTML(session);
  const { uri } = await Print.printToFileAsync({ html });

  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Export Session PDF',
  });
}
