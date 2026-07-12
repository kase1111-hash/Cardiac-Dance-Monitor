/**
 * SignalWatchdog tests — dropout gap detection and staleness from beat
 * timestamps alone.
 */
import { SignalWatchdog } from '../signal-watchdog';
import { SIGNAL_GAP_MS } from '../constants';

describe('SignalWatchdog', () => {
  test('first beat never reports a gap', () => {
    const wd = new SignalWatchdog();
    expect(wd.beat(1000)).toBe(false);
  });

  test('beats within the threshold do not report a gap', () => {
    const wd = new SignalWatchdog(5000);
    wd.beat(0);
    expect(wd.beat(800)).toBe(false);
    expect(wd.beat(1600)).toBe(false);
    expect(wd.beat(1600 + 5000)).toBe(false); // exactly at threshold: not a gap
  });

  test('a beat after a dropout reports a gap', () => {
    const wd = new SignalWatchdog(5000);
    wd.beat(0);
    wd.beat(800);
    expect(wd.beat(800 + 5001)).toBe(true);
  });

  test('gap detection recovers after the gap beat', () => {
    const wd = new SignalWatchdog(5000);
    wd.beat(0);
    expect(wd.beat(30000)).toBe(true);
    // Stream is continuous again — no gap on subsequent beats
    expect(wd.beat(30800)).toBe(false);
  });

  test('isStale is false before any beat', () => {
    const wd = new SignalWatchdog(5000);
    expect(wd.isStale(999999)).toBe(false);
  });

  test('isStale flips once silence exceeds the threshold', () => {
    const wd = new SignalWatchdog(5000);
    wd.beat(1000);
    expect(wd.isStale(1000 + 5000)).toBe(false);
    expect(wd.isStale(1000 + 5001)).toBe(true);
  });

  test('msSinceLastBeat reports elapsed time, null before first beat', () => {
    const wd = new SignalWatchdog();
    expect(wd.msSinceLastBeat(500)).toBeNull();
    wd.beat(1000);
    expect(wd.msSinceLastBeat(3500)).toBe(2500);
  });

  test('reset clears history so the next beat is a clean start', () => {
    const wd = new SignalWatchdog(5000);
    wd.beat(0);
    wd.reset();
    expect(wd.isStale(100000)).toBe(false);
    expect(wd.beat(100000)).toBe(false);
  });

  test('default threshold comes from SIGNAL_GAP_MS', () => {
    const wd = new SignalWatchdog();
    wd.beat(0);
    expect(wd.beat(SIGNAL_GAP_MS)).toBe(false);
    wd.reset();
    wd.beat(0);
    expect(wd.beat(SIGNAL_GAP_MS + 1)).toBe(true);
  });
});
