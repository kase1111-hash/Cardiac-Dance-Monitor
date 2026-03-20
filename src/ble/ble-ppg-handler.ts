/**
 * BLE PPG handler — processes raw PPG waveform data from Nordic-style BLE
 * devices (service 0xFFF0, characteristic 0xFFF1) through the same signal
 * processing pipeline used for camera PPG.
 *
 * Pipeline: BLE notification → parsePPGPacket → PPGProcessor
 *   (Butterworth bandpass 0.5–4 Hz → peak detection → PPI extraction)
 *
 * The PPGProcessor is reused from src/camera/ppg-processor.ts.
 * Sample rate defaults to 25 Hz (typical for Nordic PPG devices like
 * the Innovo iP900BP-B), but can be configured.
 */
import { PPGProcessor } from '../camera/ppg-processor';
import { parsePPGPacket } from './ble-service';

const DEFAULT_BLE_PPG_SAMPLE_RATE = 25; // Hz, typical for Nordic PPG devices

export class BLEPPGHandler {
  private processor: PPGProcessor;
  private _fingerPresent = false;
  private sampleCount = 0;

  /** Called when a valid PPI is extracted from the PPG waveform. */
  onPPI: ((ppiMs: number) => void) | null = null;

  /** Called when finger presence changes. */
  onFingerPresenceChange: ((present: boolean) => void) | null = null;

  /**
   * @param sampleRate - Expected notification rate in Hz (default 25)
   */
  constructor(sampleRate: number = DEFAULT_BLE_PPG_SAMPLE_RATE) {
    this.processor = new PPGProcessor(sampleRate);
    this.processor.onPPI = (ppi: number) => {
      if (this.onPPI) {
        this.onPPI(ppi);
      }
    };
  }

  /**
   * Handle a raw BLE notification from characteristic 0xFFF1.
   *
   * @param data - Raw notification bytes (2 bytes: status + intensity)
   * @param timestampMs - Notification arrival timestamp in milliseconds
   */
  handleNotification(data: Uint8Array, timestampMs: number): void {
    const packet = parsePPGPacket(data);
    if (packet === null) return;

    // Track finger presence transitions
    if (packet.fingerPresent !== this._fingerPresent) {
      this._fingerPresent = packet.fingerPresent;
      if (this.onFingerPresenceChange) {
        this.onFingerPresenceChange(this._fingerPresent);
      }

      // Reset processor when finger is removed or re-placed —
      // the signal is discontinuous across these events
      this.processor.reset();
      this.sampleCount = 0;
      // Re-attach onPPI after reset since reset clears internal state only
      this.processor.onPPI = (ppi: number) => {
        if (this.onPPI) {
          this.onPPI(ppi);
        }
      };
      return;
    }

    // Only process when finger is present
    if (!packet.fingerPresent) return;

    this.sampleCount++;
    this.processor.processFrame(packet.intensity, timestampMs);
  }

  /** Whether the sensor currently detects a finger. */
  get fingerPresent(): boolean {
    return this._fingerPresent;
  }

  /** Number of PPG samples processed since last reset/finger change. */
  getSampleCount(): number {
    return this.sampleCount;
  }

  /** Number of peaks detected by the underlying PPGProcessor. */
  getConsecutivePeakCount(): number {
    return this.processor.getConsecutivePeakCount();
  }

  /** Reset all state (filter, peak detector, counters). */
  reset(): void {
    this.processor.reset();
    this._fingerPresent = false;
    this.sampleCount = 0;
    // Re-attach onPPI after reset
    this.processor.onPPI = (ppi: number) => {
      if (this.onPPI) {
        this.onPPI(ppi);
      }
    };
  }
}
