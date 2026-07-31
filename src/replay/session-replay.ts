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

/** One session's result plus how the shared baseline stood when it ended. */
export interface MultiSessionResult {
  /** Per-recording results, in order. */
  sessions: ReplayResult[];
  /**
   * Index of the recording during which the baseline was established,
   * or -1 if no recording ever established one.
   */
  baselineEstablishedInSession: number;
  /** The baseline as persisted after the last recording. */
  finalBaseline: PersonalBaseline | null;
  /**
   * Distinct values the persisted baseline took across the whole run. A
   * frozen baseline must produce exactly one — anything more means a later
   * session rewrote the reference every subsequent distance is measured
   * against.
   */
  baselineRevisions: number;
}

export interface MultiSessionOptions extends ReplayOptions {
  /**
   * Carry one PipelineCore across recordings, resetting it between them (a
   * source switch inside one app run). Default false: each recording gets a
   * cold core, as a fresh app launch does. Either way the baseline persists
   * through storage, because that is what BaselineService.save()/load() do.
   */
  reusePipeline?: boolean;
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

  const core = new PipelineCore(baselineService);
  return runRecording(beats, core, baselineService, options.applyQualityGate ?? true);
}

/**
 * Run one recording through an existing core and baseline service.
 *
 * Split out of replaySession so a multi-session run can hand the SAME
 * baseline service to every recording — the one piece of state the app
 * deliberately carries across sessions.
 */
async function runRecording(
  beats: ReplayBeat[],
  core: PipelineCore,
  baselineService: BaselineService,
  applyGate: boolean,
): Promise<ReplayResult> {
  const gate = new QualityGate();

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

    // Persist exactly where the live hook does, so a later session in a
    // multi-session run loads the same baseline the app would have.
    if (state.baselineJustEstablished) await baselineService.save();

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

  // Mirror what the app does when a session ends: flush partial baseline
  // progress so the next session resumes from it.
  if (baselineService.isLearning()) await baselineService.saveProgress();

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

/**
 * Replay several recordings as CONSECUTIVE SESSIONS of one user.
 *
 * A single replaySession() call only ever proves the pipeline works from a
 * cold start with a baseline it learned itself. Real use is a sequence:
 * session 1 learns the baseline, it is written to storage, and every later
 * session loads it and is judged against it. Each recording here therefore
 * gets a fresh BaselineService loaded from shared storage — exactly what a
 * cold app launch does — while the baseline itself carries across.
 *
 * `options.baseline` seeds storage before the first recording, i.e. a user
 * who already had a baseline before any of these sessions.
 */
export async function replaySessions(
  recordings: ReplayBeat[][],
  options: MultiSessionOptions = {},
): Promise<MultiSessionResult> {
  const storage = new MemoryStorage();
  if (options.baseline) {
    await storage.setItem(BASELINE_KEY, JSON.stringify(options.baseline));
  }

  const applyGate = options.applyQualityGate ?? true;
  const sessions: ReplayResult[] = [];
  const revisions: string[] = [];
  let baselineEstablishedInSession = -1;
  let sharedCore: PipelineCore | null = null;
  let sharedService: BaselineService | null = null;

  const seeded = await storage.getItem(BASELINE_KEY);
  if (seeded) revisions.push(seeded);

  for (let i = 0; i < recordings.length; i++) {
    // Fresh service per session, loaded from storage: the baseline survives
    // only because it was persisted, never because an object stayed alive.
    // Reused pipelines keep their service, as the live hook's refs do.
    let baselineService: BaselineService;
    if (options.reusePipeline && sharedService) {
      baselineService = sharedService;
    } else {
      baselineService = new BaselineService(storage);
      await baselineService.load();
      sharedService = baselineService;
    }
    const hadBaseline = !baselineService.isLearning();

    let core: PipelineCore;
    if (options.reusePipeline && sharedCore) {
      sharedCore.reset();
      core = sharedCore;
    } else {
      core = new PipelineCore(baselineService);
      sharedCore = core;
    }

    const result = await runRecording(recordings[i], core, baselineService, applyGate);
    sessions.push(result);

    if (!hadBaseline && result.baselineEstablished && baselineEstablishedInSession === -1) {
      baselineEstablishedInSession = i;
    }

    const stored = await storage.getItem(BASELINE_KEY);
    if (stored && stored !== revisions[revisions.length - 1]) revisions.push(stored);
  }

  const finalRaw = await storage.getItem(BASELINE_KEY);
  return {
    sessions,
    baselineEstablishedInSession,
    finalBaseline: finalRaw ? (JSON.parse(finalRaw) as PersonalBaseline) : null,
    baselineRevisions: revisions.length,
  };
}

/**
 * Human-readable summary of a multi-session run: one block per session plus
 * how the shared baseline behaved across all of them.
 */
export function formatMultiSessionReport(
  result: MultiSessionResult,
  labels: string[] = [],
): string {
  const lines: string[] = [];
  lines.push('=== Multi-Session Replay Report ===');
  lines.push(`Sessions: ${result.sessions.length}`);
  if (result.baselineEstablishedInSession === -1) {
    lines.push('Baseline: never established across these sessions');
  } else {
    lines.push(`Baseline: established in session ${result.baselineEstablishedInSession + 1}, then reused`);
  }
  lines.push(`Baseline revisions: ${result.baselineRevisions} (a frozen baseline gives 1)`);
  lines.push('');

  result.sessions.forEach((s, i) => {
    const min = Math.round(s.durationMs / 60000);
    const label = labels[i] ?? `Session ${i + 1}`;
    const graded = s.windows.filter(w => w.changeLevel !== 'learning');
    const alerts = graded.filter(w => w.changeLevel === 'alert').length;
    const notices = graded.filter(w => w.changeLevel === 'notice').length;
    lines.push(`${label}: ${s.acceptedBeats} beats, ${min}m, ${s.gapCount} gap(s)`);
    lines.push(`  dance: ${s.finalDance ?? 'unknown'} • ${s.danceTimeline.length} segment(s)`);
    lines.push(`  change: ${notices} notice / ${alerts} alert of ${graded.length} graded windows • max ${s.maxMahalanobisDistance.toFixed(2)}σ`);
  });

  return lines.join('\n');
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
