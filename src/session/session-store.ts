/**
 * Session storage — persists sessions to AsyncStorage. Keeps last 100 sessions.
 * Per SPEC Section 7.
 *
 * Layout: one INDEX row (`cardiac_dance_sessions`) holding every session
 * WITHOUT its per-beat data, plus one RAW row per session
 * (`cardiac_dance_raw:<id>`) holding the rawBeats. Everything used to live in
 * the index row; at ~295 bytes per beat, ten 10-minute rehearsal sessions
 * pushed it past Android's 2 MB SQLite cursor window, the read failed, the
 * app saw "no sessions", and the next save overwrote the whole history.
 *
 * For testing without AsyncStorage (Node environment), the store accepts
 * an optional storage adapter.
 */
import type { Session, RawBeat } from './session-types';

const SESSIONS_KEY = 'cardiac_dance_sessions';
const RAW_KEY_PREFIX = 'cardiac_dance_raw:';
const MAX_SESSIONS = 100;

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  /** Optional: adapters without it fall back to writing an empty string. */
  removeItem?(key: string): Promise<void>;
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
  async removeItem(key: string): Promise<void> {
    delete this.data[key];
  }
  /** Test helper: keys currently stored. */
  keys(): string[] {
    return Object.keys(this.data);
  }
}

/** Thrown by adapters when a read fails, so callers never clobber unread data. */
export class StorageReadError extends Error {
  constructor(public readonly key: string, reason: string) {
    super(`Could not read device storage (${key}): ${reason}`);
    this.name = 'StorageReadError';
  }
}

/**
 * Minimum shape the History and Session Detail screens rely on.
 * Deliberately structural, not exhaustive — it guards the fields those
 * screens dereference without optional chaining.
 */
function isUsableSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Session>;
  return (
    typeof s.id === 'string'
    && typeof s.startTime === 'number'
    && typeof s.beatCount === 'number'
    && typeof s.summaryStats === 'object' && s.summaryStats !== null
    && Array.isArray(s.danceTransitions)
  );
}

/**
 * Raw rows are stored column-wise with rounded floats: one JSON object per
 * beat cost ~230 bytes (mostly repeated keys), so a capped 10,000-beat
 * session was ~2.3 MB — over Android's 2 MB cursor window. Columns bring it
 * to ~1 MB. Legacy rows (a plain array of beats) are still decoded.
 */
const RAW_COLUMNS: (keyof RawBeat)[] = [
  'timestamp_ms', 'ppi_ms', 'source', 'raw_ppg', 'spo2', 'device_bpm',
  'kappa', 'gini', 'spread', 'dance', 'confidence', 'baseline_distance', 'trail_length',
];
const ROUNDED_4: (keyof RawBeat)[] = ['kappa', 'gini', 'spread', 'confidence', 'baseline_distance'];

export function encodeRawBeats(beats: RawBeat[]): string {
  const cols: Record<string, unknown[]> = {};
  for (const key of RAW_COLUMNS) cols[key] = [];
  for (const b of beats) {
    for (const key of RAW_COLUMNS) {
      let v: unknown = b[key];
      if (typeof v === 'number') {
        if (key === 'ppi_ms') v = Math.round(v * 10) / 10;
        else if (ROUNDED_4.includes(key)) v = Math.round(v * 10000) / 10000;
      }
      cols[key].push(v === undefined ? null : v);
    }
  }
  return JSON.stringify({ v: 2, n: beats.length, cols });
}

export function decodeRawBeats(raw: string): RawBeat[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed as RawBeat[]; // legacy row-per-beat
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as { v?: number; n?: number; cols?: Record<string, unknown[]> };
  if (obj.v !== 2 || !obj.cols || typeof obj.n !== 'number') return null;
  const out: RawBeat[] = [];
  for (let i = 0; i < obj.n; i++) {
    const beat: Record<string, unknown> = {};
    for (const key of RAW_COLUMNS) beat[key] = obj.cols[key]?.[i] ?? null;
    out.push(beat as unknown as RawBeat);
  }
  return out;
}

export class SessionStore {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  private rawKey(id: string): string {
    return RAW_KEY_PREFIX + id;
  }

  private async remove(key: string): Promise<void> {
    if (this.storage.removeItem) await this.storage.removeItem(key);
    else await this.storage.setItem(key, '');
  }

  /**
   * Read the index. Throws StorageReadError when the row could not be read;
   * anything malformed is dropped with a warning.
   */
  private async readIndex(): Promise<Session[]> {
    const raw = await this.storage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      console.warn('SESSION_STORE: stored value is not an array — ignoring');
      return [];
    }
    const valid = parsed.filter(isUsableSession);
    if (valid.length !== parsed.length) {
      console.warn(
        `SESSION_STORE: dropped ${parsed.length - valid.length} malformed session(s)`,
      );
    }
    return valid;
  }

  /**
   * All sessions, newest first, WITHOUT per-beat data (use getSession for
   * that). A read failure yields an empty list — listing is read-only, so
   * that is safe; saves must not be built on it (see saveSession).
   */
  async getSessions(): Promise<Session[]> {
    let index: Session[];
    try {
      index = await this.readIndex();
    } catch (e: any) {
      console.warn('SESSION_STORE: read failed —', e?.message ?? e);
      return [];
    }
    return index.map(s => {
      if (!s.rawBeats) return s;
      // Legacy row written with the beats inline: present it like the rest.
      const { rawBeats, ...rest } = s;
      return { ...rest, rawBeatCount: rawBeats.length };
    });
  }

  /**
   * Insert or replace a session by id. Per-beat data goes to its own row.
   * Propagates read errors so a history that could not be read is never
   * overwritten by a one-session list.
   */
  async saveSession(session: Session): Promise<void> {
    const index = await this.readIndex();
    const { rawBeats, ...summary } = session;
    const entry: Session = {
      ...summary,
      rawBeatCount: rawBeats?.length ?? session.rawBeatCount ?? 0,
    };

    const existing = index.findIndex(s => s.id === session.id);
    if (existing >= 0) {
      index[existing] = entry;
    } else {
      index.unshift(entry); // newest first
    }

    // Keep last MAX_SESSIONS (and their raw rows)
    const evicted = index.splice(MAX_SESSIONS);

    if (rawBeats && rawBeats.length > 0) {
      await this.storage.setItem(this.rawKey(session.id), encodeRawBeats(rawBeats));
    }
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify(index));
    for (const s of evicted) {
      await this.remove(this.rawKey(s.id));
    }
  }

  /** One session with its per-beat data (legacy inline beats still honoured). */
  async getSession(id: string): Promise<Session | null> {
    let index: Session[];
    try {
      index = await this.readIndex();
    } catch (e: any) {
      console.warn('SESSION_STORE: read failed —', e?.message ?? e);
      return null;
    }
    const found = index.find(s => s.id === id);
    if (!found) return null;
    if (found.rawBeats && found.rawBeats.length > 0) return found;

    let rawBeats: RawBeat[] | undefined;
    try {
      const raw = await this.storage.getItem(this.rawKey(id));
      if (raw) rawBeats = decodeRawBeats(raw) ?? undefined;
    } catch (e: any) {
      console.warn('SESSION_STORE: raw beats unreadable for', id, e?.message ?? e);
    }
    return rawBeats ? { ...found, rawBeats, rawBeatCount: rawBeats.length } : found;
  }

  async deleteSession(id: string): Promise<void> {
    const index = await this.readIndex();
    const filtered = index.filter(s => s.id !== id);
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
    await this.remove(this.rawKey(id));
  }

  async clearAll(): Promise<void> {
    let index: Session[] = [];
    try {
      index = await this.readIndex();
    } catch {
      // nothing readable to clean up
    }
    await this.storage.setItem(SESSIONS_KEY, JSON.stringify([]));
    for (const s of index) {
      await this.remove(this.rawKey(s.id));
    }
  }
}
