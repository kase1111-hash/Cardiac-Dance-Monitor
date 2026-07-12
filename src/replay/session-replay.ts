/**
 * Session replay harness — runs a recorded beat sequence through the REAL
 * pipeline (QualityGate → PipelineCore: torus geometry → dance matching →
 * baseline learning → Mahalanobis change detection) and produces a
 * structured report.
 *
 * This is the validation path for "does the whole thing work on real
 * hearts": export a beat CSV from a live session (BLE or camera), replay
 * it here, and inspect what the pipeline would have shown — dance
 * timeline, change events, dropout gaps — deterministically and offline.
 *
 * Time is driven entirely by the recording's timestamps, so the 5-minute
 * baseline rule, the 60-second alert sustain rule, and dropout-gap
 * detection all behave exactly as they did (or would have) live,
 * regardless of how fast the replay itself executes.
 */
import { QualityGate } from '../../shared/quality-gate';
import type { PersonalBaseline } from '../../shared/types';
import { PipelineCore } from '../pipeline/pipeline-core';
import { BaselineService, BASELINE_KEY } from '../baseline/baseline-service';
import type { ChangeLevel } from '../baseline/change-detector';
import { MemoryStorage } from '../session/session-store';

/** One recorded beat: the pulse interval and when it arrived. */
export interface ReplayBeat {
  ppi: number;
  timestampMs: number;
}

/** Per-feature-window trace entry (every DANCE_UPDATE_INTERVAL beats). */
export interface ReplayWindow {
  beat: number;
  timestampMs: number;
  kappa: number;
  gini: number;
  spread: number;
  bpm: number;
  dance: string | null;
  confidence: number;
  mahalanobisDistance: number;
  changeLevel: ChangeLevel;
}

/** A run of consecutive feature windows that matched the same dance. */
export interface DanceSegment {
  name: string;
  startBeat: number;
  endBeat: number;
  windows: number;
}

/** A change-level transition (e.g. normal → notice, notice → alert). */
export interface ChangeEvent {
  beat: number;
  timestampMs: number;
  from: ChangeLevel;
  to: ChangeLevel;
  mahalanobisDistance: number;
}

export interface ReplayResult {
  totalBeats: number;
  acceptedBeats: number;
  rejectedBeats: number;
  /** Dropout gaps detected (torus geometry restarted after each) */
  gapCount: number;
  /** Recording span, first beat to last beat */
  durationMs: number;
  windows: ReplayWindow[];
  danceTimeline: DanceSegment[];
  /** Feature windows per dance name */
  danceDistribution: Record<string, number>;
  finalDance: string | null;
  changeEvents: ChangeEvent[];
  maxMahalanobisDistance: number;
  baselineEstablished: boolean;
  baseline: PersonalBaseline | null;
}

export interface ReplayOptions {
  /**
   * Replay against a previously established baseline (e.g. from an earlier
   * session) instead of learning one from this recording.
   */
  baseline?: PersonalBaseline;
  /** Run beats through the QualityGate first, as live sources do. Default true. */
  applyQualityGate?: boolean;
}

/**
 * Parse a beat CSV exported by the app (beat-logger format) into replay
 * beats. Only `timestamp` and `ppi_ms` columns are required; malformed
 * rows are skipped.
 */
export function parseBeatCSV(csv: string): ReplayBeat[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim());
  const tsIdx = header.indexOf('timestamp');
  const ppiIdx = header.indexOf('ppi_ms');
  if (tsIdx === -1 || ppiIdx === -1) {
    throw new Error('Not a beat CSV: missing "timestamp" or "ppi_ms" column');
  }

  const beats: ReplayBeat[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const timestampMs = Date.parse(cols[tsIdx]);
    const ppi = Number(cols[ppiIdx]);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(ppi) || ppi <= 0) continue;
    beats.push({ ppi, timestampMs });
  }
  return beats;
}

/**
 * Replay a recorded session through the real pipeline.
 * Async only because seeding a pre-established baseline goes through the
 * (async) storage adapter interface.
 */
export async function replaySession(
  beats: ReplayBeat[],
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const storage = new MemoryStorage();
  const baselineService = new BaselineService(storage);
  if (options.baseline) {
    await storage.setItem(BASELINE_KEY, JSON.stringify(options.baseline));
    await baselineService.load();
  }

  const gate = new QualityGate();
  const applyGate = options.applyQualityGate ?? true;
  const core = new PipelineCore(baselineService);

  const windows: ReplayWindow[] = [];
  const changeEvents: ChangeEvent[] = [];
  let accepted = 0;
  let rejected = 0;
  let maxDistance = 0;
  let prevLevel: ChangeLevel = core.getState().changeLevel;
  let lastWindowBeat = 0;

  for (const beat of beats) {
    if (applyGate && !gate.check(beat.ppi)) {
      rejected++;
      continue;
    }
    accepted++;

    const state = core.processBeat(beat.ppi, beat.timestampMs);

    // A new feature window closed iff featureHistory gained an entry
    const lastFeature = state.featureHistory[state.featureHistory.length - 1];
    if (lastFeature && lastFeature.beat !== lastWindowBeat) {
      lastWindowBeat = lastFeature.beat;
      windows.push({
        beat: lastFeature.beat,
        timestampMs: beat.timestampMs,
        kappa: state.kappaMedian,
        gini: state.gini,
        spread: state.spread,
        bpm: state.bpm ?? 0,
        dance: state.danceMatch?.name ?? null,
        confidence: state.danceMatch?.confidence ?? 0,
        mahalanobisDistance: state.changeStatus.mahalanobisDistance,
        changeLevel: state.changeLevel,
      });

      if (state.changeLevel !== 'learning') {
        maxDistance = Math.max(maxDistance, state.changeStatus.mahalanobisDistance);
      }
      if (state.changeLevel !== prevLevel) {
        changeEvents.push({
          beat: lastFeature.beat,
          timestampMs: beat.timestampMs,
          from: prevLevel,
          to: state.changeLevel,
          mahalanobisDistance: state.changeStatus.mahalanobisDistance,
        });
        prevLevel = state.changeLevel;
      }
    }
  }

  // Collapse consecutive same-dance windows into timeline segments
  const danceTimeline: DanceSegment[] = [];
  const danceDistribution: Record<string, number> = {};
  for (const w of windows) {
    if (w.dance === null) continue;
    danceDistribution[w.dance] = (danceDistribution[w.dance] ?? 0) + 1;
    const last = danceTimeline[danceTimeline.length - 1];
    if (last && last.name === w.dance) {
      last.endBeat = w.beat;
      last.windows++;
    } else {
      danceTimeline.push({ name: w.dance, startBeat: w.beat, endBeat: w.beat, windows: 1 });
    }
  }

  const finalState = core.getState();
  return {
    totalBeats: beats.length,
    acceptedBeats: accepted,
    rejectedBeats: rejected,
    gapCount: finalState.gapCount,
    durationMs: beats.length >= 2
      ? beats[beats.length - 1].timestampMs - beats[0].timestampMs
      : 0,
    windows,
    danceTimeline,
    danceDistribution,
    finalDance: finalState.danceMatch?.name ?? null,
    changeEvents,
    maxMahalanobisDistance: maxDistance,
    baselineEstablished: !baselineService.isLearning(),
    baseline: baselineService.getBaseline(),
  };
}

/** Human-readable one-page summary of a replay, for logs or research notes. */
export function formatReplayReport(result: ReplayResult): string {
  const lines: string[] = [];
  const min = Math.floor(result.durationMs / 60000);
  const sec = Math.round((result.durationMs % 60000) / 1000);
  lines.push('=== Session Replay Report ===');
  lines.push(`Beats: ${result.totalBeats} total, ${result.acceptedBeats} accepted, ${result.rejectedBeats} rejected by quality gate`);
  lines.push(`Duration: ${min}m ${sec}s • Dropout gaps: ${result.gapCount}`);
  lines.push(`Baseline: ${result.baselineEstablished ? 'established' : 'not established'}`);
  lines.push('');
  lines.push('Dance timeline:');
  if (result.danceTimeline.length === 0) {
    lines.push('  (no dance identified — not enough clean data)');
  }
  for (const seg of result.danceTimeline) {
    lines.push(`  beats ${seg.startBeat}-${seg.endBeat}: ${seg.name} (${seg.windows} windows)`);
  }
  lines.push('');
  lines.push(`Max Mahalanobis distance: ${result.maxMahalanobisDistance.toFixed(2)}σ`);
  if (result.changeEvents.length === 0) {
    lines.push('Change events: none');
  } else {
    lines.push('Change events:');
    for (const ev of result.changeEvents) {
      lines.push(`  beat ${ev.beat}: ${ev.from} → ${ev.to} (d=${ev.mahalanobisDistance.toFixed(2)}σ)`);
    }
  }
  return lines.join('\n');
}
