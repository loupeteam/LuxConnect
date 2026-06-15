import type { SessionInfo } from './types.js';
import { SESSION_RESTORE_MAX_AGE_MS, SESSION_STORAGE_KEY } from './constants.js';
import { type Logger, consoleLogger } from './logger.js';

/**
 * Persisted session payload, including the Node-side cookie jar so that a
 * restored session keeps any `Set-Cookie` values established during auth.
 */
export interface PersistedSession {
  sessionInfo: SessionInfo;
  cookies: Array<[string, string]>;
}

/**
 * Pluggable storage for OPC UA session info so that SPA navigations can
 * reuse the existing connection session instead of re-authenticating on
 * every page load.
 */
export interface SessionStore {
  save(session: PersistedSession): void;
  load(): PersistedSession | null;
  clear(): void;
}

/**
 * Default `SessionStore` backed by `sessionStorage`. No-ops in environments
 * where `sessionStorage` is unavailable (e.g. Node.js or SSR).
 */
export class LocalStorageSessionStore implements SessionStore {
  constructor(
    private readonly maxAgeMs: number = SESSION_RESTORE_MAX_AGE_MS,
    private readonly storageKey: string = SESSION_STORAGE_KEY,
    private readonly log: Logger = consoleLogger,
  ) {}

  save(session: PersistedSession): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const payload = {
        sessionInfo: session.sessionInfo,
        cookies: session.cookies,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
      this.log.debug('Session saved to sessionStorage', {
        sessionId: session.sessionInfo.sessionId,
        cookieCount: session.cookies.length,
      });
    } catch (error) {
      this.log.warn('Failed to save session to sessionStorage:', error);
    }
  }

  load(): PersistedSession | null {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const stored = sessionStorage.getItem(this.storageKey);
      if (!stored) return null;

      const data = JSON.parse(stored) as {
        sessionInfo?: SessionInfo;
        cookies?: Array<[string, string]>;
        timestamp?: number;
      };
      const age = Date.now() - (data.timestamp ?? 0);
      if (age > this.maxAgeMs) {
        this.log.debug('Stored session too old, discarding');
        sessionStorage.removeItem(this.storageKey);
        return null;
      }
      if (!data.sessionInfo) return null;

      this.log.debug('Restored session from sessionStorage', {
        sessionId: data.sessionInfo.sessionId,
        ageSeconds: Math.round(age / 1000),
        cookieCount: data.cookies?.length ?? 0,
      });
      return {
        sessionInfo: data.sessionInfo,
        cookies: data.cookies ?? [],
      };
    } catch (error) {
      this.log.warn('Failed to restore session from sessionStorage:', error);
      try { sessionStorage.removeItem(this.storageKey); } catch { /* ignore */ }
      return null;
    }
  }

  clear(): void {
    if (typeof sessionStorage === 'undefined') return;
    try { sessionStorage.removeItem(this.storageKey); } catch { /* ignore */ }
  }
}

/** In-memory store, useful for tests and Node.js environments without persistence. */
export class InMemorySessionStore implements SessionStore {
  private value: PersistedSession | null = null;
  save(session: PersistedSession): void { this.value = session; }
  load(): PersistedSession | null { return this.value; }
  clear(): void { this.value = null; }
}
