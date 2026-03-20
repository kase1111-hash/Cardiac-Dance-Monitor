/**
 * Session export — generates CSV and HTML (for PDF via expo-print).
 *
 * Per SPEC Section 7:
 * - CSV: machine-readable session summary
 * - HTML → PDF: human-readable report with disclaimer
 *
 * File operations (expo-file-system, expo-sharing, expo-print)
 * are handled by the UI layer, not this module.
 */
import type { Session, RawBeat } from './session-types';

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function formatDuration(startMs: number, endMs: number): string {
  const s = Math.round((endMs - startMs) / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}m ${sec}s`;
}

export class SessionExporter {
  /**
   * Generate CSV representation of a session.
   */
  static toCSV(session: Session): string {
    const lines: string[] = [];

    // Summary header
    lines.push('Session ID,Start Time,End Time,Duration,Dominant Dance,Beat Count,BPM Mean,Kappa Median,Gini Mean');
    lines.push([
      session.id,
      formatTimestamp(session.startTime),
      formatTimestamp(session.endTime),
      formatDuration(session.startTime, session.endTime),
      session.dominantDance,
      session.beatCount,
      session.summaryStats.bpmMean,
      session.summaryStats.kappaMedian,
      session.summaryStats.giniMean,
    ].join(','));

    lines.push('');

    // Change Events
    lines.push('Change Events');
    if (session.changeEvents.length === 0) {
      lines.push('No change events');
    } else {
      lines.push('Timestamp,Level,Distance,Dance Before,Dance After');
      for (const e of session.changeEvents) {
        lines.push([
          formatTimestamp(e.timestamp),
          e.level,
          e.distance,
          e.danceBefore,
          e.danceAfter,
        ].join(','));
      }
    }

    lines.push('');

    // Dance Transitions
    lines.push('Dance Transitions');
    if (session.danceTransitions.length === 0) {
      lines.push('No dance transitions');
    } else {
      lines.push('Timestamp,From,To');
      for (const t of session.danceTransitions) {
        lines.push([
          formatTimestamp(t.timestamp),
          t.from,
          t.to,
        ].join(','));
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate HTML representation for PDF export (via expo-print).
   */
  static toHTML(session: Session): string {
    const changeRows = session.changeEvents.length === 0
      ? '<tr><td colspan="5">No change events</td></tr>'
      : session.changeEvents.map(e => `
          <tr>
            <td>${formatTimestamp(e.timestamp)}</td>
            <td>${e.level}</td>
            <td>${e.distance.toFixed(2)}</td>
            <td>${e.danceBefore}</td>
            <td>${e.danceAfter}</td>
          </tr>`).join('');

    const transitionRows = session.danceTransitions.length === 0
      ? '<tr><td colspan="3">No dance transitions</td></tr>'
      : session.danceTransitions.map(t => `
          <tr>
            <td>${formatTimestamp(t.timestamp)}</td>
            <td>${t.from}</td>
            <td>${t.to}</td>
          </tr>`).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 20px; color: #1a1a2e; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .disclaimer { background: #fff3cd; border: 1px solid #ffc107; padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; font-size: 11px; color: #856404; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { border: 1px solid #dee2e6; padding: 6px 8px; text-align: left; font-size: 12px; }
    th { background: #f8f9fa; font-weight: 600; }
    .section { margin-top: 16px; }
    .section h2 { font-size: 14px; margin-bottom: 8px; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .stat-item { background: #f8f9fa; padding: 8px; border-radius: 4px; }
    .stat-label { font-size: 10px; color: #6c757d; }
    .stat-value { font-size: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Rhythm Session Report</h1>
  <div class="disclaimer">RESEARCH PROTOTYPE — Not a medical device. This report is for informational purposes only.</div>

  <div class="stat-grid">
    <div class="stat-item">
      <div class="stat-label">Session ID</div>
      <div class="stat-value">${session.id}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Duration</div>
      <div class="stat-value">${formatDuration(session.startTime, session.endTime)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Dominant Dance</div>
      <div class="stat-value">${session.dominantDance}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Beat Count</div>
      <div class="stat-value">${session.beatCount}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Mean BPM</div>
      <div class="stat-value">${session.summaryStats.bpmMean}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Kappa Median</div>
      <div class="stat-value">${session.summaryStats.kappaMedian.toFixed(1)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Gini Mean</div>
      <div class="stat-value">${session.summaryStats.giniMean.toFixed(3)}</div>
    </div>
  </div>

  <table>
    <tr>
      <th>Start</th>
      <th>End</th>
    </tr>
    <tr>
      <td>${formatTimestamp(session.startTime)}</td>
      <td>${formatTimestamp(session.endTime)}</td>
    </tr>
  </table>

  <div class="section">
    <h2>Change Events</h2>
    <table>
      <tr><th>Time</th><th>Level</th><th>Distance</th><th>Before</th><th>After</th></tr>
      ${changeRows}
    </table>
  </div>

  <div class="section">
    <h2>Dance Transitions</h2>
    <table>
      <tr><th>Time</th><th>From</th><th>To</th></tr>
      ${transitionRows}
    </table>
  </div>
</body>
</html>`;
  }

  /**
   * Generate per-beat raw CSV for research export.
   * One row per detected beat with all available metrics.
   */
  static toRawCSV(session: Session): string {
    const lines: string[] = [];
    const header = 'timestamp_ms,ppi_ms,source,raw_ppg,spo2,device_bpm,kappa,gini,spread,dance,confidence,baseline_distance,trail_length';
    lines.push(header);

    const beats = session.rawBeats ?? [];
    for (const b of beats) {
      lines.push([
        b.timestamp_ms,
        b.ppi_ms,
        b.source,
        b.raw_ppg ?? '',
        b.spo2 ?? '',
        b.device_bpm ?? '',
        b.kappa.toFixed(2),
        b.gini.toFixed(4),
        b.spread.toFixed(3),
        b.dance,
        (b.confidence * 100).toFixed(1),
        b.baseline_distance ?? '',
        b.trail_length,
      ].join(','));
    }

    return lines.join('\n');
  }

  /**
   * Generate a safe filename for export.
   */
  static getFilename(session: Session, ext: 'csv' | 'pdf'): string {
    return `cardiac-dance-${session.id}.${ext}`;
  }

  /**
   * Generate a safe filename for raw data export.
   */
  static getRawFilename(session: Session): string {
    return `cardiac-dance-raw-${session.id}.csv`;
  }
}
