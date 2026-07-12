/**
 * Monitor pipeline hook — thin React wrapper around PipelineCore, which owns
 * ring buffers, torus computation, dance matching, baseline learning, and
 * change detection. The core is React-free so session replay
 * (src/replay/session-replay.ts) runs the identical code path.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { BaselineService } from '../baseline/baseline-service';
import { PipelineCore, type PipelineState } from '../pipeline/pipeline-core';
import { MemoryStorage, type StorageAdapter } from '../session/session-store';

export type { PipelineState, FeatureSample } from '../pipeline/pipeline-core';

export function useMonitorPipeline(storage?: StorageAdapter) {
  const baselineService = useRef<BaselineService | null>(null);
  if (!baselineService.current) {
    baselineService.current = new BaselineService(storage ?? new MemoryStorage());
  }
  const core = useRef<PipelineCore | null>(null);
  if (!core.current) {
    core.current = new PipelineCore(baselineService.current, { verbose: true });
  }

  const [state, setState] = useState<PipelineState>(core.current.getState());

  // Restore a previously established baseline so it survives app restarts.
  useEffect(() => {
    let cancelled = false;
    baselineService.current!.load().then(loaded => {
      if (loaded && !cancelled) {
        console.log('BASELINE_LOADED: established', new Date(loaded.recordedAt).toISOString(), 'beats=', loaded.beatCount);
        setState(prev => ({
          ...prev,
          isLearningBaseline: false,
          baselineLearningProgress: 1,
          baselineBeatCount: loaded.beatCount,
        }));
      }
    });
    return () => { cancelled = true; };
  }, []);

  const processPPI = useCallback((ppi: number, timestampMs: number = Date.now()) => {
    const snapshot = core.current!.processBeat(ppi, timestampMs);
    if (snapshot.baselineJustEstablished) {
      void baselineService.current!.save();
    }
    console.log('SET_STATE beat=', snapshot.totalBeats, 'pts=', snapshot.displayPoints.length);
    setState(snapshot);
  }, []);

  const reset = useCallback(() => {
    core.current!.reset();
    setState(core.current!.getState());
  }, []);

  const resetBaseline = useCallback(async () => {
    await baselineService.current!.reset();
    setState(core.current!.onBaselineReset());
  }, []);

  /** Force-establish baseline (demo/testing — skips duration check). */
  const forceEstablishBaseline = useCallback(() => {
    const established = baselineService.current!.forceEstablish();
    if (established) {
      void baselineService.current!.save();
      setState(prev => ({
        ...prev,
        isLearningBaseline: false,
        baselineLearningProgress: 1,
        baselineBeatCount: baselineService.current!.getSampleCount(),
      }));
    }
    return established;
  }, []);

  const getBaselineService = useCallback(() => baselineService.current!, []);

  return { state, processPPI, reset, resetBaseline, forceEstablishBaseline, getBaselineService };
}
