/**
 * Session recorder hook — auto-starts recording when first valid PPI arrives,
 * auto-ends when disconnected > 5 minutes.
 *
 * Per SPEC Section 7.1: No explicit start/stop required.
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

export function useSessionRecorder() {
  const [recState, setRecState] = useState<SessionRecorderState>({
    isRecording: false,
    currentSessionId: null,
    beatCount: 0,
    startTime: null,
    elapsedMs: 0,
  });

  const sessionData = useRef<{
    id: string;
    startTime: number;
    beatCount: number;
    danceMatches: DanceMatch[];
    danceTransitions: Array<{ timestamp: number; from: string; to: string }>;
    lastDance: string | null;
    bpmAccum: number[];
    kappaAccum: number[];
    giniAccum: number[];
    rawBeats: RawBeat[];
  } | null>(null);

  const startSession = useCallback(() => {
    const now = Date.now();
    const id = `session-${now}`;
    sessionData.current = {
      id,
      startTime: now,
      beatCount: 0,
      danceMatches: [],
      danceTransitions: [],
      lastDance: null,
      bpmAccum: [],
      kappaAccum: [],
      giniAccum: [],
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

  const recordBeat = useCallback((danceMatch: DanceMatch | null, rawBeat?: Omit<RawBeat, 'dance' | 'confidence' | 'kappa' | 'gini' | 'spread'>) => {
    if (!sessionData.current) return;

    sessionData.current.beatCount++;

    // Store per-beat raw data (capped)
    if (rawBeat && sessionData.current.rawBeats.length < RAW_BEAT_CAP) {
      const lastMatch = danceMatch ?? sessionData.current.danceMatches[sessionData.current.danceMatches.length - 1];
      sessionData.current.rawBeats.push({
        ...rawBeat,
        kappa: lastMatch?.kappaMedian ?? 0,
        gini: lastMatch?.gini ?? 0,
        spread: lastMatch?.spread ?? 0,
        dance: lastMatch?.name ?? 'Unknown',
        confidence: lastMatch?.confidence ?? 0,
      });
    }

    if (danceMatch) {
      sessionData.current.danceMatches.push(danceMatch);
      sessionData.current.bpmAccum.push(danceMatch.bpm);
      sessionData.current.kappaAccum.push(danceMatch.kappaMedian);
      sessionData.current.giniAccum.push(danceMatch.gini);

      // Track dance transitions
      const currentDance = danceMatch.name;
      if (sessionData.current.lastDance && currentDance !== sessionData.current.lastDance) {
        sessionData.current.danceTransitions.push({
          timestamp: Date.now(),
          from: sessionData.current.lastDance,
          to: currentDance,
        });
      }
      sessionData.current.lastDance = currentDance;
    }

    const now = Date.now();
    setRecState(prev => ({
      ...prev,
      beatCount: sessionData.current!.beatCount,
      elapsedMs: now - sessionData.current!.startTime,
    }));
  }, []);

  const endSession = useCallback((): Session | null => {
    if (!sessionData.current) return null;

    const sd = sessionData.current;
    const now = Date.now();

    // Find dominant dance (most frequent)
    const danceCounts: Record<string, number> = {};
    for (const m of sd.danceMatches) {
      danceCounts[m.name] = (danceCounts[m.name] ?? 0) + 1;
    }
    const dominantDance = Object.entries(danceCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

    const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const sortedKappas = [...sd.kappaAccum].sort((a, b) => a - b);
    const medianKappa = sortedKappas.length > 0
      ? sortedKappas[Math.floor(sortedKappas.length / 2)]
      : 0;

    const session: Session = {
      id: sd.id,
      startTime: sd.startTime,
      endTime: now,
      dominantDance,
      beatCount: sd.beatCount,
      changeEvents: [], // Phase 2
      danceTransitions: sd.danceTransitions,
      summaryStats: {
        bpmMean: Math.round(mean(sd.bpmAccum)),
        kappaMedian: medianKappa,
        giniMean: parseFloat(mean(sd.giniAccum).toFixed(3)),
      },
      rawBeats: sd.rawBeats,
    };

    sessionData.current = null;
    setRecState({
      isRecording: false,
      currentSessionId: null,
      beatCount: 0,
      startTime: null,
      elapsedMs: 0,
    });

    return session;
  }, []);

  return {
    recState,
    startSession,
    recordBeat,
    endSession,
  };
}
