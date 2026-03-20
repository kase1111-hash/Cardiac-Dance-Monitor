# Innovo iP900BP-B BLE Protocol — Decoded from Real Data

## Service and Characteristic UUIDs (CORRECTED)

The data characteristic 0xFFF1 lives under the **Nordic UART Service**, NOT under 0xFFF0.

- **Service UUID:** `6e400001-b5a3-f393-e0a9-e50e24dcca9e` (Nordic UART)
- **Characteristic UUID:** `0000fff1-0000-1000-8000-00805f9b34fb` (0xFFF1, NOTIFY)

The scan should look for the Nordic UART service UUID, not 0xFFF0.

## Two Packet Types on 0xFFF1

### Type 1: Raw PPG Waveform (2 bytes)
- Format: `01 XX` where XX = PPG intensity (0x00-0xFE)
- Sample rate: **~28 Hz** (one sample every ~36ms)
- Range: 0-254
- When finger removed: `01 00` repeatedly
- When signal drops momentarily: runs of `01 00` for 5-10 samples then resumes

### Type 2: Computed Status (13 bytes)
- Format: `3E SS 00 HR 00 PI 20 00 00 00 00 XX F0`
- Frequency: Once per second (~every 24 PPG samples)
- Fields:
  - Byte 0: `0x3E` header
  - Byte 1: **SpO2 percentage** (0x60 = 96%)
  - Byte 3: **Heart Rate BPM** (0x42 = 66 BPM)
  - Byte 5: **Perfusion Index** (0x11 = 17)
  - Byte 12: `0xF0` footer

## Real Waveform Characteristics

From 1101 PPG samples and 46 status packets:

- PPG amplitude range: 0-254
- Mean inter-peak interval: 25.6 samples
- At 28 Hz sample rate: ~914ms per beat = ~66 BPM (matches device BPM)
- Clear systolic peak followed by smooth dicrotic notch
- Zero-value runs (01-00 repeated 5-10x) occur between some beats — these are signal gaps, not "finger removed"

## Recommended Implementation

### Option A: Use Status Packets (SIMPLER)
Parse the 13-byte status packets to get BPM directly. 
- BPM arrives once per second
- Compute PPI as 60000/BPM (approximate, no beat-to-beat variability)
- Fast to implement but loses the fine timing resolution

### Option B: Use Raw PPG + Peak Detection (BETTER)
Feed the 2-byte PPG values into PPGProcessor at 28 Hz.
- Butterworth bandpass filter (currently calibrated for 30 Hz — close enough for 28 Hz)
- Peak detection produces real inter-peak intervals with beat-to-beat variability
- This gives TRUE PPIs, not BPM-derived approximations
- Handle zero-value runs: if PPG=0 for >5 consecutive samples, pause peak detection and resume when signal returns

### Option C: BOTH (BEST)
Use raw PPG for torus computation (Option B) and use status packets to validate:
- Cross-check: PPG-derived BPM should be within ±5 of status packet BPM
- Display SpO2 from status packets (we can't compute SpO2 from a single wavelength)
- Display PI from status packets as signal quality indicator

## Packet Discrimination
- If packet length == 2 AND first byte == 0x01: raw PPG waveform
- If packet length == 13 AND first byte == 0x3E AND last byte == 0xF0: status packet
- Discard anything else
