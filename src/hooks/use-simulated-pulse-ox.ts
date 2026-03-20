/**
 * Simulated pulse oximeter hook — provides the same interface as the real BLE
 * pulse ox but generates PPIs from the rhythm simulator.
 *
 * Uses recursive setTimeout so each beat fires at the natural PPI interval
 * (e.g. 800ms for 75 BPM). All mutable state lives in refs to avoid stale
 * closures killing the timer chain.
 *
 * NO quality gate — simulated beats are intentionally generated for each
 * scenario. Filtering them would defeat the purpose and produce wrong dance
 * features (the gate's 40% deviation rejection silently drops AF/PVC beats).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { PPI_MIN, PPI_MAX } from '../../shared/constants';
import type { PulseOxInterface, ConnectionStatus, SignalQuality } from '../ble/ble-service';

export function useSimulatedPulseOx(
  scenario: RhythmScenario = 'nsr',
  autoStart: boolean = true,
): PulseOxInterface & {
  setScenario: (s: RhythmScenario) => void;
} {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');

  // All mutable state in refs — no stale closures
  const simulatorRef = useRef(new RhythmSimulator({ scenario }));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  // Track scenario prop for display
  const scenarioRef = useRef(scenario);

  /** Generate one beat, update state, schedule next. */
  const tick = useCallback(() => {
    if (!runningRef.current) return;

    const ppi = simulatorRef.current.next();

    // Range check only — no deviation rejection for simulated data
    const inRange = ppi >= PPI_MIN && ppi <= PPI_MAX;

    if (inRange) {
      setLatestPPI(ppi);
      setSignalQuality('good');
    }
    // Out-of-range beats still schedule the next tick but don't emit

    // Schedule next beat at the natural interval
    const delay = Math.max(300, Math.min(inRange ? ppi : 800, 1500));
    timerRef.current = setTimeout(tick, delay);
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setConnectionStatus('connected');
    setSignalQuality('good');

    // First beat after a short delay
    timerRef.current = setTimeout(tick, 500);
  }, [tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setConnectionStatus('disconnected');
    setSignalQuality('disconnected');
    setLatestPPI(null);
  }, []);

  const setScenario = useCallback((s: RhythmScenario) => {
    scenarioRef.current = s;
    simulatorRef.current = new RhythmSimulator({ scenario: s });
  }, []);

  // Sync scenario prop from context → simulator
  useEffect(() => {
    if (scenario !== scenarioRef.current) {
      const wasRunning = runningRef.current;
      stop();
      setScenario(scenario);
      if (wasRunning) {
        // Restart after a microtask so stop() state settles
        setTimeout(() => start(), 50);
      }
    }
  }, [scenario, stop, setScenario, start]);

  // Auto-start on mount
  useEffect(() => {
    if (autoStart) {
      start();
    }
    return () => {
      runningRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback((_deviceId?: string) => {
    setConnectionStatus('connecting');
    setTimeout(() => start(), 300);
  }, [start]);

  return {
    devices: [{ id: 'sim-001', name: 'Simulated Pulse Ox', rssi: -40 }],
    connect,
    disconnect: stop,
    connectionStatus,
    latestPPI,
    signalQuality,
    sourceName: `Simulated (${scenario.toUpperCase()})`,
    setScenario,
  };
}
