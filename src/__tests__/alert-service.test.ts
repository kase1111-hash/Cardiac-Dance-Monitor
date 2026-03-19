/**
 * Alert service tests — SPEC Section 5.1.
 */
import { AlertService } from '../alerts/alert-service';

describe('AlertService', () => {
  let service: AlertService;
  const now = 1000000;

  beforeEach(() => {
    service = new AlertService();
  });

  test('alert fires when level = alert and no recent suppression', () => {
    const events = service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('alert');
    expect(events[0].distance).toBe(3.5);
    expect(events[0].currentDance).toBe('The Mosh Pit');
    expect(events[0].message).toContain('shifted');
  });

  test('alert suppressed within 30 minutes of previous alert', () => {
    // First alert fires
    service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);

    // Drop back to normal, then alert again within 30 min
    service.processLevelChange('normal', 1.0, 'The Waltz', now + 60000);
    const events = service.processLevelChange('alert', 3.5, 'The Mosh Pit', now + 120000);
    expect(events.length).toBe(0); // suppressed
  });

  test('alert fires again after 30-minute window', () => {
    // First alert
    service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);

    // Drop to normal
    service.processLevelChange('normal', 1.0, 'The Waltz', now + 60000);

    // 31 minutes later — should fire again
    const thirtyOneMin = 31 * 60 * 1000;
    const events = service.processLevelChange('alert', 3.5, 'The Mosh Pit', now + thirtyOneMin);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('alert');
  });

  test('recovery toast when level drops from alert to normal', () => {
    service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);
    const events = service.processLevelChange('normal', 1.0, 'The Waltz', now + 120000);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('recovery');
    expect(events[0].message).toContain('returned to baseline');
  });

  test('no events for normal → normal', () => {
    service.processLevelChange('normal', 0.5, 'The Waltz', now);
    const events = service.processLevelChange('normal', 0.3, 'The Waltz', now + 10000);
    expect(events.length).toBe(0);
  });

  test('no events for learning → learning', () => {
    const events = service.processLevelChange('learning', 0, '', now);
    expect(events.length).toBe(0);
  });

  test('no recovery event when dropping from notice to normal (only from alert)', () => {
    service.processLevelChange('notice', 2.5, 'The Sway', now);
    const events = service.processLevelChange('normal', 1.0, 'The Waltz', now + 10000);
    expect(events.length).toBe(0);
  });

  test('suppression remaining tracks correctly', () => {
    expect(service.getSuppressionRemainingMs(now)).toBe(0);

    service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);
    expect(service.getSuppressionRemainingMs(now + 60000)).toBeGreaterThan(0);
    expect(service.getSuppressionRemainingMs(now + 31 * 60 * 1000)).toBe(0);
  });

  test('reset clears suppression', () => {
    service.processLevelChange('alert', 3.5, 'The Mosh Pit', now);
    expect(service.canFireAlert(now + 1000)).toBe(false);

    service.reset();
    expect(service.canFireAlert(now + 1000)).toBe(true);
  });
});
