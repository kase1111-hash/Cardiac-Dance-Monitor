/**
 * ReconnectPolicy tests — exponential backoff schedule for BLE auto-reconnect.
 */
import {
  ReconnectPolicy,
  RECONNECT_MAX_ATTEMPTS,
} from '../ble/reconnect-policy';

describe('ReconnectPolicy', () => {
  test('default schedule doubles and caps: 1s, 2s, 4s, 8s, 16s, 16s', () => {
    const policy = new ReconnectPolicy();
    expect(policy.nextDelayMs()).toBe(1000);
    expect(policy.nextDelayMs()).toBe(2000);
    expect(policy.nextDelayMs()).toBe(4000);
    expect(policy.nextDelayMs()).toBe(8000);
    expect(policy.nextDelayMs()).toBe(16000);
    expect(policy.nextDelayMs()).toBe(16000);
  });

  test('returns null once attempts are exhausted', () => {
    const policy = new ReconnectPolicy();
    for (let i = 0; i < RECONNECT_MAX_ATTEMPTS; i++) {
      expect(policy.nextDelayMs()).not.toBeNull();
    }
    expect(policy.nextDelayMs()).toBeNull();
    expect(policy.nextDelayMs()).toBeNull(); // stays exhausted
  });

  test('tracks attempt count', () => {
    const policy = new ReconnectPolicy();
    expect(policy.attemptCount).toBe(0);
    policy.nextDelayMs();
    policy.nextDelayMs();
    expect(policy.attemptCount).toBe(2);
  });

  test('reset restarts the schedule from the base delay', () => {
    const policy = new ReconnectPolicy();
    policy.nextDelayMs();
    policy.nextDelayMs();
    policy.reset();
    expect(policy.attemptCount).toBe(0);
    expect(policy.nextDelayMs()).toBe(1000);
  });

  test('custom parameters are honored', () => {
    const policy = new ReconnectPolicy(500, 2000, 4);
    expect(policy.nextDelayMs()).toBe(500);
    expect(policy.nextDelayMs()).toBe(1000);
    expect(policy.nextDelayMs()).toBe(2000);
    expect(policy.nextDelayMs()).toBe(2000); // capped
    expect(policy.nextDelayMs()).toBeNull(); // exhausted after 4
  });
});
