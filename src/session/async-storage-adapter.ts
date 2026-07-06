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

  async getItem(key: string): Promise<string | null> {
    if (this.native) {
      try {
        return await this.native.getItem(key);
      } catch {
        // fall through to in-memory
      }
    }
    return this.fallback[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.native) {
      try {
        await this.native.setItem(key, value);
        return;
      } catch {
        // fall through to in-memory
      }
    }
    this.fallback[key] = value;
  }
}

/** Shared persistent storage for baseline + session history. */
export const appStorage = new AsyncStorageAdapter();
