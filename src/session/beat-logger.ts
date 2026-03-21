/**
 * Beat logger — accumulates per-beat CSV data in memory for research export.
 *
 * Usage:
 *   beatLogger.append(row)   — add a beat after PIPELINE_BEAT
 *   beatLogger.toCSV()       — generate CSV string with header
 *   beatLogger.count         — number of rows
 *   beatLogger.clear()       — reset (call on source change)
 */

export interface BeatLogRow {
  timestamp: string;       // ISO 8601, ms precision
  beat_number: number;
  ppi_ms: number;
  source: string;
  spo2: number | null;
  bpm: number | null;
  pi_percent: number | null;
  dance_name: string | null;
  dance_confidence: number | null;
  kappa: number;
  gini: number;
  sigma: number;
  theta1: number;
  theta2: number;
  trail_length: number;
}

const CSV_HEADER = 'timestamp,beat_number,ppi_ms,source,spo2,bpm,pi_percent,dance_name,dance_confidence,kappa,gini,sigma,theta1,theta2,trail_length';

class BeatLogger {
  private rows: BeatLogRow[] = [];

  get count(): number {
    return this.rows.length;
  }

  append(row: BeatLogRow): void {
    this.rows.push(row);
  }

  clear(): void {
    this.rows = [];
  }

  toCSV(): string {
    const lines = [CSV_HEADER];
    for (const r of this.rows) {
      lines.push([
        r.timestamp,
        r.beat_number,
        r.ppi_ms,
        r.source,
        r.spo2 ?? '',
        r.bpm ?? '',
        r.pi_percent ?? '',
        r.dance_name ?? '',
        r.dance_confidence != null ? Math.round(r.dance_confidence) : '',
        r.kappa.toFixed(3),
        r.gini.toFixed(4),
        r.sigma.toFixed(3),
        r.theta1.toFixed(4),
        r.theta2.toFixed(4),
        r.trail_length,
      ].join(','));
    }
    return lines.join('\n') + '\n';
  }
}

/** Singleton beat logger instance */
export const beatLogger = new BeatLogger();
