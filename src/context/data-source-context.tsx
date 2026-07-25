/**
 * Data source context — manages whether the app uses simulated or BLE data.
 * Provides a dev toggle for settings screen.
 */
import React, { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { RhythmScenario } from '../../shared/simulator';
import { PPI_DEVIATION_MAX } from '../../shared/constants';

type DataSourceType = 'simulated' | 'ble' | 'ble_innovo' | 'camera';

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

  // The old auto-set forced 0 for the simulated source, which meant "accept
  // all" under the previous semantics but now means a 0% deviation tolerance —
  // i.e. every beat flagged unclean. The simulated source applies no quality
  // gate at all, so there is nothing to configure for it; leave the user's
  // chosen tolerance alone.
  const handleSetSourceType = (t: DataSourceType) => {
    setSourceType(t);
  };

  const requestBaselineReset = () => {
    setBaselineResetCounter(c => c + 1);
  };

  const requestForceBaseline = () => {
    setForceBaselineCounter(c => c + 1);
  };

  const requestReplayOnboarding = () => {
    setReplayOnboardingCounter(c => c + 1);
  };

  // Memoize: a fresh object literal here re-rendered every consumer on any
  // state change, including the monitor screen (which already re-renders per
  // beat) on unrelated settings edits.
  const value = useMemo(() => ({
    sourceType,
    setSourceType: handleSetSourceType,
    simulatedScenario,
    setSimulatedScenario,
    filterSensitivity,
    setFilterSensitivity,
    baselineResetCounter,
    requestBaselineReset,
    forceBaselineCounter,
    requestForceBaseline,
    ppgValidationMode,
    setPPGValidationMode,
    replayOnboardingCounter,
    requestReplayOnboarding,
  }), [
    sourceType, simulatedScenario, filterSensitivity, baselineResetCounter,
    forceBaselineCounter, ppgValidationMode, replayOnboardingCounter,
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
