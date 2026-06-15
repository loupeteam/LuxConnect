import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageSessionStore } from '../../src/session-store.js';
import { silentLogger } from '../../src/logger.js';

describe('LocalStorageSessionStore', () => {
  const storageKey = 'test-session-key';
  const sessionStorageMock = {
    setItem: vi.fn<(key: string, value: string) => void>(),
    getItem: vi.fn<(key: string) => string | null>(),
    removeItem: vi.fn<(key: string) => void>(),
  };
  const localStorageMock = {
    setItem: vi.fn<(key: string, value: string) => void>(),
    getItem: vi.fn<(key: string) => string | null>(),
    removeItem: vi.fn<(key: string) => void>(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('sessionStorage', sessionStorageMock);
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads from sessionStorage (not localStorage)', () => {
    const store = new LocalStorageSessionStore(10_000, storageKey, silentLogger);
    const persisted = {
      sessionInfo: {
        sessionId: 'abc',
        sessionTimeout: 30_000,
        maxRequestMessageSize: 65_536,
        maxResponseMessageSize: 65_536,
        endpointUrl: 'opc.tcp://localhost:4840',
      },
      cookies: [['cookie', 'value']] as Array<[string, string]>,
    };

    store.save(persisted);
    expect(sessionStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();

    const savedPayload = sessionStorageMock.setItem.mock.calls[0]?.[1];
    sessionStorageMock.getItem.mockReturnValue(savedPayload ?? null);

    expect(store.load()).toEqual(persisted);
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
  });

  it('clears stale entries from sessionStorage', () => {
    const store = new LocalStorageSessionStore(5, storageKey, silentLogger);
    sessionStorageMock.getItem.mockReturnValue(JSON.stringify({
      sessionInfo: {
        sessionId: 'old',
        sessionTimeout: 30_000,
        maxRequestMessageSize: 65_536,
        maxResponseMessageSize: 65_536,
        endpointUrl: 'opc.tcp://localhost:4840',
      },
      cookies: [],
      timestamp: Date.now() - 1000,
    }));

    expect(store.load()).toBeNull();
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(storageKey);
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });
});
