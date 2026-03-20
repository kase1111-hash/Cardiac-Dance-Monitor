/**
 * Shared SessionStore singleton.
 *
 * In production, swap MemoryStorage for an AsyncStorage adapter.
 */
import { SessionStore, MemoryStorage } from './session-store';

export const sessionStore = new SessionStore(new MemoryStorage());
