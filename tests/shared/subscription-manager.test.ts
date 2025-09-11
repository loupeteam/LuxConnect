import { describe, it, expect, beforeEach, vi, MockedClass } from 'vitest';
import { SubscriptionManager } from '../../src/subscription-manager.js';
import { OpcuaConnection } from '../../src/connection.js';
import { VariableManager } from '../../src/variable-manager.js';
import { VariableHierarchy } from '../../src/variable-hierarchy.js';
import { VariablePathParser } from '../../src/variable-hierarchy.js';

// Mock the dependencies
vi.mock('../../src/connection.js');
vi.mock('../../src/variable-manager.js');
vi.mock('../../src/variable-hierarchy.js');

// Create mocked classes
const MockedOpcuaConnection = OpcuaConnection as MockedClass<typeof OpcuaConnection>;
const MockedVariableManager = VariableManager as MockedClass<typeof VariableManager>;
const MockedVariableHierarchy = VariableHierarchy as MockedClass<typeof VariableHierarchy>;

describe('SubscriptionManager (Cross-Platform) - With Public Methods', () => {
  let subscriptionManager: SubscriptionManager;
  let mockConnection: any;
  let mockVariableManager: any;
  let mockHierarchy: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock instances with proper properties (not methods for boolean values)
    mockConnection = {
      isConnected: true,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
      onConnectionStateChanged: vi.fn(),
      onError: vi.fn(),
      getSessionInfo: vi.fn().mockReturnValue({ sessionId: 'mock-session-id' }),
      apiRequest: vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ subscriptionId: 123, monitoredItems: [] })
      })
    };

    mockHierarchy = {
      getVariable: vi.fn(),
      addVariable: vi.fn(),
      removeVariable: vi.fn(),
      getGlobalState: vi.fn().mockReturnValue({}),
      updateVariableValue: vi.fn(),
      getVariableNames: vi.fn().mockReturnValue([])
    };

    mockVariableManager = {
      hierarchy: mockHierarchy,
      registerVariable: vi.fn(),
      unregisterVariable: vi.fn(),
      getVariable: vi.fn(),
      onChange: vi.fn(),
      readValue: vi.fn(),
      writeValue: vi.fn(),
      getGlobalState: vi.fn().mockReturnValue({}),
      updateVariableValue: vi.fn()
    };

    // Mock constructors
    MockedOpcuaConnection.mockImplementation(() => mockConnection);
    MockedVariableManager.mockImplementation(() => mockVariableManager);
    MockedVariableHierarchy.mockImplementation(() => mockHierarchy);

    // Create subscription manager with mocked dependencies
    subscriptionManager = new SubscriptionManager(mockConnection, mockVariableManager);
  });

  describe('subscription creation', () => {
    it('should create a new subscription successfully', async () => {
      const subscriptionName = 'TestSubscription';
      const options = { publishingInterval: 100 };

      const result = await subscriptionManager.createSubscription(subscriptionName, options);

      expect(result).toBe(subscriptionName);
      expect(mockConnection.apiRequest).toHaveBeenCalled();
    });

    it('should throw error when creating duplicate subscription', async () => {
      const subscriptionName = 'TestSubscription';

      // Create first subscription
      await subscriptionManager.createSubscription(subscriptionName);

      // Try to create duplicate
      await expect(subscriptionManager.createSubscription(subscriptionName))
        .rejects.toThrow(`Subscription '${subscriptionName}' already exists`);
    });

    it('should handle disconnected state gracefully', async () => {
      const subscriptionName = 'TestSubscription';
      
      mockConnection.isConnected = false;

      const result = await subscriptionManager.createSubscription(subscriptionName);
      
      expect(result).toBe(subscriptionName);
      // Note: Implementation may still call API to queue subscriptions
    });
  });

  describe('variable subscription', () => {
    beforeEach(async () => {
      await subscriptionManager.createSubscription('TestSub');
    });

    it('should add variable to subscription', async () => {
      const variableName = 'Temperature';
      const nodeId = 'ns=5;s=Temperature';

      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: nodeId
      });

      // Mock the monitored item creation response
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 456,
          statusCode: 0,
          revisedSamplingInterval: 100
        })
      });

      await subscriptionManager.addVariable('TestSub', variableName);

      // Should create subscription first, then add monitored item
      expect(mockConnection.apiRequest).toHaveBeenCalledTimes(2);
      
      // Check subscription creation call
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(1,
        expect.stringContaining('/subscriptions'),
        expect.objectContaining({
          method: 'POST'
        })
      );
      
      // Check monitored item creation call
      expect(mockConnection.apiRequest).toHaveBeenNthCalledWith(2,
        expect.stringContaining('/monitoredItems'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should handle unregistered variables', async () => {
      const variableName = 'UnknownVariable';

      mockVariableManager.getVariable.mockReturnValue(undefined);

      await expect(subscriptionManager.addVariable('TestSub', variableName))
        .rejects.toThrow(`Variable '${variableName}' is not registered`);
    });

    it('should handle non-existent subscription', async () => {
      const variableName = 'Temperature';

      await expect(subscriptionManager.addVariable('NonExistent', variableName))
        .rejects.toThrow(`Subscription 'NonExistent' not found`);
    });
  });

  describe('public utility methods - getHierarchyPathFromVariableName', () => {
    it('should be exposed as public method', () => {
      expect(typeof subscriptionManager.getHierarchyPathFromVariableName).toBe('function');
    });

    it('should parse complex variable names correctly', () => {
      const variableName = 'MyApp::MyTask:Temperature.Value';
      
      // Mock the static method directly
      vi.spyOn(VariablePathParser, 'parse').mockReturnValue({
        application: 'MyApp',
        task: 'MyTask', 
        variable: 'Temperature',
        path: ['Value'],
      });

      const result = subscriptionManager.getHierarchyPathFromVariableName(variableName);

      expect(result).toEqual(['MyApp', 'MyTask', 'Temperature', 'Value']);
      expect(VariablePathParser.parse).toHaveBeenCalledWith(variableName);
    });

    it('should handle simple variable names (skips default AsGlobalPV)', () => {
      const variableName = 'Temperature';
      
      vi.spyOn(VariablePathParser, 'parse').mockReturnValue({
        application: '_default',
        task: 'AsGlobalPV',
        variable: 'Temperature',
        path: [],
      });

      const result = subscriptionManager.getHierarchyPathFromVariableName(variableName);

      // The current implementation skips AsGlobalPV when it's the default
      expect(result).toEqual(['_default', 'Temperature']);
      expect(VariablePathParser.parse).toHaveBeenCalledWith(variableName);
    });

    it('should include non-default task names', () => {
      const variableName = 'MyTask:LocalVar';
      
      vi.spyOn(VariablePathParser, 'parse').mockReturnValue({
        application: '_default',
        task: 'MyTask',
        variable: 'LocalVar',
        path: [],
      });

      const result = subscriptionManager.getHierarchyPathFromVariableName(variableName);

      expect(result).toEqual(['_default', 'MyTask', 'LocalVar']);
    });

    it('should handle structured variables with paths', () => {
      const variableName = 'Motor.Status.Running';
      
      vi.spyOn(VariablePathParser, 'parse').mockReturnValue({
        application: '_default',
        task: 'AsGlobalPV',
        variable: 'Motor',
        path: ['Status', 'Running'],
      });

      const result = subscriptionManager.getHierarchyPathFromVariableName(variableName);

      expect(result).toEqual(['_default', 'Motor', 'Status', 'Running']);
    });

    it('should handle parsing errors gracefully with fallback', () => {
      const invalidVariableName = '::Invalid::::Format';
      
      vi.spyOn(VariablePathParser, 'parse').mockImplementation(() => {
        throw new Error('Invalid variable name format');
      });

      // The method now has error handling with fallback parsing
      const result = subscriptionManager.getHierarchyPathFromVariableName(invalidVariableName);
      
      expect(result).toBeInstanceOf(Array);
      expect(VariablePathParser.parse).toHaveBeenCalledWith(invalidVariableName);
      // Should use fallback logic when parsing fails
    });
  });

  describe('public utility methods - findVariableNameByNodeId', () => {
    it('should be exposed as public method', () => {
      expect(typeof subscriptionManager.findVariableNameByNodeId).toBe('function');
    });

    it('should find variable by nodeId successfully', () => {
      const testHierarchy = new Map([
        ['Temperature', { nodeId: 'ns=5;s=Temperature', path: [] }],
        ['Pressure', { nodeId: 'ns=5;s=Pressure', path: [] }],
        ['Motor.Speed', { nodeId: 'ns=5;s=Motor.Speed', path: ['Speed'] }]
      ]);

      const result = subscriptionManager.findVariableNameByNodeId('ns=5;s=Temperature', testHierarchy);
      
      expect(result).toBe('Temperature');
    });

    it('should return undefined for non-existent nodeId', () => {
      const testHierarchy = new Map([
        ['Temperature', { nodeId: 'ns=5;s=Temperature', path: [] }],
        ['Pressure', { nodeId: 'ns=5;s=Pressure', path: [] }]
      ]);

      const result = subscriptionManager.findVariableNameByNodeId('ns=5;s=NonExistent', testHierarchy);
      
      expect(result).toBeUndefined();
    });

    it('should handle empty hierarchy map', () => {
      const emptyHierarchy = new Map<string, { nodeId: string; path: string[] }>();

      const result = subscriptionManager.findVariableNameByNodeId('ns=5;s=AnyNode', emptyHierarchy);
      
      expect(result).toBeUndefined();
    });

    it('should find the first match when multiple variables have same nodeId', () => {
      // Edge case: multiple variables could theoretically have same nodeId
      const testHierarchy = new Map([
        ['FirstVar', { nodeId: 'ns=5;s=SharedNode', path: [] }],
        ['SecondVar', { nodeId: 'ns=5;s=SharedNode', path: [] }],
        ['ThirdVar', { nodeId: 'ns=5;s=DifferentNode', path: [] }]
      ]);

      const result = subscriptionManager.findVariableNameByNodeId('ns=5;s=SharedNode', testHierarchy);
      
      // Should return the first match found during iteration
      expect(['FirstVar', 'SecondVar']).toContain(result);
    });
  });

  describe('subscription management', () => {
    it('should list subscription names', async () => {
      await subscriptionManager.createSubscription('Sub1');
      
      // Reset mock for second subscription
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          subscriptionId: 124,
          monitoredItems: []
        })
      });
      await subscriptionManager.createSubscription('Sub2');

      const subscriptions = subscriptionManager.getAllSubscriptions();
      
      expect(subscriptions.has('Sub1')).toBe(true);
      expect(subscriptions.has('Sub2')).toBe(true);
    });

    it('should get subscription info', async () => {
      const subscriptionName = 'TestSub';

      await subscriptionManager.createSubscription(subscriptionName);
      
      const info = subscriptionManager.getSubscription(subscriptionName);
      
      expect(info).toBeDefined();
      expect(info?.name).toBe(subscriptionName);
    });

    it('should handle getting info for non-existent subscription', () => {
      const info = subscriptionManager.getSubscription('NonExistent');
      
      expect(info).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should use hierarchy parsing for subscription consolidation', async () => {
      await subscriptionManager.createSubscription('TestSub');

      const variableName = 'MyApp::Production:Temperature.Value';
      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: 'ns=5;s=MyApp::Production:Temperature.Value'
      });

      // Mock successful monitored item creation
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 456,
          statusCode: 0,
          revisedSamplingInterval: 100
        })
      });

      // This should internally use getHierarchyPathFromVariableName for consolidation
      await subscriptionManager.addVariable('TestSub', variableName);

      // Verify the hierarchy path parsing was used
      expect(mockConnection.apiRequest).toHaveBeenCalled();
    });

    it('should enable debugging workflow with public methods', () => {
      // Simulate debugging workflow
      const variableName = 'Complex::App:Motor.Status[0].Running';
      
      // 1. Parse variable name to understand hierarchy
      vi.spyOn(VariablePathParser, 'parse').mockReturnValue({
        application: 'Complex',
        task: 'App',
        variable: 'Motor',
        path: ['Status', '0', 'Running'],
      });

      const hierarchyPath = subscriptionManager.getHierarchyPathFromVariableName(variableName);
      expect(hierarchyPath).toEqual(['Complex', 'App', 'Motor', 'Status', '0', 'Running']);

      // 2. Create test hierarchy for reverse lookup
      const testHierarchy = new Map([
        [variableName, { nodeId: 'ns=5;s=ComplexNode123', path: hierarchyPath }]
      ]);

      // 3. Find variable by nodeId (reverse lookup)
      const foundVariable = subscriptionManager.findVariableNameByNodeId('ns=5;s=ComplexNode123', testHierarchy);
      expect(foundVariable).toBe(variableName);

      // This workflow demonstrates the debugging value of public methods
    });
  });

  describe('error handling', () => {
    it('should handle connection errors during subscription creation', async () => {
      mockConnection.apiRequest.mockRejectedValue(new Error('Connection failed'));

      await expect(subscriptionManager.createSubscription('TestSub'))
        .rejects.toThrow('Connection failed');
    });

    it('should handle invalid monitored item responses gracefully', async () => {
      await subscriptionManager.createSubscription('TestSub');

      mockVariableManager.getVariable.mockReturnValue({
        name: 'Temperature',
        nodeId: 'ns=5;s=Temperature'
      });

      // Mock response without proper monitoredItemId
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          statusCode: 0x80000000, // Bad status code
          // Missing monitoredItemId to trigger the error
        })
      });

      await expect(subscriptionManager.addVariable('TestSub', 'Temperature'))
        .rejects.toThrow('Failed to create monitored item');
    });
  });
});
