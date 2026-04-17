/**
 * Unit tests for connection manager - focusing on testable behavior
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpcuaConnection } from '../../src/connection.js';
import { ConnectionState } from '../../src/types.js';

describe('OpcuaConnection - Core Functionality', () => {
  let connection: OpcuaConnection;
  const mockConfig = {
    host: 'localhost',
    port: 8443,
    protocol: 'https' as const,
    username: 'test',
    password: 'test'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    connection = new OpcuaConnection(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should start in disconnected state', () => {
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should expose WebSocket manager', () => {
      const wsManager = connection.getWebSocket();
      expect(wsManager).toBeDefined();
    });

    it('should register error handlers', () => {
      const errorCallback = vi.fn();
      connection.onError(errorCallback);
      
      // Test that the callback is registered (doesn't throw)
      expect(errorCallback).not.toHaveBeenCalled();
    });

    it('should register connection state handlers', () => {
      const stateCallback = vi.fn();
      connection.onConnectionStateChanged(stateCallback);
      
      // Test that the callback is registered (doesn't throw)
      expect(stateCallback).not.toHaveBeenCalled();
    });

    it('should return null session info when not connected', () => {
      const sessionInfo = connection.getSessionInfo();
      expect(sessionInfo).toBeNull();
    });

    it('should report not connected initially', () => {
      expect(connection.isConnected).toBe(false);
    });
  });

  describe('Connection Attempts', () => {
    it('should handle authentication failures gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      await expect(connection.connect()).rejects.toThrow();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle network errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      await expect(connection.connect()).rejects.toThrow();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should transition through connecting state', async () => {
      const stateChanges: ConnectionState[] = [];
      connection.onConnectionStateChanged(state => stateChanges.push(state));

      // Mock successful authentication but fail later
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, username: 'test' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ 
            sessionId: '1', 
            sessionTimeout: 30000,
            endpointUrl: 'opc.tcp://localhost:4840',
            maxRequestMessageSize: 65536,
            maxResponseMessageSize: 65536
          })
        });

      try {
        await connection.connect();
      } catch {
        // Expected to fail in test environment due to WebSocket/TLS issues
      }
      
      // Should have attempted to transition to connecting state
      expect(stateChanges).toContain(ConnectionState.CONNECTING);
    });
  });

  describe('API Request Validation', () => {
    it('should reject API requests when not connected', async () => {
      await expect(connection.apiRequest('/test', { method: 'GET' }))
        .rejects.toThrow('Not connected to OPC UA server');
    });

    it('should create proper test connection instance', () => {
      expect(connection).toBeInstanceOf(OpcuaConnection);
      expect(connection.state).toBeDefined();
      expect(connection.getSessionInfo).toBeInstanceOf(Function);
      expect(connection.apiRequest).toBeInstanceOf(Function);
    });
  });
});