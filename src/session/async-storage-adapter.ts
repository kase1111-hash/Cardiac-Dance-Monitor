/**
 * StorageAdapter backed by @react-native-async-storage/async-storage.
 *
 * AsyncStorage is loaded lazily via require() so importing this module never
 * crashes in environments without the native module (Jest, node). In that
 * case it degrades to in-memory storage — same behavior as MemoryStorage.
 */
import type { StorageAdapter } from './session-store';

interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function loadAsyncStorage(): AsyncStorageLike | null {
  try {
    return require('@react-native-async-storage/async-storage').default ?? null;
  } catch {
    return null;
  }
}

export class AsyncStorageAdapter implements StorageAdapter {
  private native: AsyncStorageLike | null = loadAsyncStorage();
  private fallback: Record<string, string> = {};
  /**
   * Keys whose last native write failed (AsyncStorage has a ~6MB database
   * limit on Android). Reads for these MUST come from the fallback: reading
   * native first would return the last successfully-persisted value, so the
   * app silently showed stale data while every new write vanished.
   */
  private failedKeys = new Set<string>();
  private lastError: string | null = null;

  async getItem(key: string): Promise<string | null> {
    if (this.native && !this.failedKeys.has(key)) {
      try {
        return await this.native.getItem(key);
      } catch {
        // fall through to in-memory
      }
    }
    return this.fallback[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    // Always keep the in-memory copy current so a later failure can serve it.
    this.fallback[key] = value;
    if (this.native) {
      try {
        await this.native.setItem(key, value);
        this.failedKeys.delete(key);
        return;
      } catch (e: any) {
        const reason = e?.message ?? String(e);
        this.failedKeys.add(key);
        this.lastError = reason;
        console.warn('STORAGE_WRITE_FAILED:', key, reason);
        throw new StorageQuotaError(key, reason);
      }
    }
  }

  /** True if any write has failed — persistence is degraded to this session. */
  hasFailedWrites(): boolean {
    return this.failedKeys.size > 0;
  }

  /** Message from the most recent write failure, if any. */
  getLastError(): string | null {
    return this.lastError;
  }
}

/** Thrown when a native write fails so callers can surface it to the user. */
export class StorageQuotaError extends Error {
  constructor(public readonly key: string, reason: string) {
    super(`Could not save to device storage (${key}): ${reason}`);
    this.name = 'StorageQuotaError';
  }
}

/** Shared persistent storage for baseline + session history. */
export const appStorage = new AsyncStorageAdapter();
