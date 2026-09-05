/**
 * Session recorder hook — auto-starts recording when first valid PPI arrives,
 * auto-ends when disconnected > 5 minutes.
 *
 * Per SPEC Section 7.1: No explicit start/stop required.
 *
 * snapshotSession() builds a Session from the recording in progress without
 * ending it, so the History tab can show (and export) the current session
 * while the Monitor keeps recording.
 */
import { useRef, useCallback, useState } from 'react';
import type { DanceMatch } from '../../shared/types';
import type { Session, RawBeat } from '../session/session-types';
import { RAW_BEAT_CAP } from '../session/session-types';

interface SessionRecorderState {
  isRecording: boolean;
  currentSessionId: string | null;
  beatCount: number;
  startTime: number | null;
  elapsedMs: number;
}

interface SessionData {
  id: string;
  startTime: number;
  beatCount: number;
  /** Beats seen per dance name — decides the dominant dance. */
  danceBeats: Record<string, number>;
  danceTransitions: { timestamp: number; from: string; to: string }[];
  changeEvents: Session['changeEvents'];
  lastDance: string | null;
  lastMatch: DanceMatch | null;
  // Running sums instead of per-beat arrays: an overnight recording pushed
  // four numbers per beat into uncapped arrays and sorted them at the end.
  bpmSum: number;
  bpmCount: number;
  giniSum: number;
  giniCount: number;
  /** One κ per feature window (changes every 10 beats), for the median. */
  kappaWindows: number[];
  /** Sum of raw PPIs, for a rate estimate before any dance window closes. */
  ppiSum: number;
  ppiCount: number;
  rawBeats: RawBeat[];
}

export function useSessionRecorder() {
  const [recState, setRecState] = useState<SessionRecorderState>({
    isRecording: false,
    currentSessionId: null,
    beatCount: 0,
    startTime: null,
    elapsedMs: 0,
  });

  const sessionData = useRef<SessionData | null>(null);

  const startSession = useCallback(() => {
    const now = Date.now();
    const id = `session-${now}`;
    sessionData.current = {
      id,
      startTime: now,
      beatCount: 0,
      danceBeats: {},
      danceTransitions: [],
      changeEvents: [],
      lastDance: null,
      lastMatch: null,
      bpmSum: 0,
      bpmCount: 0,
      giniSum: 0,
      giniCount: 0,
      kappaWindows: [],
      ppiSum: 0,
      ppiCount: 0,
      rawBeats: [],
    };
    setRecState({
      isRecording: true,
      currentSessionId: id,
      beatCount: 0,
      startTime: now,
      elapsedMs: 0,
    });
  }, []);

  /**
   * Record a change-detection transition for this session.
   *
   * Sessions previously always reported "changeEvents: []", so every export
   * and every Session Detail screen claimed "no sustained deviation from
   * baseline" regardless of what the detector observed — for an app whose
   * stated primary value is change detection.
   */
  const recordChangeEvent = useCallback((
    level: 'notice' | 'alert',
    distance: number,
    danceBefore: string,
    danceAfter: string,
  ) => {
    if (!sessionData.current) return;
    sessionData.current.changeEvents.push({
      timestamp: Date.now(),
      level,
      distance,
      danceBefore,
      danceAfter,
    });
  }, []);

  const recordBeat = useCallback((danceMatch: DanceMatch | null, rawBeat?: Omit<RawBeat, 'dance' | 'confidence' | 'kappa' | 'gini' | 'spread'>) => {
    const sd = sessionData.current;
    if (!sd) return;

    sd.beatCount++;

    if (rawBeat) {
      sd.ppiSum += rawBeat.ppi_ms;
      sd.ppiCount++;
    }

    // Store per-beat raw data (capped)
    if (rawBeat && sd.rawBeats.length < RAW_BEAT_CAP) {
      const lastMatch = danceMatch ?? sd.lastMatch;
      sd.rawBeats.push({
        ...rawBeat,
        kappa: lastMatch?.kappaMedian ?? 0,
        gini: lastMatch?.gini ?? 0,
        spread: lastMatch?.spread ?? 0,
        dance: lastMatch?.name ?? 'Unknown',
        confidence: lastMatch?.confidence ?? 0,
      });
    }

    if (danceMatch) {
      sd.bpmSum += danceMatch.bpm;
      sd.bpmCount++;
      sd.giniSum += danceMatch.gini;
      sd.giniCount++;
      // The pipeline carries the same match object for 10 beats; one κ per
      // window is what the median should be over.
      if (danceMatch !== sd.lastMatch) {
        sd.kappaWindows.push(danceMatch.kappaMedian);
        if (sd.kappaWindows.length > RAW_BEAT_CAP) sd.kappaWindows.shift();
      }
      sd.lastMatch = danceMatch;

      // Track dance transitions
      const currentDance = danceMatch.name;
      sd.danceBeats[currentDance] = (sd.danceBeats[currentDance] ?? 0) + 1;
      if (sd.lastDance && currentDance !== sd.lastDance) {
        sd.danceTransitions.push({
          timestamp: Date.now(),
          from: sd.lastDance,
          to: currentDance,
        });
      }
      sd.lastDance = currentDance;
    }

    const now = Date.now();
    setRecState(prev => ({
      ...prev,
      beatCount: sd.beatCount,
      elapsedMs: now - sd.startTime,
    }));
  }, []);

  /** Build a Session from the recording so far (does not end it). */
  const snapshotSession = useCallback((): Session | null => {
    const sd = sessionData.current;
    if (!sd) return null;
    const now = Date.now();

    // Dominant dance = the one seen on the most beats
    const dominantDance = Object.entries(sd.danceBeats)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

    const sortedKappas = [...sd.kappaWindows].sort((a, b) => a - b);
    const medianKappa = sortedKappas.length > 0
      ? sortedKappas[Math.floor(sortedKappas.length / 2)]
      : 0;

    // Before the first dance window closes there is no windowed BPM; fall
    // back to the raw intervals so a short session is not saved as "0 BPM".
    const bpmMean = sd.bpmCount > 0
      ? Math.round(sd.bpmSum / sd.bpmCount)
      : sd.ppiCount > 0 ? Math.round(60000 / (sd.ppiSum / sd.ppiCount)) : 0;

    return {
      id: sd.id,
      startTime: sd.startTime,
      endTime: now,
      dominantDance,
      beatCount: sd.beatCount,
      changeEvents: [...sd.changeEvents],
      danceTransitions: [...sd.danceTransitions],
      summaryStats: {
        bpmMean,
        kappaMedian: medianKappa,
        giniMean: sd.giniCount > 0 ? parseFloat((sd.giniSum / sd.giniCount).toFixed(3)) : 0,
      },
      rawBeats: sd.rawBeats,
    };
  }, []);

  const endSession = useCallback((): Session | null => {
    const session = snapshotSession();
    if (!session) return null;

    sessionData.current = null;
    setRecState({
      isRecording: false,
      currentSessionId: null,
      beatCount: 0,
      startTime: null,
      elapsedMs: 0,
    });

    return session;
  }, [snapshotSession]);

  return {
    recState,
    startSession,
    recordBeat,
    recordChangeEvent,
    snapshotSession,
    endSession,
  };
}
