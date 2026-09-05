/**
 * Monitor pipeline hook — thin React wrapper around PipelineCore, which owns
 * ring buffers, torus computation, dance matching, baseline learning, and
 * change detection. The core is React-free so session replay
 * (src/replay/session-replay.ts) runs the identical code path.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  BaselineService, BASELINE_KEY, FORCE_ESTABLISH_MIN_SAMPLES,
} from '../baseline/baseline-service';
import { PipelineCore, type PipelineState } from '../pipeline/pipeline-core';
import { MemoryStorage, type StorageAdapter } from '../session/session-store';
import { BASELINE_MIN_BEATS } from '../../shared/constants';
import { IS_DEV } from '../../shared/debug';

export type { PipelineState, FeatureSample } from '../pipeline/pipeline-core';

/**
 * Baseline namespaces. A simulated rhythm and a real person are different
 * subjects; keeping their baselines apart means switching source no longer
 * destroys either. All real sensors share one — they measure the same heart.
 */
export type BaselineNamespace = 'simulated' | 'sensor';

export interface ForceBaselineResult {
  established: boolean;
  rawBeats: number;
  featureSamples: number;
  requiredBeats: number;
  requiredSamples: number;
}

export function useMonitorPipeline(
  storage?: StorageAdapter,
  namespace: BaselineNamespace = 'simulated',
) {
  const baselineService = useRef<BaselineService | null>(null);
  if (!baselineService.current) {
    baselineService.current = new BaselineService(storage ?? new MemoryStorage(), { namespace });
  }
  const core = useRef<PipelineCore | null>(null);
  if (!core.current) {
    // Per-beat diagnostics are for development builds only; in release they
    // cost a native log write per beat for nobody.
    core.current = new PipelineCore(baselineService.current, { verbose: IS_DEV });
  }

  const [state, setState] = useState<PipelineState>(core.current.getState());

  // Load the baseline for the active namespace (on mount and whenever the
  // source kind changes) so an established baseline survives app restarts
  // and source switches.
  useEffect(() => {
    let cancelled = false;
    const bs = baselineService.current!;
    bs.activateNamespace(namespace).then(loaded => {
      if (cancelled) return;
      if (loaded && IS_DEV) {
        console.log(
          'BASELINE_LOADED:', namespace, 'beats=', loaded.beatCount,
          Number.isFinite(loaded.recordedAt) ? new Date(loaded.recordedAt).toISOString() : '',
        );
      }
      setState(core.current!.syncBaselineState());
    }).catch(e => console.warn('BASELINE_LOAD_FAILED:', e?.message ?? e));
    return () => { cancelled = true; };
  }, [namespace]);

  /**
   * Feed one beat through the pipeline.
   *
   * Returns the NEW state snapshot. Callers that log or record must use the
   * returned value, not the `state` from their render closure — that closure
   * still holds the pre-beat snapshot, which silently paired beat n's PPI
   * with beat n-1's metrics in every exported row.
   */
  const processPPI = useCallback((
    ppi: number,
    timestampMs: number = Date.now(),
  ): PipelineState => {
    const snapshot = core.current!.processBeat(ppi, timestampMs);
    if (snapshot.baselineJustEstablished) {
      void baselineService.current!.save();
    }
    setState(snapshot);
    return snapshot;
  }, []);

  /**
   * Reset the geometry. `keepHistory` preserves the rate-vs-geometry trend so
   * a simulated scenario switch shows before and after in one strip.
   */
  const reset = useCallback((options: { keepHistory?: boolean } = {}) => {
    core.current!.reset(options);
    setState(core.current!.getState());
  }, []);

  const resetBaseline = useCallback(async () => {
    await baselineService.current!.reset();
    setState(core.current!.onBaselineReset());
  }, []);

  /** Force-establish baseline (demo/testing — skips the 5-minute rule). */
  const forceEstablishBaseline = useCallback((): ForceBaselineResult => {
    const bs = baselineService.current!;
    const established = bs.forceEstablish();
    if (established) {
      void bs.save();
      setState(core.current!.syncBaselineState());
    }
    return {
      established,
      rawBeats: bs.getSampleCount(),
      featureSamples: bs.getFeatureSampleCount(),
      requiredBeats: BASELINE_MIN_BEATS,
      requiredSamples: FORCE_ESTABLISH_MIN_SAMPLES,
    };
  }, []);

  const getBaselineService = useCallback(() => baselineService.current!, []);

  /**
   * Flush partial baseline-learning progress. The service checkpoints itself
   * every few feature windows; call this when the app is about to lose the
   * foreground so the last partial window is not the one that gets dropped.
   */
  const flushBaselineProgress = useCallback(
    () => baselineService.current!.saveProgress(),
    [],
  );

  return {
    state, processPPI, reset, resetBaseline, forceEstablishBaseline,
    getBaselineService, flushBaselineProgress,
  };
}

export { BASELINE_KEY };
