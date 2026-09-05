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
 *
 * Connection semantics: connect() reports 'connecting' until the first
 * camera frame actually arrives. Reporting 'connected' up front made the
 * header claim a live camera in Expo Go (where VisionCamera cannot load)
 * and while the permission prompt was still open.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { PPGProcessor } from '../camera/ppg-processor';
import { QualityGate } from '../../shared/quality-gate';
import { PPI_DEVIATION_MAX } from '../../shared/constants';
import type { PulseOxInterface, SignalQuality, ConnectionStatus, PPIBeat } from '../ble/ble-service';

/** Peaks that must be seen before the PPI stream is considered valid. */
export const VALIDATION_PEAKS = 5;
const CAMERA_FPS = 30;

/**
 * Red-channel mean below this means no fingertip is covering the torch-lit
 * lens (a covered lens saturates red well above 150/255; a room or wall
 * reads far lower). Below it, nothing is processed and no beats are emitted.
 */
export const CAMERA_FINGER_RED_MIN = 100;
/**
 * Minimum filtered peak-to-peak swing for a peak to count as a pulse. A few
 * LSB of sensor noise still produced ~2 "beats" per second with the lens
 * uncovered; a real fingertip pulse swings several units.
 */
export const CAMERA_MIN_PULSE_AMPLITUDE = 1.5;
/** If no frame arrives this long after connect(), the camera is not coming. */
const CAMERA_START_TIMEOUT_MS = 8000;

export type CameraPPGState = 'idle' | 'detecting' | 'recording';

export interface CameraPPGResult extends PulseOxInterface {
  /** Internal state for UI display */
  ppgState: CameraPPGState;
  /** Number of peaks detected so far */
  peakCount: number;
  /** Process a camera frame (red channel mean). Called by camera component. */
  processFrame: (redMean: number, timestampMs: number) => void;
}

/**
 * @param deviationTolerance - Fractional deviation from the running median
 *   beyond which a beat counts against the signal-quality badge. Does not
 *   affect which beats reach the pipeline.
 */
export function useCameraPPG(
  deviationTolerance: number = PPI_DEVIATION_MAX,
): CameraPPGResult {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [latestPPI, setLatestPPI] = useState<number | null>(null);
  const [latestBeat, setLatestBeat] = useState<PPIBeat | null>(null);
  const [signalQuality, setSignalQuality] = useState<SignalQuality>('disconnected');
  const [ppgState, setPPGState] = useState<CameraPPGState>('idle');
  const [peakCount, setPeakCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const processor = useRef<PPGProcessor | null>(null);
  if (!processor.current) {
    processor.current = new PPGProcessor(CAMERA_FPS, { minAmplitude: CAMERA_MIN_PULSE_AMPLITUDE });
  }
  const qualityGate = useRef(new QualityGate(deviationTolerance));
  const isActive = useRef(false);
  const seqRef = useRef(0);
  const ppgStateRef = useRef<CameraPPGState>('idle');
  const peakCountRef = useRef(0);
  const fingerOnRef = useRef(false);
  const sawFrameRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStartTimer = () => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  };

  const setPhase = (next: CameraPPGState) => {
    ppgStateRef.current = next;
    setPPGState(next);
  };

  // Set up PPI callback
  const setupProcessor = useCallback(() => {
    processor.current!.onPPI = (ppi: number) => {
      // Beats are withheld until the pulse has been validated (5 peaks) —
      // the overlay promises "Detecting pulse..." and the filter's start-up
      // transient is not a heartbeat.
      if (processor.current!.getConsecutivePeakCount() < VALIDATION_PEAKS) return;
      const valid = qualityGate.current.check(ppi);
      if (valid) {
        seqRef.current++;
        setLatestPPI(ppi);
        // Sequence number guarantees a new identity even when two consecutive
        // PPIs are numerically equal — otherwise React bails out and the beat
        // is silently lost.
        setLatestBeat({ ppi, seq: seqRef.current });
      }
      setSignalQuality(qualityGate.current.getQualityLevel());
    };
  }, []);

  const connect = useCallback(() => {
    processor.current!.reset();
    qualityGate.current = new QualityGate(deviationTolerance);
    setupProcessor();
    isActive.current = true;
    sawFrameRef.current = false;
    fingerOnRef.current = false;
    peakCountRef.current = 0;
    setConnectionStatus('connecting');
    setStatusMessage(null);
    setPhase('detecting');
    setPeakCount(0);
    setSignalQuality('poor');

    clearStartTimer();
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      if (!isActive.current || sawFrameRef.current) return;
      isActive.current = false;
      setConnectionStatus('disconnected');
      setSignalQuality('disconnected');
      setPhase('idle');
      setStatusMessage(
        'Camera did not start. Allow camera access in Settings, or use a development build — the camera is not available in Expo Go.',
      );
    }, CAMERA_START_TIMEOUT_MS);
  }, [setupProcessor, deviationTolerance]);

  const disconnect = useCallback(() => {
    clearStartTimer();
    isActive.current = false;
    sawFrameRef.current = false;
    fingerOnRef.current = false;
    peakCountRef.current = 0;
    processor.current!.reset();
    setConnectionStatus('disconnected');
    setStatusMessage(null);
    setPhase('idle');
    setLatestPPI(null);
    setLatestBeat(null);
    setSignalQuality('disconnected');
    setPeakCount(0);
  }, []);

  useEffect(() => () => clearStartTimer(), []);

  // Stable identity: the camera component installs its native frame
  // processor from this callback, so a new function per render re-installed
  // the processor several times per second.
  const processFrame = useCallback((redMean: number, timestampMs: number) => {
    if (!isActive.current) return;

    if (!sawFrameRef.current) {
      sawFrameRef.current = true;
      clearStartTimer();
      setConnectionStatus('connected');
    }

    // Finger gate: nothing covering the lit lens → do not fabricate beats.
    if (redMean < CAMERA_FINGER_RED_MIN) {
      if (fingerOnRef.current) {
        fingerOnRef.current = false;
        processor.current!.reset();
        peakCountRef.current = 0;
        setPeakCount(0);
        setSignalQuality('poor');
        setPhase('detecting');
      }
      return;
    }
    fingerOnRef.current = true;

    processor.current!.processFrame(redMean, timestampMs);
    const count = processor.current!.getConsecutivePeakCount();
    if (count !== peakCountRef.current) {
      peakCountRef.current = count;
      setPeakCount(count);
    }

    if (count >= VALIDATION_PEAKS && ppgStateRef.current === 'detecting') {
      setPhase('recording');
    }
  }, []);

  return useMemo(() => ({
    devices: [],
    connect,
    disconnect,
    connectionStatus,
    latestPPI,
    latestBeat,
    signalQuality,
    sourceName: 'Camera PPG',
    statusMessage,
    ppgState,
    peakCount,
    processFrame,
  }), [
    connect, disconnect, connectionStatus, latestPPI, latestBeat, signalQuality,
    statusMessage, ppgState, peakCount, processFrame,
  ]);
}
