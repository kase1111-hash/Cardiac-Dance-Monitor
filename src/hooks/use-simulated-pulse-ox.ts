/**
 * Simulated pulse oximeter hook — provides the same interface as the real BLE
 * pulse ox but generates PPIs from the rhythm simulator. Used as the primary
 * development environment when no physical hardware is available.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { RhythmSimulator, type RhythmScenario } from '../../shared/simulator';
import { QualityGate } from '../../shared/quality-gate';
import type { PulseOxInterface, ConnectionStatus, SignalQuality } from '../ble/ble-service';

export function useSimulatedPulseOx(
  scenario: RhythmScenario = 'nsr',
  autoStart: boolean = true,
): PulseOxInterface & {
  setScenario: (s: RhythmScenario) => void;
} {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    autoStart ? 'connected' : 'disconnected',
  );
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [currentScenario, setCurrentScenario] = useState<RhythmScenario>(scenario);

  const simulatorRef = useRef<RhythmSimulator>(new RhythmSimulator({ scenario }));
  const gateRef = useRef<QualityGate>(new QualityGate());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startSimulation = useCallback(() => {
    if (intervalRef.current) return;

    setConnectionStatus('connected');
    // Generate a beat roughly every 800ms (adjusts based on PPI)
    let lastPpi = 800;
    intervalRef.current = setInterval(() => {
      const ppi = simulatorRef.current.next();
      const valid = gateRef.current.check(ppi);

      if (valid) {
        setLatestPPI(ppi);
        lastPpi = ppi;
      }

      const quality = gateRef.current.getQualityLevel();
      setSignalQuality(quality);
    }, lastPpi);

    // Use dynamic interval: restart with new timing after each beat
    const dynamicInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const ppi = simulatorRef.current.next();
      const valid = gateRef.current.check(ppi);

      if (valid) {
        setLatestPPI(ppi);
        lastPpi = ppi;
      }

      const quality = gateRef.current.getQualityLevel();
      setSignalQuality(quality);

      if (connectionStatus !== 'disconnected') {
        intervalRef.current = setTimeout(dynamicInterval, Math.max(300, Math.min(lastPpi, 1500))) as unknown as ReturnType<typeof setInterval>;
      }
    };

    // Clear the fixed interval and switch to dynamic
    clearInterval(intervalRef.current);
    intervalRef.current = setTimeout(dynamicInterval, lastPpi) as unknown as ReturnType<typeof setInterval>;
  }, [connectionStatus]);

  const stopSimulation = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current as unknown as ReturnType<typeof setTimeout>);
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setConnectionStatus('disconnected');
    setSignalQuality('disconnected');
    setLatestPPI(null);
  }, []);

  const setScenario = useCallback((s: RhythmScenario) => {
    setCurrentScenario(s);
    simulatorRef.current = new RhythmSimulator({ scenario: s });
    gateRef.current = new QualityGate();
  }, []);

  // Auto-start if requested
  useEffect(() => {
    if (autoStart && connectionStatus === 'connected') {
      startSimulation();
    }
    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current as unknown as ReturnType<typeof setTimeout>);
        clearInterval(intervalRef.current);
      }
    };
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restart simulation when scenario changes
  useEffect(() => {
    if (connectionStatus === 'connected') {
      stopSimulation();
      startSimulation();
    }
  }, [currentScenario]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => {
    setConnectionStatus('connecting');
    // Simulate a brief connection delay
    setTimeout(() => {
      startSimulation();
    }, 500);
  }, [startSimulation]);

  return {
    devices: [{ id: 'sim-001', name: 'Simulated Pulse Ox', rssi: -40 }],
    connect,
    disconnect: stopSimulation,
    connectionStatus,
    latestPPI,
    signalQuality,
    sourceName: `Simulated (${currentScenario.toUpperCase()})`,
    setScenario,
  };
}
