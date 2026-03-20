/**
 * Session data types — per SPEC Section 7.
 */

/** One row per detected beat for research-grade raw export. */
export interface RawBeat {
  timestamp_ms: number;
  ppi_ms: number;
  source: 'simulated' | 'ble_ppg' | 'camera' | 'ble_hr';
  raw_ppg: number | null;
  spo2: number | null;
  device_bpm: number | null;
  kappa: number;
  gini: number;
  spread: number;
  dance: string;
  confidence: number;
  baseline_distance: number | null;
  trail_length: number;
}

/** Max raw beats per session (~2.5 hours at 70 BPM). */
export const RAW_BEAT_CAP = 10_000;

export interface Session {
  id: string;
  startTime: number;
  endTime: number;
  dominantDance: string;
  beatCount: number;
  changeEvents: Array<{
    timestamp: number;
    level: 'notice' | 'alert';
    distance: number;
    danceBefore: string;
    danceAfter: string;
  }>;
  danceTransitions: Array<{
    timestamp: number;
    from: string;
    to: string;
  }>;
  summaryStats: {
    bpmMean: number;
    kappaMedian: number;
    giniMean: number;
  };
  /** Per-beat raw data for research export. Optional for backward compat. */
  rawBeats?: RawBeat[];
}
