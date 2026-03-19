/**
 * Dance transition tracker tests — SPEC Section 2.6.
 *
 * Hysteresis rules:
 * - Same dance for 5+ windows → no transition logged
 * - Different dance for < 20s (~2 windows) → transient, currentDance unchanged
 * - Different dance sustained ≥ 30s (~4 windows) → transition committed
 * - Quick flicker (A → B → A in 3 windows) → no transition
 */
import { TransitionTracker, type TransitionEvent } from '../dance/transition-tracker';
import { DANCE_UPDATE_INTERVAL } from '../../shared/constants';

// Each window is DANCE_UPDATE_INTERVAL (10) beats.
// At ~60 BPM that's ~10s per window. We'll use explicit timestamps.

describe('TransitionTracker', () => {
  let tracker: TransitionTracker;

  beforeEach(() => {
    tracker = new TransitionTracker();
  });

  test('initial state has no current dance', () => {
    expect(tracker.getCurrentDance()).toBeNull();
    expect(tracker.getTransientDance()).toBeNull();
    expect(tracker.getTransitions()).toHaveLength(0);
  });

  test('first dance is adopted immediately (no prior dance to compare)', () => {
    tracker.update('The Waltz', 1000);
    expect(tracker.getCurrentDance()).toBe('The Waltz');
    expect(tracker.getTransientDance()).toBeNull();
  });

  test('same dance for 5 windows → no transition logged', () => {
    for (let i = 0; i < 5; i++) {
      tracker.update('The Waltz', 1000 + i * 10000);
    }
    expect(tracker.getCurrentDance()).toBe('The Waltz');
    expect(tracker.getTransitions()).toHaveLength(0);
  });

  test('different dance for 2 windows (< 20s) → transient, currentDance unchanged', () => {
    // Establish current dance
    tracker.update('The Waltz', 1000);

    // New dance appears for < 20s (2 windows at ~10s each = ~20s, but we use < 20s timestamps)
    tracker.update('The Mosh Pit', 11000); // +10s
    expect(tracker.getTransientDance()).toBe('The Mosh Pit');
    expect(tracker.getCurrentDance()).toBe('The Waltz'); // unchanged

    tracker.update('The Mosh Pit', 19000); // +18s total — still < 20s
    expect(tracker.getTransientDance()).toBe('The Mosh Pit');
    expect(tracker.getCurrentDance()).toBe('The Waltz'); // still unchanged
    expect(tracker.getTransitions()).toHaveLength(0);
  });

  test('different dance sustained ≥ 30s → transition committed', () => {
    // Establish current dance
    tracker.update('The Waltz', 1000);

    // New dance first appears at 11000, needs 30s sustained → commits at 41000
    tracker.update('The Mosh Pit', 11000); // first appearance
    tracker.update('The Mosh Pit', 21000); // +10s from first
    tracker.update('The Mosh Pit', 31000); // +20s from first
    tracker.update('The Mosh Pit', 41000); // +30s from first — should commit

    expect(tracker.getCurrentDance()).toBe('The Mosh Pit');
    expect(tracker.getTransientDance()).toBeNull();

    const transitions = tracker.getTransitions();
    expect(transitions).toHaveLength(1);
    expect(transitions[0].from).toBe('The Waltz');
    expect(transitions[0].to).toBe('The Mosh Pit');
    expect(transitions[0].timestamp).toBe(41000);
  });

  test('transition logged with from/to/timestamp', () => {
    tracker.update('The Waltz', 0);
    tracker.update('The Sway', 10000);  // first appearance
    tracker.update('The Sway', 20000);
    tracker.update('The Sway', 30000);
    tracker.update('The Sway', 40000);  // 30s from first appearance → commit

    const t = tracker.getTransitions();
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({
      from: 'The Waltz',
      to: 'The Sway',
      timestamp: 40000,
    });
  });

  test('quick flicker (A → B → A in 3 windows) → no transition', () => {
    tracker.update('The Waltz', 0);

    // Flicker to Mosh Pit briefly
    tracker.update('The Mosh Pit', 10000);
    expect(tracker.getTransientDance()).toBe('The Mosh Pit');

    // Back to Waltz before 20s
    tracker.update('The Waltz', 18000);
    expect(tracker.getTransientDance()).toBeNull();
    expect(tracker.getCurrentDance()).toBe('The Waltz');
    expect(tracker.getTransitions()).toHaveLength(0);
  });

  test('multiple transitions are all logged', () => {
    tracker.update('The Waltz', 0);

    // Transition to Mosh Pit: first at 10000, commits at 40000 (30s)
    tracker.update('The Mosh Pit', 10000);
    tracker.update('The Mosh Pit', 20000);
    tracker.update('The Mosh Pit', 30000);
    tracker.update('The Mosh Pit', 40000);
    expect(tracker.getCurrentDance()).toBe('The Mosh Pit');

    // Transition to Sway: first at 50000, commits at 80000 (30s)
    tracker.update('The Sway', 50000);
    tracker.update('The Sway', 60000);
    tracker.update('The Sway', 70000);
    tracker.update('The Sway', 80000);
    expect(tracker.getCurrentDance()).toBe('The Sway');

    const transitions = tracker.getTransitions();
    expect(transitions).toHaveLength(2);
    expect(transitions[0].from).toBe('The Waltz');
    expect(transitions[0].to).toBe('The Mosh Pit');
    expect(transitions[1].from).toBe('The Mosh Pit');
    expect(transitions[1].to).toBe('The Sway');
  });

  test('transient dance clears when original dance returns', () => {
    tracker.update('The Waltz', 0);
    tracker.update('The Mosh Pit', 10000);
    expect(tracker.getTransientDance()).toBe('The Mosh Pit');

    // Original dance returns
    tracker.update('The Waltz', 15000);
    expect(tracker.getTransientDance()).toBeNull();
    expect(tracker.getCurrentDance()).toBe('The Waltz');
  });

  test('reset clears all state', () => {
    tracker.update('The Waltz', 0);
    tracker.update('The Mosh Pit', 10000);
    tracker.update('The Mosh Pit', 20000);
    tracker.update('The Mosh Pit', 30000);

    tracker.reset();

    expect(tracker.getCurrentDance()).toBeNull();
    expect(tracker.getTransientDance()).toBeNull();
    expect(tracker.getTransitions()).toHaveLength(0);
  });

  test('sustained threshold is exactly 30s (boundary test)', () => {
    tracker.update('The Waltz', 0);

    // At exactly 29.999s — should NOT commit
    tracker.update('The Sway', 10000);
    tracker.update('The Sway', 20000);
    tracker.update('The Sway', 29999);
    expect(tracker.getCurrentDance()).toBe('The Waltz');

    // At exactly 30s — should commit
    tracker.update('The Sway', 30000);
    // Actually 30000 - 10000 = 20000ms since first appearance at 10000
    // We need 30s from first appearance: 10000 + 30000 = 40000
    expect(tracker.getCurrentDance()).toBe('The Waltz'); // not yet

    tracker.update('The Sway', 40000); // 30s from first appearance
    expect(tracker.getCurrentDance()).toBe('The Sway');
  });
});
