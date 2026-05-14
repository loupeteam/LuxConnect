import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VariableManager } from '../../src/variable-manager.js';
import { consoleLogger } from '../../src/logger.js';

describe('Error Handling System', () => {
  let variableManager: VariableManager;
  let mockConnection: any;

  beforeEach(() => {
    // Create mock connection with all required methods. `getLogger` is wired
    // so VariableManager routes diagnostics through the Logger interface,
    // which `consoleLogger` forwards to console.* — keeping the spies below
    // working without coupling to a private logger.
    mockConnection = {
      apiRequest: vi.fn(),
      getSessionId: vi.fn(() => '1'),
      getSessionInfo: vi.fn(() => ({ sessionId: '1', timeout: 30000 })),
      isConnected: vi.fn(() => true),
      getLogger: vi.fn(() => consoleLogger)
    };

    variableManager = new VariableManager(mockConnection);
    
    // Register test variables
    variableManager.registerVariable('TestVar', 'ns=5;s=::TestVar');
    variableManager.registerVariable('TestArray', 'ns=5;s=::TestArray');
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset to default error policy after each test
    variableManager.setErrorPolicy('default');
  });

  describe('Error Policy Configuration', () => {
    it('should allow setting different error policies', () => {
      expect(() => variableManager.setErrorPolicy('default')).not.toThrow();
      expect(() => variableManager.setErrorPolicy('strict')).not.toThrow();
      expect(() => variableManager.setErrorPolicy('silent')).not.toThrow();
    });
  });

  describe('Default Error Policy (Crash-Resistant)', () => {
    beforeEach(() => {
      variableManager.setErrorPolicy('default');
    });

    it('should return undefined on read failure and log warning', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Mock API failure
      mockConnection.apiRequest.mockRejectedValue(new Error('Connection failed'));

      const result = await variableManager.readValue('TestVar');
      
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain(`Operation failed for 'TestVar': Connection failed (using cached/fallback value)`);

      consoleSpy.mockRestore();
    });

    it('should return undefined on write failure and log warning', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Mock API failure
      mockConnection.apiRequest.mockRejectedValue(new Error('Write failed'));

      const result = await variableManager.writeValue('TestVar', 100);
      
      expect(result).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain(`Operation failed for 'TestVar': Write failed (using cached/fallback value)`);

      consoleSpy.mockRestore();
    });

    it('should not crash the application on errors', async () => {
      // Mock multiple different error types
      mockConnection.apiRequest
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Server error'));

      // These operations should all complete without throwing
      await expect(variableManager.readValue('TestVar')).resolves.toBeUndefined();
      await expect(variableManager.writeValue('TestVar', 123)).resolves.toBeUndefined();
      await expect(variableManager.readValue('TestArray')).resolves.toBeUndefined();
    });
  });

  describe('Strict Error Policy', () => {
    beforeEach(() => {
      variableManager.setErrorPolicy('strict');
    });

    it('should throw errors on read failure', async () => {
      mockConnection.apiRequest.mockRejectedValue(new Error('Connection failed'));

      await expect(variableManager.readValue('TestVar')).rejects.toThrow();
    });

    it('should throw errors on write failure', async () => {
      mockConnection.apiRequest.mockRejectedValue(new Error('Write failed'));

      await expect(variableManager.writeValue('TestVar', 100)).rejects.toThrow();
    });

    it('should preserve original error information', async () => {
      const originalError = new Error('Test error message');
      mockConnection.apiRequest.mockRejectedValue(originalError);

      try {
        await variableManager.readValue('TestVar');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error instanceof Error).toBe(true);
      }
    });
  });

  describe('Silent Error Policy', () => {
    beforeEach(() => {
      variableManager.setErrorPolicy('silent');
    });

    it('should return undefined without logging on read failure', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      mockConnection.apiRequest.mockRejectedValue(new Error('Silent error'));

      const result = await variableManager.readValue('TestVar');
      
      expect(result).toBeUndefined();
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should return undefined without logging on write failure', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      mockConnection.apiRequest.mockRejectedValue(new Error('Silent write error'));

      const result = await variableManager.writeValue('TestVar', 123);
      
      expect(result).toBeUndefined();
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Error Policy Behavior Differences', () => {
    it('should behave differently across error policies for same error', async () => {
      const testError = new Error('Test error for policy comparison');
      
      // Test default policy (should log warning and return undefined)
      variableManager.setErrorPolicy('default');
      mockConnection.apiRequest.mockRejectedValue(testError);
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const defaultResult = await variableManager.readValue('TestVar');
      
      expect(defaultResult).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();

      // Test strict policy (should throw)
      variableManager.setErrorPolicy('strict');
      mockConnection.apiRequest.mockRejectedValue(testError);
      
      await expect(variableManager.readValue('TestVar')).rejects.toThrow();

      // Test silent policy (should return undefined without logging)
      variableManager.setErrorPolicy('silent');
      mockConnection.apiRequest.mockRejectedValue(testError);
      
      const silentConsole = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const silentResult = await variableManager.readValue('TestVar');
      
      expect(silentResult).toBeUndefined();
      expect(silentConsole).not.toHaveBeenCalled();
      silentConsole.mockRestore();
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle successful operations after errors', async () => {
      variableManager.setErrorPolicy('default');

      // First call fails
      mockConnection.apiRequest.mockRejectedValueOnce(new Error('Temporary failure'));
      const failResult = await variableManager.readValue('TestVar');
      expect(failResult).toBeUndefined();

      // Second call succeeds
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: () => Promise.resolve({
          value: 'success_value',
          status: { code: 0 },
          serverTimestamp: new Date().toISOString()
        })
      });
      const successResult = await variableManager.readValue('TestVar');
      expect(successResult).toBe('success_value');
    });

    it('should maintain operation stability under repeated errors', async () => {
      variableManager.setErrorPolicy('default');
      
      // Simulate multiple sequential failures
      for (let i = 0; i < 5; i++) {
        mockConnection.apiRequest.mockRejectedValueOnce(new Error(`Error ${i}`));
        const result = await variableManager.readValue('TestVar');
        expect(result).toBeUndefined();
      }
      
      // Application should still be responsive
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: () => Promise.resolve({
          value: 'final_success',
          status: { code: 0 },
          serverTimestamp: new Date().toISOString()
        })
      });
      const finalResult = await variableManager.readValue('TestVar');
      expect(finalResult).toBe('final_success');
    });
  });

  describe('Smart Promise Wrapper Internal Behavior', () => {
    it('should wrap failing operations correctly for default policy', async () => {
      variableManager.setErrorPolicy('default');
      
      // Access private method for testing
      const smartPromiseMethod = (variableManager as any).createSmartPromise;
      if (smartPromiseMethod) {
        const result = await smartPromiseMethod.call(
          variableManager,
          () => Promise.reject(new Error('Wrapped error')),
          'TestVar'
        );
        expect(result).toBeUndefined();
      } else {
        // If method doesn't exist or isn't accessible, test through public API
        mockConnection.apiRequest.mockRejectedValue(new Error('Public API test'));
        const result = await variableManager.readValue('TestVar');
        expect(result).toBeUndefined();
      }
    });

    it('should preserve successful results through wrapper', async () => {
      variableManager.setErrorPolicy('default');
      
      // Access private method for testing
      const smartPromiseMethod = (variableManager as any).createSmartPromise;
      if (smartPromiseMethod) {
        const result = await smartPromiseMethod.call(
          variableManager,
          () => Promise.resolve('wrapped_success'),
          'TestVar'
        );
        expect(result).toBe('wrapped_success');
      } else {
        // If method doesn't exist, test through successful public API
        mockConnection.apiRequest.mockResolvedValue({
          json: () => Promise.resolve({
            value: 'public_success',
            status: { code: 0 },
            serverTimestamp: new Date().toISOString()
          })
        });
        const result = await variableManager.readValue('TestVar');
        expect(result).toBe('public_success');
      }
    });
  });
});