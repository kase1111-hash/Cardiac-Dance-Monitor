/**
 * Shared SessionStore singleton, persisted via AsyncStorage.
 * Degrades to in-memory storage where AsyncStorage is unavailable (Jest).
 */
import { SessionStore } from './session-store';
import { appStorage } from './async-storage-adapter';

export const sessionStore = new SessionStore(appStorage);
