import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { VariableManager } from '../../src/variable-manager.js';
import type { OpcuaConnection } from '../../src/connection.js';
import type { SessionInfo } from '../../src/types.js';

describe('Array Element Writing', () => {
  let mockConnection: {
    apiRequest: Mock;
    getSessionInfo: Mock;
  };
  let variableManager: VariableManager;

  beforeEach(() => {
    mockConnection = {
      apiRequest: vi.fn(),
      getSessionInfo: vi.fn(() => ({
        sessionId: 'test-session',
        sessionTimeout: 60000,
        maxRequestMessageSize: 1000000,
        maxResponseMessageSize: 1000000,
        endpointUrl: 'test-url'
      } as SessionInfo))
    };
    
    variableManager = new VariableManager(mockConnection as unknown as OpcuaConnection);
  });

  describe('array element detection', () => {
    it('should try direct write first, then fallback when it fails', async () => {
      // Register a base array variable first
      variableManager.registerVariable('TestArray', 'ns=5;s=::TestArray');
      
      // Mock direct write attempt that fails
      mockConnection.apiRequest
        .mockRejectedValueOnce(new Error('Direct write not supported'))
        // Mock reading the current array for fallback
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ 
            value: [10, 20, 30],
            status: { code: 0 },
            serverTimestamp: new Date().toISOString()
          })
        })
        // Mock writing the modified array
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ status: { code: 0 } })
        });

      // Write to array element
      await variableManager.writeValue('TestArray[1]', 99);

      // Should have made 3 API calls: direct write attempt + read + write
      expect(mockConnection.apiRequest).toHaveBeenCalledTimes(3);
      
      // First call should be direct write attempt
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(1,
        expect.stringContaining('/nodes/'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value: 99 })
        })
      );
      
      // Second call should be a read (fallback)
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(2,
        expect.stringContaining('/nodes/'),
        expect.objectContaining({ method: 'GET' })
      );
      
      // Third call should be a write with modified array
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(3,
        expect.stringContaining('/nodes/'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value: [10, 99, 30] })
        })
      );
    });

    it('should succeed with direct write when supported', async () => {
      // Register a base array variable first
      variableManager.registerVariable('TestArray', 'ns=5;s=::TestArray');
      
      // Mock successful direct write
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: { code: 0 } })
      });

      // Write to array element
      await variableManager.writeValue('TestArray[1]', 99);

      // Should have made only 1 API call (direct write succeeded)
      expect(mockConnection.apiRequest).toHaveBeenCalledTimes(1);
      
      // Should be direct write attempt
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(1,
        expect.stringContaining('/nodes/'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value: 99 })
        })
      );
    });

    it('should handle nested variable array elements with fallback', async () => {
      // Register a nested variable
      variableManager.registerVariable('::demo:SensorData.readings', 'ns=5;s=::demo:SensorData.readings');
      
      // Mock direct write failure, then successful fallback
      mockConnection.apiRequest
        .mockRejectedValueOnce(new Error('Direct write not supported'))
        // Mock reading the current array for fallback
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ 
            value: [1.1, 2.2, 3.3],
            status: { code: 0 },
            serverTimestamp: new Date().toISOString()
          })
        })
        // Mock writing the modified array
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ status: { code: 0 } })
        });

      await variableManager.writeValue('::demo:SensorData.readings[0]', 5.5);

      expect(mockConnection.apiRequest).toHaveBeenCalledTimes(3);
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(3,
        expect.stringContaining('/nodes/'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value: [5.5, 2.2, 3.3] })
        })
      );
    });

    it('should throw error for unknown variables', async () => {
      await expect(variableManager.writeValue('UnknownArray[0]', 123))
        .rejects.toThrow("Failed to write array element 'UnknownArray[0]'");
    });

    it('should throw error for out of bounds index during fallback', async () => {
      variableManager.registerVariable('TestArray', 'ns=5;s=::TestArray');
      
      // Mock direct write failure, then read for bounds checking
      mockConnection.apiRequest
        .mockRejectedValueOnce(new Error('Direct write not supported'))
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ 
            value: [10, 20],
            status: { code: 0 },
            serverTimestamp: new Date().toISOString()
          })
        });

      await expect(variableManager.writeValue('TestArray[5]', 123))
        .rejects.toThrow('Array index 5 is out of bounds for array of length 2');
    });

    it('should throw error for non-array variable during fallback', async () => {
      variableManager.registerVariable('NotAnArray', 'ns=5;s=::NotAnArray');
      
      // Mock direct write failure, then read for type checking
      mockConnection.apiRequest
        .mockRejectedValueOnce(new Error('Direct write not supported'))
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ 
            value: "just a string",
            status: { code: 0 },
            serverTimestamp: new Date().toISOString()
          })
        });

      await expect(variableManager.writeValue('NotAnArray[0]', 123))
        .rejects.toThrow("Variable 'NotAnArray' is not an array (got string)");
    });
  });

  describe('complex value detection with new array handling', () => {
    const isComplexValue = (value: any): boolean => {
      // Access the private method for testing
      return (variableManager as any).isComplexValue(value);
    };

    it('should treat primitive arrays as simple values', () => {
      expect(isComplexValue([1, 2, 3])).toBe(false); // Simple array - not complex
      expect(isComplexValue(['a', 'b', 'c'])).toBe(false); // String array - not complex
      expect(isComplexValue([true, false])).toBe(false); // Boolean array - not complex
    });

    it('should treat arrays with objects as complex', () => {
      expect(isComplexValue([{ prop: 'value' }])).toBe(true); // Array with objects - complex
      expect(isComplexValue([1, { prop: 'value' }, 3])).toBe(true); // Mixed array - complex
    });

    it('should treat objects as complex', () => {
      expect(isComplexValue({ prop: 'value' })).toBe(true); // Object - complex
      expect(isComplexValue({ nested: { prop: 'value' } })).toBe(true); // Nested object - complex
    });

    it('should treat primitives as simple', () => {
      expect(isComplexValue(123)).toBe(false);
      expect(isComplexValue('string')).toBe(false);
      expect(isComplexValue(true)).toBe(false);
      expect(isComplexValue(null)).toBe(false);
    });
  });
});