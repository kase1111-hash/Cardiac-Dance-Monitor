/**
 * Session storage — persists sessions to AsyncStorage. Keeps last 100 sessions.
 * Per SPEC Section 7.
 *
 * For testing without AsyncStorage (Node environment), the store accepts
 * an optional storage adapter.
 */
import type { Session } from './session-types';

const SESSIONS_KEY = 'cardiac_dance_sessions';
const MAX_SESSIONS = 100;

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** In-memory storage adapter for testing */
export class MemoryStorage implements StorageAdapter {
  private data: Record<string, string> = {};
  async getItem(key: string): Promise<string | null> {
    return this.data[key] ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.data[key] = value;
  }
}

export class SessionStore {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  async getSessions(): Promise<Session[]> {
    const raw = await this.storage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as Session[];
    } catch {
      return [];
    }
  }

  async saveSession(session: Session): Promise<void> {
    const sessions = await this.getSessions();
    sessions.unshift(session); // newest first
    // Keep last MAX_SESSIONS
    if (sessions.length > MAX_SESSIONS) {
      sessions.length = MAX_SESSIONS;
    }
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }

  async getSession(id: string): Promise<Session | null> {
    const sessions = await this.getSessions();
    return sessions.find(s => s.id === id) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    const sessions = await this.getSessions();
    const filtered = sessions.filter(s => s.id !== id);
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
  }

  async clearAll(): Promise<void> {
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify([]));
  }
}
