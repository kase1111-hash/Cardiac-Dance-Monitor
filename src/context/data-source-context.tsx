/**
 * Data source context — which source feeds the monitor (simulated, Innovo
 * BLE oximeter, or camera PPG), the simulated scenario, and the handful of
 * cross-tab requests Settings sends to the Monitor screen.
 */
import React, { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { RhythmScenario } from '../../shared/simulator';
import { PPI_DEVIATION_MAX } from '../../shared/constants';

/**
 * 'ble' (a generic Heart Rate Service strap) was offered in Settings but
 * routed to the Innovo-only hook, so it scanned for 30 s and silently gave
 * up. Only sources that actually work are listed.
 */
export type DataSourceType = 'simulated' | 'ble_innovo' | 'camera';

/** Baseline namespace for a source: simulated rhythms vs. a real person. */
export function baselineNamespaceFor(source: DataSourceType): 'simulated' | 'sensor' {
  return source === 'simulated' ? 'simulated' : 'sensor';
}

interface DataSourceContextValue {
  sourceType: DataSourceType;
  setSourceType: (t: DataSourceType) => void;
  simulatedScenario: RhythmScenario;
  setSimulatedScenario: (s: RhythmScenario) => void;
  /**
   * Deviation tolerance for the signal-quality badge: the fraction a beat may
   * differ from the running median before counting as unclean. Higher = more
   * permissive. Never affects which beats are analysed.
   */
  filterSensitivity: number;
  setFilterSensitivity: (v: number) => void;
  /** Incremented when user requests baseline reset from Settings */
  baselineResetCounter: number;
  requestBaselineReset: () => void;
  /** Incremented when user requests force-establish baseline (dev/demo) */
  forceBaselineCounter: number;
  requestForceBaseline: () => void;
  /** Dev: run BLE + camera simultaneously to compare PPG accuracy */
  ppgValidationMode: boolean;
  setPPGValidationMode: (on: boolean) => void;
  /** Incremented when user asks to replay the intro from Settings */
  replayOnboardingCounter: number;
  requestReplayOnboarding: () => void;
  /** Developer section revealed (long-press About); gates research controls. */
  devMode: boolean;
  setDevMode: (on: boolean) => void;
}

const DataSourceContext = createContext<DataSourceContextValue>({
  sourceType: 'simulated',
  setSourceType: () => {},
  simulatedScenario: 'nsr',
  setSimulatedScenario: () => {},
  filterSensitivity: PPI_DEVIATION_MAX,
  setFilterSensitivity: () => {},
  baselineResetCounter: 0,
  requestBaselineReset: () => {},
  forceBaselineCounter: 0,
  requestForceBaseline: () => {},
  ppgValidationMode: false,
  setPPGValidationMode: () => {},
  replayOnboardingCounter: 0,
  requestReplayOnboarding: () => {},
  devMode: false,
  setDevMode: () => {},
});

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [sourceType, setSourceType] = useState<DataSourceType>('simulated');
  const [simulatedScenario, setSimulatedScenario] = useState<RhythmScenario>('nsr');
  // Deviation tolerance for the signal-quality badge (see QualityGate).
  // Defaults to the calibrated PPI_DEVIATION_MAX rather than 0, which would
  // have flagged every beat as unclean the moment the control was wired up.
  const [filterSensitivity, setFilterSensitivity] = useState(PPI_DEVIATION_MAX);
  const [baselineResetCounter, setBaselineResetCounter] = useState(0);
  const [forceBaselineCounter, setForceBaselineCounter] = useState(0);
  const [ppgValidationMode, setPPGValidationMode] = useState(false);
  const [replayOnboardingCounter, setReplayOnboardingCounter] = useState(0);
  const [devMode, setDevMode] = useState(false);

  // Memoize: a fresh object literal here re-rendered every consumer on any
  // state change, including the monitor screen (which already re-renders per
  // beat) on unrelated settings edits.
  const value = useMemo(() => ({
    sourceType,
    setSourceType,
    simulatedScenario,
    setSimulatedScenario,
    filterSensitivity,
    setFilterSensitivity,
    baselineResetCounter,
    requestBaselineReset: () => setBaselineResetCounter(c => c + 1),
    forceBaselineCounter,
    requestForceBaseline: () => setForceBaselineCounter(c => c + 1),
    ppgValidationMode,
    setPPGValidationMode,
    replayOnboardingCounter,
    requestReplayOnboarding: () => setReplayOnboardingCounter(c => c + 1),
    devMode,
    setDevMode,
  }), [
    sourceType, simulatedScenario, filterSensitivity, baselineResetCounter,
    forceBaselineCounter, ppgValidationMode, replayOnboardingCounter, devMode,
  ]);

  return (
    <DataSourceContext.Provider value={value}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  return useContext(DataSourceContext);
}
