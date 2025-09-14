import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VariableManager } from '../../src/variable-manager.js';
import { OpcuaConnection } from '../../src/connection.js';

describe('Complex Value Writing', () => {
  let variableManager: VariableManager;
  let mockConnection: OpcuaConnection;

  beforeEach(() => {
    mockConnection = {
      getSessionInfo: vi.fn().mockReturnValue({ sessionId: 'test-session' }),
      apiRequest: vi.fn()
    } as any;
    
    variableManager = new VariableManager(mockConnection);
  });

  describe('complex object detection', () => {
    it('should detect simple values as not complex', () => {
      const isComplex = (variableManager as any).isComplexValue;
      
      expect(isComplex(42)).toBe(false);
      expect(isComplex('string')).toBe(false);
      expect(isComplex(true)).toBe(false);
      expect(isComplex(null)).toBe(false);
      expect(isComplex([1, 2, 3])).toBe(false); // Primitive arrays are now handled as simple values using read-modify-write
    });

    it('should detect complex objects', () => {
      const isComplex = (variableManager as any).isComplexValue;
      
      expect(isComplex({ prop: 'value' })).toBe(true);
      expect(isComplex({ nested: { prop: 'value' } })).toBe(true);
      expect(isComplex([{ prop: 'value' }])).toBe(true); // Array with objects
    });
  });

  describe('value flattening', () => {
    it('should flatten simple object', () => {
      const result = (variableManager as any).flattenValue('', { 
        temperature: 25.5, 
        status: 'running' 
      });
      
      expect(result).toEqual([
        { path: '.temperature', value: 25.5 },
        { path: '.status', value: 'running' }
      ]);
    });

    it('should flatten nested object', () => {
      const result = (variableManager as any).flattenValue('', {
        sensor: {
          temperature: 25.5,
          humidity: 60.2
        },
        status: 'active'
      });
      
      expect(result).toEqual([
        { path: '.sensor.temperature', value: 25.5 },
        { path: '.sensor.humidity', value: 60.2 },
        { path: '.status', value: 'active' }
      ]);
    });

    it('should flatten array values', () => {
      const result = (variableManager as any).flattenValue('', {
        readings: [10.1, 20.2, 30.3]
      });
      
      expect(result).toEqual([
        { path: '.readings[0]', value: 10.1 },
        { path: '.readings[1]', value: 20.2 },
        { path: '.readings[2]', value: 30.3 }
      ]);
    });

    it('should flatten complex mixed structure', () => {
      const result = (variableManager as any).flattenValue('', {
        config: {
          settings: {
            values: [1.1, 2.2]
          },
          enabled: true
        }
      });
      
      expect(result).toEqual([
        { path: '.config.settings.values[0]', value: 1.1 },
        { path: '.config.settings.values[1]', value: 2.2 },
        { path: '.config.enabled', value: true }
      ]);
    });
  });

  describe('writeValue integration', () => {
    beforeEach(() => {
      // Mock successful API responses
      (mockConnection.apiRequest as any).mockResolvedValue({
        json: () => Promise.resolve({ status: { code: 0 } })
      });
    });

    it('should handle simple values directly', async () => {
      // Register a simple variable
      variableManager.registerVariable('Temperature', 'ns=5;s=::AsGlobalPV:Temperature');
      
      await variableManager.writeValue('Temperature', 25.5);
      
      // Should make a single API call
      expect(mockConnection.apiRequest).toHaveBeenCalledTimes(1);
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/nodes/'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ value: 25.5 })
        })
      );
    });

    it('should attempt batch write for complex values', async () => {
      // Register base variable
      variableManager.registerVariable('SensorData', 'ns=5;s=::AsGlobalPV:SensorData');
      
      const complexValue = {
        temperature: 25.5,
        humidity: 60.0
      };

      try {
        await variableManager.writeValue('SensorData', complexValue);
      } catch (error: any) {
        // Expected to fail due to mocked API, but should attempt batch write
        expect(error.message).toContain('failed');
      }
      
      // Should try batch write first
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/nodes/$batch'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should use correct mapp Connect batch format', async () => {
      // Mock successful batch response
      (mockConnection.apiRequest as any).mockResolvedValue({
        json: () => Promise.resolve({ 
          responses: [
            { status: 200, body: { status: { code: 0 } } },
            { status: 200, body: { status: { code: 0 } } }
          ]
        })
      });

      // Register base variable
      variableManager.registerVariable('TestVar', 'ns=5;s=::TestVar');
      
      const complexValue = {
        a: 1,
        b: 2
      };

      await variableManager.writeValue('TestVar', complexValue);
      
      // Verify correct batch format was used
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/opcua/sessions/test-session/nodes/$batch'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"requests"')
        })
      );

      // Verify the batch payload structure
      const batchCall = (mockConnection.apiRequest as any).mock.calls.find((call: any) => 
        call[0].includes('$batch')
      );
      
      if (batchCall) {
        const payload = JSON.parse(batchCall[1].body);
        expect(payload).toHaveProperty('requests');
        expect(payload.requests).toBeInstanceOf(Array);
        expect(payload.requests[0]).toHaveProperty('id');
        expect(payload.requests[0]).toHaveProperty('method', 'PUT');
        expect(payload.requests[0]).toHaveProperty('url');
        expect(payload.requests[0]).toHaveProperty('body');
        expect(payload.requests[0]).toHaveProperty('headers');
      }
    });
  });
});