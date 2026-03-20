/**
 * Data source context — manages whether the app uses simulated or BLE data.
 * Provides a dev toggle for settings screen.
 */
import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { RhythmScenario } from '../../shared/simulator';

type DataSourceType = 'simulated' | 'ble' | 'ble_innovo' | 'camera';

interface DataSourceContextValue {
  sourceType: DataSourceType;
  setSourceType: (t: DataSourceType) => void;
  simulatedScenario: RhythmScenario;
  setSimulatedScenario: (s: RhythmScenario) => void;
  /** Signal filter sensitivity: 0 = accept all, 1.0 = strict (40% deviation rejection) */
  filterSensitivity: number;
  setFilterSensitivity: (v: number) => void;
  /** Incremented when user requests baseline reset from Settings */
  baselineResetCounter: number;
  requestBaselineReset: () => void;
}

const DataSourceContext = createContext<DataSourceContextValue>({
  sourceType: 'simulated',
  setSourceType: () => {},
  simulatedScenario: 'nsr',
  setSimulatedScenario: () => {},
  filterSensitivity: 0,
  setFilterSensitivity: () => {},
  baselineResetCounter: 0,
  requestBaselineReset: () => {},
});

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [sourceType, setSourceType] = useState<DataSourceType>('simulated');
  const [simulatedScenario, setSimulatedScenario] = useState<RhythmScenario>('nsr');
  const [filterSensitivity, setFilterSensitivity] = useState(0);
  const [baselineResetCounter, setBaselineResetCounter] = useState(0);

  // Auto-set default sensitivity when source changes
  const handleSetSourceType = (t: DataSourceType) => {
    setSourceType(t);
    // Default: 0% for simulated, 40% for BLE/camera
    setFilterSensitivity(t === 'simulated' ? 0 : 0.4);
  };

  const requestBaselineReset = () => {
    setBaselineResetCounter(c => c + 1);
  };

  return (
    <DataSourceContext.Provider value={{
      sourceType,
      setSourceType: handleSetSourceType,
      simulatedScenario,
      setSimulatedScenario,
      filterSensitivity,
      setFilterSensitivity,
      baselineResetCounter,
      requestBaselineReset,
    }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  return useContext(DataSourceContext);
}
