/**
 * Data source context — manages whether the app uses simulated or BLE data.
 * Provides a dev toggle for settings screen.
 */
import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { RhythmScenario } from '../../shared/simulator';

type DataSourceType = 'simulated' | 'ble';

interface DataSourceContextValue {
  sourceType: DataSourceType;
  setSourceType: (t: DataSourceType) => void;
  simulatedScenario: RhythmScenario;
  setSimulatedScenario: (s: RhythmScenario) => void;
}

const DataSourceContext = createContext<DataSourceContextValue>({
  sourceType: 'simulated',
  setSourceType: () => {},
  simulatedScenario: 'nsr',
  setSimulatedScenario: () => {},
});

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [sourceType, setSourceType] = useState<DataSourceType>('simulated');
  const [simulatedScenario, setSimulatedScenario] = useState<RhythmScenario>('nsr');

  return (
    <DataSourceContext.Provider value={{
      sourceType,
      setSourceType,
      simulatedScenario,
      setSimulatedScenario,
    }}>
      {children}
    </DataSourceContext.Provider>
  );
}

export function useDataSource() {
  return useContext(DataSourceContext);
}
