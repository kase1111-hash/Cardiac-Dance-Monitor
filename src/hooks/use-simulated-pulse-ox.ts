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
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { PPI_MIN, PPI_MAX } from '../../shared/constants';
import { debugLog } from '../../shared/debug';
import type {
  PulseOxInterface, ConnectionStatus, SignalQuality, PPIBeat,
} from '../ble/ble-service';

export type { PPIBeat };

/**
 * On-screen names for the simulated scenarios. The scenario ids are clinical
 * abbreviations (af, chf, pvc) and were rendered verbatim in the header and
 * under the BPM — exactly the clinical labels the design rules forbid.
 */
export const SCENARIO_LABELS: Record<RhythmScenario, string> = {
  nsr: 'Waltz',
  chf: 'Lock-Step',
  af: 'Mosh Pit',
  pvc: 'Stumble',
  transition: 'Transition',
};

export function useSimulatedPulseOx(
  scenario: RhythmScenario = 'nsr',
  autoStart: boolean = true,
): PulseOxInterface & {
  setScenario: (s: RhythmScenario) => void;
} {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [latestBeat, setLatestBeat] = useState<PPIBeat | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');

  // All mutable state in refs — no stale closures
  const simulatorRef = useRef(new RhythmSimulator({ scenario }));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deferred start() calls (connect's 300 ms, scenario change's 50 ms). These
  // were untracked, so a source switch inside that window let start() fire
  // after disconnect() and left an orphaned beat chain running for the rest
  // of the session.
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const seqRef = useRef(0);

  // Track scenario prop for display
  const scenarioRef = useRef(scenario);

  const clearStartTimer = () => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  };

  /** Generate one beat, update state, schedule next. */
  const tick = useCallback(() => {
    if (!runningRef.current) return;

    const ppi = simulatorRef.current.next();

    // Range check only — no deviation rejection for simulated data
    const inRange = ppi >= PPI_MIN && ppi <= PPI_MAX;

    if (inRange) {
      seqRef.current++;
      debugLog('PPI_RECEIVED', ppi, 'seq=', seqRef.current);
      setLatestPPI(ppi);
      setLatestBeat({ ppi, seq: seqRef.current });
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
    clearStartTimer();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setConnectionStatus('disconnected');
    setSignalQuality('disconnected');
    setLatestPPI(null);
    setLatestBeat(null);
    seqRef.current = 0;
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
        startTimerRef.current = setTimeout(() => {
          startTimerRef.current = null;
          start();
        }, 50);
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
      clearStartTimer();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback((_deviceId?: string) => {
    setConnectionStatus('connecting');
    clearStartTimer();
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      start();
    }, 300);
  }, [start]);

  const sourceName = `Simulated · ${SCENARIO_LABELS[scenario] ?? scenario}`;

  return useMemo(() => ({
    devices: [{ id: 'sim-001', name: 'Simulated Pulse Ox', rssi: -40 }],
    connect,
    disconnect: stop,
    connectionStatus,
    latestPPI,
    latestBeat,
    signalQuality,
    sourceName,
    statusMessage: null,
    setScenario,
  }), [connect, stop, connectionStatus, latestPPI, latestBeat, signalQuality, sourceName, setScenario]);
}
