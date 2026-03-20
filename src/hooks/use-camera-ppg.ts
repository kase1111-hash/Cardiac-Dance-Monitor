/**
 * Camera PPG hook — uses phone camera + flash to extract PPIs from fingertip.
 *
 * Per SPEC Section 1.4:
 * - Rear camera at 30 fps with flash ON
 * - Red channel extraction (mean intensity per frame)
 * - Butterworth 2nd order bandpass 0.5–4 Hz
 * - Peak detection with 300ms minimum inter-peak
 * - Feed PPIs into same quality gate as BLE
 *
 * UI flow:
 * 1. "Place your fingertip over the camera lens"
 * 2. "Detecting pulse..." (waiting for 5 consistent peaks)
 * 3. "Recording... Hold still" (PPIs flowing to pipeline)
 */
import { useState, useRef, useCallback } from 'react';
import { PPGProcessor } from '../camera/ppg-processor';
import { QualityGate } from '../../shared/quality-gate';
import type { PulseOxInterface, SignalQuality, ConnectionStatus } from '../ble/ble-service';

const VALIDATION_PEAKS = 5;  // peaks before PPI stream is considered valid
const CAMERA_FPS = 30;

export type CameraPPGState = 'idle' | 'detecting' | 'recording';

export interface CameraPPGResult extends PulseOxInterface {
  /** Internal state for UI display */
  ppgState: CameraPPGState;
  /** Number of peaks detected so far */
  peakCount: number;
  /** Process a camera frame (red channel mean). Called by camera component. */
  processFrame: (redMean: number, timestampMs: number) => void;
}

export function useCameraPPG(): CameraPPGResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [ppgState, setPPGState] = useState<CameraPPGState>('idle');
  const [peakCount, setPeakCount] = useState(0);

  const processor = useRef(new PPGProcessor(CAMERA_FPS));
  const qualityGate = useRef(new QualityGate());
  const isActive = useRef(false);

  // Set up PPI callback
  const setupProcessor = useCallback(() => {
    processor.current.onPPI = (ppi: number) => {
      const result = qualityGate.current.check(ppi);
      if (result.valid) {
        setLatestPPI(ppi);
      }
      setSignalQuality(qualityGate.current.getQuality());
    };
  }, []);

  const connect = useCallback(() => {
    processor.current.reset();
    qualityGate.current = new QualityGate();
    setupProcessor();
    isActive.current = true;
    setConnectionStatus('connected');
    setPPGState('detecting');
    setPeakCount(0);
    setSignalQuality('poor');
  }, [setupProcessor]);

  const disconnect = useCallback(() => {
    isActive.current = false;
    processor.current.reset();
    setConnectionStatus('disconnected');
    setPPGState('idle');
    setLatestPPI(null);
    setSignalQuality('disconnected');
    setPeakCount(0);
  }, []);

  const processFrame = useCallback((redMean: number, timestampMs: number) => {
    if (!isActive.current) return;

    processor.current.processFrame(redMean, timestampMs);
    const count = processor.current.getConsecutivePeakCount();
    setPeakCount(count);

    if (count >= VALIDATION_PEAKS && ppgState === 'detecting') {
      setPPGState('recording');
    }
  }, [ppgState]);

  return {
    devices: [],
    connect,
    disconnect,
    connectionStatus,
    latestPPI,
    signalQuality,
    sourceName: 'Camera PPG',
    ppgState,
    peakCount,
    processFrame,
  };
}
