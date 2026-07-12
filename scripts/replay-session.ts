/**
 * CLI: replay an exported beat CSV through the real pipeline and print a report.
 *
 * Usage:
 *   npx ts-node scripts/replay-session.ts path/to/beats.csv
 *   npx ts-node scripts/replay-session.ts path/to/beats.csv --json
 *
 * The CSV is the beat-logger export from a live session (the "Export CSV"
 * button on the monitor screen). Only the `timestamp` and `ppi_ms` columns
 * are required. This is the offline validation path: replay a real BLE or
 * camera recording and inspect the dance timeline, dropout gaps, and change
 * events the pipeline would have produced — deterministically.
 */
import { readFileSync } from 'fs';
import {
  parseBeatCSV, replaySession, formatReplayReport,
} from '../src/replay/session-replay';

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const path = args.find(a => !a.startsWith('--'));

  if (!path) {
    console.error('Usage: replay-session.ts <beats.csv> [--json]');
    process.exit(1);
  }

  const csv = readFileSync(path, 'utf8');
  const beats = parseBeatCSV(csv);
  if (beats.length === 0) {
    console.error('No usable beats found in ' + path);
    process.exit(1);
  }

  const result = await replaySession(beats);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatReplayReport(result));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
