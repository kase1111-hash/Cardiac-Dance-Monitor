/**
 * Session store tests — verifies persistence, ordering, and max capacity.
 */
import { SessionStore, MemoryStorage } from '../session/session-store';
import type { Session } from '../session/session-types';

function makeSession(id: string, overrides?: Partial<Session>): Session {
  return {
    id,
    startTime: Date.now(),
    endTime: Date.now() + 60000,
    dominantDance: 'The Waltz',
    beatCount: 100,
    changeEvents: [],
    danceTransitions: [],
    summaryStats: { bpmMean: 75, kappaMedian: 10.5, giniMean: 0.39 },
    ...overrides,
  };
}

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(new MemoryStorage());
  });

  test('initially returns empty list', async () => {
    const sessions = await store.getSessions();
    expect(sessions).toEqual([]);
  });

  test('saves and retrieves a session', async () => {
    const session = makeSession('s1');
    await store.saveSession(session);
    const sessions = await store.getSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('s1');
  });

  test('newest session is first', async () => {
    await store.saveSession(makeSession('s1'));
    await store.saveSession(makeSession('s2'));
    const sessions = await store.getSessions();
    expect(sessions[0].id).toBe('s2');
    expect(sessions[1].id).toBe('s1');
  });

  test('getSession by id', async () => {
    await store.saveSession(makeSession('s1'));
    await store.saveSession(makeSession('s2'));
    const s = await store.getSession('s1');
    expect(s).not.toBeNull();
    expect(s!.id).toBe('s1');
  });

  test('getSession returns null for unknown id', async () => {
    const s = await store.getSession('nonexistent');
    expect(s).toBeNull();
  });

  test('deleteSession removes it', async () => {
    await store.saveSession(makeSession('s1'));
    await store.saveSession(makeSession('s2'));
    await store.deleteSession('s1');
    const sessions = await store.getSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('s2');
  });

  test('keeps max 100 sessions', async () => {
    for (let i = 0; i < 105; i++) {
      await store.saveSession(makeSession(`s${i}`));
    }
    const sessions = await store.getSessions();
    expect(sessions.length).toBe(100);
    // Newest should be first
    expect(sessions[0].id).toBe('s104');
  });

  test('clearAll empties the store', async () => {
    await store.saveSession(makeSession('s1'));
    await store.clearAll();
    const sessions = await store.getSessions();
    expect(sessions).toEqual([]);
  });

  test('session data is preserved correctly', async () => {
    const session = makeSession('s1', {
      dominantDance: 'The Mosh Pit',
      beatCount: 500,
      danceTransitions: [{ timestamp: 123, from: 'The Waltz', to: 'The Mosh Pit' }],
      summaryStats: { bpmMean: 90, kappaMedian: 3.3, giniMean: 0.512 },
    });
    await store.saveSession(session);
    const retrieved = await store.getSession('s1');
    expect(retrieved!.dominantDance).toBe('The Mosh Pit');
    expect(retrieved!.beatCount).toBe(500);
    expect(retrieved!.danceTransitions.length).toBe(1);
    expect(retrieved!.summaryStats.giniMean).toBe(0.512);
  });
});
