/**
 * BLE PPG handler — processes raw PPG waveform data and status packets from
 * Nordic UART devices (Innovo iP900BP-B and similar).
 *
 * Two packet types arrive on the TX characteristic (6e400003-...):
 * - Short (2 bytes, ~28 Hz): raw PPG intensity → PPGProcessor → PPIs
 * - Long  (13 bytes, ~1 Hz): device-computed SpO2/BPM/PI → display + validation
 *
 * Pipeline for raw PPG:
 *   BLE notification → parseInnovoPacket → PPGProcessor
 *     (Butterworth bandpass 0.5–4 Hz @ 28 Hz → peak detection → PPI extraction)
 *
 * Zero-run handling: When PPG value is 0 for >5 consecutive samples, peak
 * detection is paused and the processor resets when signal returns.
 */
import { PPGProcessor } from '../camera/ppg-processor';
import { parseInnovoPacket, parsePPGPacket, type StatusPacket } from './ble-service';

/** Innovo raw PPG sample rate in Hz (measured from real device captures). */
export const INNOVO_PPG_SAMPLE_RATE = 28;

/** Consecutive zero samples before we declare signal dropout. */
const ZERO_RUN_THRESHOLD = 5;

export class BLEPPGHandler {
  private processor: PPGProcessor;
  private _fingerPresent = false;
  private sampleCount = 0;
  private consecutiveZeros = 0;
  private _signalDropout = false;

  // Latest status packet data
  private _latestStatus: StatusPacket | null = null;

  /** Called when a valid PPI is extracted from the PPG waveform. */
  onPPI: ((ppiMs: number) => void) | null = null;

  /** Called when finger presence changes. */
  onFingerPresenceChange: ((present: boolean) => void) | null = null;

  /** Called when a status packet arrives with SpO2/BPM/PI. */
  onStatus: ((status: StatusPacket) => void) | null = null;

  /**
   * @param sampleRate - Expected raw PPG notification rate in Hz (default 28)
   */
  constructor(sampleRate: number = INNOVO_PPG_SAMPLE_RATE) {
    this.processor = new PPGProcessor(sampleRate);
    this.wireOnPPI();
  }

  /**
   * Handle a raw BLE notification from the Nordic UART TX characteristic.
   * Discriminates packet type by length and routes accordingly.
   *
   * @param data - Raw notification bytes (2 bytes: raw PPG, 13 bytes: status)
   * @param timestampMs - Notification arrival timestamp in milliseconds
   */
  handleNotification(data: Uint8Array, timestampMs: number): void {
    const packet = parseInnovoPacket(data);
    if (packet === null) {
      // Fall back to legacy 2-byte parse for backward compatibility
      this.handleLegacyPacket(data, timestampMs);
      return;
    }

    if (packet.type === 'status') {
      this._latestStatus = packet;
      // Update finger presence from status packet too
      this.updateFingerPresence(packet.fingerPresent);
      if (this.onStatus) {
        this.onStatus(packet);
      }
      return;
    }

    // Raw PPG packet
    this.handleRawPPG(packet.fingerPresent, packet.intensity, timestampMs);
  }

  /**
   * Legacy handler for backward compatibility — treats all 2-byte packets
   * using the old parsePPGPacket interface.
   */
  private handleLegacyPacket(data: Uint8Array, timestampMs: number): void {
    const packet = parsePPGPacket(data);
    if (packet === null) return;
    this.handleRawPPG(packet.fingerPresent, packet.intensity, timestampMs);
  }

  /**
   * Process a raw PPG sample (from either new or legacy packet format).
   */
  private handleRawPPG(fingerPresent: boolean, intensity: number, timestampMs: number): void {
    // Track finger presence transitions
    if (fingerPresent !== this._fingerPresent) {
      this.updateFingerPresence(fingerPresent);
      return; // skip this sample — signal is discontinuous at transitions
    }

    // Only process when finger is present
    if (!fingerPresent) return;

    // Zero-run detection: pause peak detection when signal drops out
    if (intensity === 0) {
      this.consecutiveZeros++;
      if (this.consecutiveZeros >= ZERO_RUN_THRESHOLD) {
        if (!this._signalDropout) {
          this._signalDropout = true;
          // Don't process zeros — they'll pollute the filter
        }
        return;
      }
    } else {
      if (this._signalDropout) {
        // Signal returned after dropout — reset processor for clean start
        this._signalDropout = false;
        this.processor.reset();
        this.wireOnPPI();
      }
      this.consecutiveZeros = 0;
    }

    this.sampleCount++;
    this.processor.processFrame(intensity, timestampMs);
  }

  /**
   * Handle finger presence state change.
   */
  private updateFingerPresence(present: boolean): void {
    if (present === this._fingerPresent) return;

    this._fingerPresent = present;
    if (this.onFingerPresenceChange) {
      this.onFingerPresenceChange(this._fingerPresent);
    }

    // Reset processor on any finger transition — signal is discontinuous
    this.processor.reset();
    this.wireOnPPI();
    this.sampleCount = 0;
    this.consecutiveZeros = 0;
    this._signalDropout = false;
  }

  /** Wire the onPPI callback through to the processor. */
  private wireOnPPI(): void {
    this.processor.onPPI = (ppi: number) => {
      if (this.onPPI) {
        this.onPPI(ppi);
      }
    };
  }

  /** Whether the sensor currently detects a finger. */
  get fingerPresent(): boolean {
    return this._fingerPresent;
  }

  /** Whether we're in a signal dropout (zero-run). */
  get signalDropout(): boolean {
    return this._signalDropout;
  }

  /** Latest status packet (SpO2/BPM/PI). */
  get latestStatus(): StatusPacket | null {
    return this._latestStatus;
  }

  /** Device-reported SpO2, or -1 if unavailable. */
  get spo2(): number {
    return this._latestStatus?.spo2 ?? -1;
  }

  /** Device-reported BPM (for validation against PPG-derived BPM). */
  get deviceBPM(): number {
    return this._latestStatus?.bpm ?? 0;
  }

  /** Device-reported perfusion index. */
  get perfusionIndex(): number {
    return this._latestStatus?.perfusionIndex ?? 0;
  }

  /** Number of PPG samples processed since last reset/finger change. */
  getSampleCount(): number {
    return this.sampleCount;
  }

  /** Number of peaks detected by the underlying PPGProcessor. */
  getConsecutivePeakCount(): number {
    return this.processor.getConsecutivePeakCount();
  }

  /** Reset all state (filter, peak detector, counters, status). */
  reset(): void {
    this.processor.reset();
    this._fingerPresent = false;
    this.sampleCount = 0;
    this.consecutiveZeros = 0;
    this._signalDropout = false;
    this._latestStatus = null;
    this.wireOnPPI();
  }
}
