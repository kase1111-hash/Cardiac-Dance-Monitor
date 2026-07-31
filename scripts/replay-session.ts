/**
 * CLI: replay an exported beat CSV through the real pipeline and print a report.
 *
 * Usage:
 *   npx ts-node scripts/replay-session.ts path/to/beats.csv
 *   npx ts-node scripts/replay-session.ts path/to/beats.csv --json
 *   npx ts-node scripts/replay-session.ts day1.csv day2.csv day3.csv
 *
 * The CSV is the beat-logger export from a live session (the "Export CSV"
 * button on the monitor screen). Only the `timestamp` and `ppi_ms` columns
 * are required. This is the offline validation path: replay a real BLE or
 * camera recording and inspect the dance timeline, dropout gaps, and change
 * events the pipeline would have produced — deterministically.
 *
 * Pass several CSVs, oldest first, to replay them as CONSECUTIVE sessions of
 * one user: the baseline is learned once and every later session is judged
 * against it, exactly as the app does across days.
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import {
  parseBeatCSV, replaySession, replaySessions,
  formatReplayReport, formatMultiSessionReport,
  type ReplayBeat,
} from '../src/replay/session-replay';

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const paths = args.filter(a => !a.startsWith('--'));

  if (paths.length === 0) {
    console.error('Usage: replay-session.ts <beats.csv> [more.csv ...] [--json]');
    process.exit(1);
  }

  const recordings: ReplayBeat[][] = [];
  for (const path of paths) {
    const beats = parseBeatCSV(readFileSync(path, 'utf8'));
    if (beats.length === 0) {
      console.error('No usable beats found in ' + path);
      process.exit(1);
    }
    recordings.push(beats);
  }

  if (recordings.length === 1) {
    const result = await replaySession(recordings[0]);
    console.log(asJson ? JSON.stringify(result, null, 2) : formatReplayReport(result));
    return;
  }

  const result = await replaySessions(recordings);
  console.log(asJson
    ? JSON.stringify(result, null, 2)
    : formatMultiSessionReport(result, paths.map(p => basename(p))));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
