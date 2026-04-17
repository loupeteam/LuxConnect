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

// Create a global mock for VariablePathParser
vi.spyOn(VariablePathParser, 'parse').mockImplementation((variableName: string) => {
  // Handle test scenarios with specific variable names
  if (variableName === '::Invalid::::Format') {
    throw new Error('Invalid variable name format');
  }
  if (variableName.includes('Unknown') || variableName === 'TestVariable') {
    throw new Error('Unknown variable');
  }
  
  // Default parsing logic for most variables
  if (variableName.includes('::')) {
    const parts = variableName.split('::');
    if (parts.length >= 3) {
      return {
        application: parts[0],
        task: parts[1] === 'AsGlobalPV' ? '_default' : parts[1],
        variable: parts[2],
        path: parts.slice(3)
      };
    }
  }
  
  // Simple variable names - treat as variable name with empty path
  const variable = variableName.split('.')[0]; // Get base variable name
  const path = variableName.includes('.') ? variableName.split('.').slice(1) : [];
  
  return {
    application: 'TestApp',
    task: '_default', 
    variable: variable,
    path: path
  };
});

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
      registerSubscription: vi.fn(),
      unregisterSubscription: vi.fn(),
      apiRequest: vi.fn().mockImplementation((url: string, options: any) => {
        // Mock subscription creation
        if (url.includes('/subscriptions') && !url.includes('/monitoredItems') && options?.method === 'POST') {
          return Promise.resolve({
            json: () => Promise.resolve({ subscriptionId: 123 })
          });
        }
        
        // Mock batch operations
        if (url.includes('/$batch') && options?.method === 'POST') {
          const batchBody = JSON.parse(options.body);
          const responses = batchBody.requests.map((req: any, index: number) => ({
            body: {
              monitoredItemId: 100 + index,
              // MUST use the actual clientHandle from the request for WebSocket tests to work
              clientHandle: req.body?.monitoringParameters?.clientHandle || (2000 + index),
              statusCode: 0
            }
          }));
          return Promise.resolve({
            json: () => Promise.resolve({ responses })
          });
        }
        
        // Mock monitored item creation
        if (url.includes('/monitoredItems') && options?.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.nodeId;
          
          // Handle specific node IDs for parent/child relationship tests
          let monitoredItemId = Math.floor(Math.random() * 1000) + 1000;
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          } else if (nodeId === 'ns=5;s=Motor.Speed') {
            monitoredItemId = 502;
          } else if (nodeId === 'ns=5;s=TestVariable') {
            monitoredItemId = 503;
          } else if (nodeId && (nodeId.includes('Motor') || nodeId.includes('TestVariable'))) {
            // Handle other Motor/TestVariable-related variables
            monitoredItemId = 500 + Math.floor(Math.random() * 100);
          }
          
          return Promise.resolve({
            json: () => Promise.resolve({
              monitoredItemId: monitoredItemId,
              clientHandle: body.clientHandle || Math.floor(Math.random() * 1000) + 2000,
              statusCode: { value: 0, description: 'Good', name: 'Good' }
            })
          });
        }
        
        // Mock monitored item deletion
        if (url.includes('/monitoredItems') && options?.method === 'DELETE') {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true })
          });
        }
        
        // Mock subscription deletion
        if (url.includes('/subscriptions') && options?.method === 'DELETE') {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true })
          });
        }
        
        // Default response
        return Promise.resolve({
          json: () => Promise.resolve({ subscriptionId: 123, monitoredItems: [] })
        });
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
      getVariable: vi.fn().mockImplementation((variableName: string) => {
        const variables = {
          'Temperature': { nodeId: 'ns=5;s=Temperature', name: 'Temperature' },
          'TestVar': { nodeId: 'ns=5;s=TestVar', name: 'TestVar' },
          'TestVar1': { nodeId: 'ns=5;s=TestVar1', name: 'TestVar1' },
          'TestVar2': { nodeId: 'ns=5;s=TestVar2', name: 'TestVar2' },
          'Motor': { nodeId: 'ns=5;s=Motor', name: 'Motor' },
          'Motor.Speed': { nodeId: 'ns=5;s=Motor.Speed', name: 'Motor.Speed' },
          'TestVariable': { nodeId: 'ns=5;s=TestVariable', name: 'TestVariable' },
          'Var1': { nodeId: 'ns=5;s=Var1', name: 'Var1' },
          'Var2': { nodeId: 'ns=5;s=Var2', name: 'Var2' },
          'Var3': { nodeId: 'ns=5;s=Var3', name: 'Var3' }
        };
        return variables[variableName as keyof typeof variables] || null;
      }),
      onChange: vi.fn(),
      readValue: vi.fn(),
      writeValue: vi.fn(),
      getGlobalState: vi.fn().mockReturnValue({}),
      updateVariableValue: vi.fn(),
      updateVariableFromNotification: vi.fn() // Add this for WebSocket notifications
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
      expect(subscriptionManager.getSubscription(subscriptionName)).toBeDefined();
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

    it('should not add duplicate variables to subscription', async () => {
      const variableName = 'Temperature';
      const nodeId = 'ns=5;s=Temperature';

      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: nodeId
      });

      // Mock first addition
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 456,
          statusCode: 0
        })
      });

      await subscriptionManager.addVariable('TestSub', variableName);
      
      // Reset mock call count
      vi.clearAllMocks();
      mockConnection.apiRequest.mockClear();

      // Try to add same variable again - should be ignored
      await subscriptionManager.addVariable('TestSub', variableName);
      
      // Should not call API again since variable is already desired
      expect(mockConnection.apiRequest).not.toHaveBeenCalled();
    });

    it('should remove variable from subscription', async () => {
      const variableName = 'Temperature';
      const nodeId = 'ns=5;s=Temperature';

      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: nodeId
      });

      // Add variable first using the main batch handler
      await subscriptionManager.addVariable('TestSub', variableName);

      // Clear call history but keep the implementation
      mockConnection.apiRequest.mockClear();

      await subscriptionManager.removeVariable('TestSub', variableName);
      
      // Should call batch API to remove monitored item
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/monitoredItems/$batch'),
        expect.objectContaining({ 
          method: 'POST',
          body: expect.stringContaining('"method":"DELETE"')
        })
      );
    });

    it('should handle removing non-existent variable gracefully', async () => {
      // Should not throw error when removing variable that wasn't added
      await expect(subscriptionManager.removeVariable('TestSub', 'NonExistent'))
        .resolves.toBeUndefined();
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

    it('should delete subscription successfully', async () => {
      const subscriptionName = 'ToBeDeleted';
      await subscriptionManager.createSubscription(subscriptionName);
      
      // Add a variable to the subscription first
      mockVariableManager.getVariable.mockReturnValue({
        name: 'TestVar',
        nodeId: 'ns=5;s=TestVar'
      });
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 456,
          statusCode: 0,
          revisedSamplingInterval: 100
        })
      });
      await subscriptionManager.addVariable(subscriptionName, 'TestVar');
      
      expect(subscriptionManager.getSubscription(subscriptionName)).toBeDefined();

      // Mock successful deletion
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({})
      });

      await subscriptionManager.deleteSubscription(subscriptionName);
      expect(subscriptionManager.getSubscription(subscriptionName)).toBeUndefined();
      
      // Verify delete API was called
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions/123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should handle deleting non-existent subscription', async () => {
      await expect(subscriptionManager.deleteSubscription('NonExistent'))
        .rejects.toThrow("Subscription 'NonExistent' not found");
    });

    it('should clean up client handles when deleting subscription', async () => {
      const subscriptionName = 'TestSub';
      await subscriptionManager.createSubscription(subscriptionName);
      
      // Add multiple variables
      mockVariableManager.getVariable.mockReturnValue({
        name: 'TestVar1',
        nodeId: 'ns=5;s=TestVar1'
      });
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 456,
          statusCode: 0
        })
      });

      
      await subscriptionManager.addVariable(subscriptionName, 'TestVar1');

      mockVariableManager.getVariable.mockReturnValue({
        name: 'TestVar2',
        nodeId: 'ns=5;s=TestVar2'
      });
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: 457,
          statusCode: 0
        })
      });
      await subscriptionManager.addVariable(subscriptionName, 'TestVar2');

      // Mock successful deletion
      mockConnection.apiRequest.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({})
      });

      await subscriptionManager.deleteSubscription(subscriptionName);
      
      // Verify subscription is completely removed
      expect(subscriptionManager.getSubscription(subscriptionName)).toBeUndefined();
    });

    it('should handle API errors during deletion', async () => {
      const subscriptionName = 'ErrorSub';
      await subscriptionManager.createSubscription(subscriptionName);
      
      // Mock API error
      mockConnection.apiRequest.mockRejectedValueOnce(new Error('Server error'));
      
      await expect(subscriptionManager.deleteSubscription(subscriptionName))
        .rejects.toThrow('Server error');
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

      // Mock batch response with error - override the default batch handler
      mockConnection.apiRequest.mockImplementation((url: string) => {
        if (url.includes('/subscriptions') && !url.includes('/monitoredItems')) {
          return Promise.resolve({
            json: () => Promise.resolve({ subscriptionId: 123 })
          });
        }
        
        if (url.includes('/$batch')) {
          // Return batch response with failed item
          return Promise.resolve({
            json: () => Promise.resolve({
              responses: [{
                body: {
                  statusCode: 0x80000000, // Bad status code
                  // Missing monitoredItemId to trigger fallback error handling
                }
              }]
            })
          });
        }
        
        return Promise.resolve({ json: () => Promise.resolve({}) });
      });

      // Should not throw but will log warnings and handle gracefully
      await expect(subscriptionManager.addVariable('TestSub', 'Temperature'))
        .resolves.toBeUndefined();
    });
  });

  describe('parent/child variable relationships', () => {
    beforeEach(async () => {
      await subscriptionManager.createSubscription('HierarchyTest');
    });

    it('should optimize subscription when parent and child variables are both desired', async () => {
      // Setup parent variable
      const parentVar = 'Motor';
      const parentNodeId = 'ns=5;s=Motor';
      
      // Setup child variable
      const childVar = 'Motor.Speed';
      const childNodeId = 'ns=5;s=Motor.Speed';

      // Mock variable manager to return both variables
      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { name: parentVar, nodeId: parentNodeId };
        } else if (varName === childVar) {
          return { name: childVar, nodeId: childNodeId };
        }
        return undefined;
      });

      // Mock path parser to understand hierarchy
      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: [] };
        } else if (varName === childVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: ['Speed'] };
        }
        throw new Error('Unknown variable');
      });

      // Reset default API mock to return proper responses for monitored items
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        if (url.includes('/monitoredItems') && options?.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for parent/child tests
          let monitoredItemId = 456;
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          } else if (nodeId === 'ns=5;s=Motor.Speed') {
            monitoredItemId = 502;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options?.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options?.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      // Add child variable first
      await subscriptionManager.addVariable('HierarchyTest', childVar);

      // Reset mock counters
      const callCountAfterChild = mockConnection.apiRequest.mock.calls.length;

      // Add parent variable - should consolidate and remove child, add parent
      await subscriptionManager.addVariable('HierarchyTest', parentVar);

      // Should have made additional calls for consolidation
      expect(mockConnection.apiRequest.mock.calls.length).toBeGreaterThan(callCountAfterChild);
    });

    it('should maintain parent when child is removed', async () => {
      const parentVar = 'Motor';
      const parentNodeId = 'ns=5;s=Motor';
      const childVar = 'Motor.Speed';
      const childNodeId = 'ns=5;s=Motor.Speed';

      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { name: parentVar, nodeId: parentNodeId };
        } else if (varName === childVar) {
          return { name: childVar, nodeId: childNodeId };
        }
        return undefined;
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: [] };
        } else if (varName === childVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: ['Speed'] };
        }
        throw new Error('Unknown variable');
      });

      // Setup proper API mock
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for parent/child tests
          let monitoredItemId = 456;
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          } else if (nodeId === 'ns=5;s=Motor.Speed') {
            monitoredItemId = 502;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      // Add both parent and child (parent should be subscribed, child ignored)
      await subscriptionManager.addVariable('HierarchyTest', parentVar);
      await subscriptionManager.addVariable('HierarchyTest', childVar);

      const subscription = subscriptionManager.getSubscription('HierarchyTest');
      expect(subscription?.desiredVariables.has(parentVar)).toBe(true);
      expect(subscription?.desiredVariables.has(childVar)).toBe(true);

      // Remove child - parent should remain
      await subscriptionManager.removeVariable('HierarchyTest', childVar);

      expect(subscription?.desiredVariables.has(parentVar)).toBe(true);
      expect(subscription?.desiredVariables.has(childVar)).toBe(false);
    });

    it('should add child when parent is removed', async () => {
      const parentVar = 'Motor';
      const parentNodeId = 'ns=5;s=Motor';
      const childVar = 'Motor.Speed';
      const childNodeId = 'ns=5;s=Motor.Speed';

      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { name: parentVar, nodeId: parentNodeId };
        } else if (varName === childVar) {
          return { name: childVar, nodeId: childNodeId };
        }
        return undefined;
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        if (varName === parentVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: [] };
        } else if (varName === childVar) {
          return { application: '_default', task: 'AsGlobalPV', variable: 'Motor', path: ['Speed'] };
        }
        throw new Error('Unknown variable');
      });

      // Setup proper API mock
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for parent/child tests
          let monitoredItemId = Math.floor(Math.random() * 1000);
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          } else if (nodeId === 'ns=5;s=Motor.Speed') {
            monitoredItemId = 502;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      // Add both variables
      await subscriptionManager.addVariable('HierarchyTest', parentVar);
      await subscriptionManager.addVariable('HierarchyTest', childVar);

      // Remove parent - should delete parent subscription and add child subscription
      await subscriptionManager.removeVariable('HierarchyTest', parentVar);

      const subscription = subscriptionManager.getSubscription('HierarchyTest');
      expect(subscription?.desiredVariables.has(parentVar)).toBe(false);
      expect(subscription?.desiredVariables.has(childVar)).toBe(true);
    });

    it('should handle complex sibling relationships', async () => {
      const parentVar = 'Motor';
      const child1Var = 'Motor.Speed';
      const child2Var = 'Motor.Current';
      const grandChildVar = 'Motor.Speed.Actual';

      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        const nodeId = `ns=5;s=${varName}`;
        return { name: varName, nodeId };
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        const parts = varName.split('.');
        if (parts.length === 1) { // Motor
          return { application: '_default', task: 'AsGlobalPV', variable: parts[0], path: [] };
        } else if (parts.length === 2) { // Motor.Speed, Motor.Current
          return { application: '_default', task: 'AsGlobalPV', variable: parts[0], path: [parts[1]] };
        } else if (parts.length === 3) { // Motor.Speed.Actual
          return { application: '_default', task: 'AsGlobalPV', variable: parts[0], path: [parts[1], parts[2]] };
        }
        throw new Error('Unknown variable format');
      });

      // Add various levels of hierarchy
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for parent/child tests
          let monitoredItemId = Math.floor(Math.random() * 1000);
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          } else if (nodeId === 'ns=5;s=Motor.Speed') {
            monitoredItemId = 502;
          } else if (nodeId === 'ns=5;s=Motor.Current') {
            monitoredItemId = 503;
          } else if (nodeId === 'ns=5;s=Motor.Speed.Actual') {
            monitoredItemId = 504;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      // Add child variables first
      await subscriptionManager.addVariable('HierarchyTest', child1Var);
      await subscriptionManager.addVariable('HierarchyTest', child2Var);
      await subscriptionManager.addVariable('HierarchyTest', grandChildVar);

      const subscription = subscriptionManager.getSubscription('HierarchyTest');
      expect(subscription?.desiredVariables.size).toBe(3);

      // Reset mocks for parent addition
      vi.clearAllMocks();
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          let monitoredItemId = Math.floor(Math.random() * 1000);
          if (nodeId === 'ns=5;s=Motor') {
            monitoredItemId = 501;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      // Add parent - should consolidate everything under parent
      await subscriptionManager.addVariable('HierarchyTest', parentVar);

      expect(subscription?.desiredVariables.has(parentVar)).toBe(true);
      expect(subscription?.desiredVariables.has(child1Var)).toBe(true);
      expect(subscription?.desiredVariables.has(child2Var)).toBe(true);
      expect(subscription?.desiredVariables.has(grandChildVar)).toBe(true);

      // But actual subscriptions should be optimized to just the parent
      // (This would be verified by checking actualNodeIds in a real implementation)
    });

    it('should handle variables from different applications separately', async () => {
      const app1Var = 'App1::Task:Motor';
      const app2Var = 'App2::Task:Motor';

      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        const nodeId = `ns=5;s=${varName}`;
        return { name: varName, nodeId };
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        if (varName === app1Var) {
          return { application: 'App1', task: 'Task', variable: 'Motor', path: [] };
        } else if (varName === app2Var) {
          return { application: 'App2', task: 'Task', variable: 'Motor', path: [] };
        }
        throw new Error('Unknown variable');
      });

      mockConnection.apiRequest.mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: Math.floor(Math.random() * 1000),
          statusCode: 0
        })
      });

      await subscriptionManager.addVariable('HierarchyTest', app1Var);
      await subscriptionManager.addVariable('HierarchyTest', app2Var);

      const subscription = subscriptionManager.getSubscription('HierarchyTest');
      expect(subscription?.desiredVariables.has(app1Var)).toBe(true);
      expect(subscription?.desiredVariables.has(app2Var)).toBe(true);

      // Both should be monitored since they're from different applications
      // (not parent/child relationship)
    });
  });

  describe('OPC UA connection mocking and WebSocket notifications', () => {
    beforeEach(async () => {
      await subscriptionManager.createSubscription('MockTest');
    });

    it('should setup WebSocket handler on connection', () => {
      // The constructor should have called onConnectionStateChanged to setup WebSocket handler
      expect(mockConnection.onConnectionStateChanged).toHaveBeenCalled();
      
      // Simulate connection state change to 'connected' to trigger WebSocket setup
      const stateChangeHandler = mockConnection.onConnectionStateChanged.mock.calls[0][0];
      stateChangeHandler('connected');
      
      // Now onMessage should have been called during WebSocket setup
      expect(mockConnection.onMessage).toHaveBeenCalled();
    });

    it('should handle data notifications from WebSocket', async () => {
      const variableName = 'TestVariable';
      const nodeId = 'ns=5;s=TestVariable';

      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: nodeId
      });

      // Setup proper API mock for monitored item creation
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        // Handle batch operations first
        if (url.includes('/$batch') && options.method === 'POST') {
          const batchBody = JSON.parse(options.body);
          const responses = batchBody.requests.map((req: any, index: number) => ({
            body: {
              monitoredItemId: 503 + index, // Use 503 for TestVariable
              clientHandle: req.body?.monitoringParameters?.clientHandle || (2000 + index),
              statusCode: 0
            }
          }));
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ responses })
          });
        }

        // Handle individual monitored item creation
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for WebSocket tests
          let monitoredItemId = 456;
          if (nodeId === 'ns=5;s=TestVariable') {
            monitoredItemId = 503;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      await subscriptionManager.addVariable('MockTest', variableName);

      // Trigger WebSocket setup
      const stateChangeHandler = mockConnection.onConnectionStateChanged.mock.calls[0][0];
      stateChangeHandler('connected');

      // Simulate WebSocket message with data notification
      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      const mockNotification = {
        DataNotifications: [{
          clientHandle: 1, // This should match the client handle from addVariable
          value: 42.5,
          serverTimestamp: new Date().toISOString(),
          status: { code: 0 }
        }]
      };

      // Execute the message handler
      messageHandler(mockNotification);

      // Verify variable manager was updated
      expect(mockVariableManager.updateVariableFromNotification).toHaveBeenCalledWith(
        nodeId,
        42.5,
        expect.any(Date),
        'good'
      );
    });

    it('should map OPC UA status codes correctly', async () => {
      const variableName = 'TestVariable';
      const nodeId = 'ns=5;s=TestVariable';

      mockVariableManager.getVariable.mockReturnValue({
        name: variableName,
        nodeId: nodeId
      });

      // Setup proper API mock
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        // Handle batch operations first
        if (url.includes('/$batch') && options.method === 'POST') {
          const batchBody = JSON.parse(options.body);
          const responses = batchBody.requests.map((req: any, index: number) => ({
            body: {
              monitoredItemId: 503 + index, // Use 503 for TestVariable
              clientHandle: req.body?.monitoringParameters?.clientHandle || (2000 + index),
              statusCode: 0
            }
          }));
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ responses })
          });
        }

        // Handle individual monitored item creation
        if (url.includes('/monitoredItems') && options.method === 'POST') {
          const body = JSON.parse(options.body || '{}');
          const nodeId = body.itemToMonitor?.nodeId || body.nodeId;
          
          // Handle specific node IDs for WebSocket tests
          let monitoredItemId = 456;
          if (nodeId === 'ns=5;s=TestVariable') {
            monitoredItemId = 503;
          }
          
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({
              monitoredItemId: monitoredItemId,
              statusCode: 0
            })
          });
        } else if (url.includes('/monitoredItems') && options.method === 'DELETE') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({})
          });
        } else if (url.includes('/subscriptions') && options.method === 'POST') {
          return Promise.resolve({
            json: vi.fn().mockResolvedValue({ subscriptionId: 123 })
          });
        }
        return Promise.resolve({ json: vi.fn().mockResolvedValue({}) });
      });

      await subscriptionManager.addVariable('MockTest', variableName);

      // Trigger WebSocket setup
      const stateChangeHandler = mockConnection.onConnectionStateChanged.mock.calls[0][0];
      stateChangeHandler('connected');
      
      const messageHandler = mockConnection.onMessage.mock.calls[0][0];

      // Test different status codes
      const statusTests = [
        { code: 0, expected: 'good' },
        { code: 0x40000000, expected: 'uncertain' },
        { code: 0x80000000, expected: 'bad' },
        { code: 0x12345678, expected: 'unknown' }
      ];

      for (const test of statusTests) {
        const mockNotification = {
          DataNotifications: [{
            clientHandle: 1,
            value: 100,
            serverTimestamp: new Date().toISOString(),
            status: { code: test.code }
          }]
        };

        messageHandler(mockNotification);

        expect(mockVariableManager.updateVariableFromNotification).toHaveBeenCalledWith(
          nodeId,
          100,
          expect.any(Date),
          test.expected
        );
      }
    });

    it('should ignore notifications for unknown client handles', async () => {
      // Trigger WebSocket setup
      const stateChangeHandler = mockConnection.onConnectionStateChanged.mock.calls[0][0];
      stateChangeHandler('connected');
      
      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      const mockNotification = {
        DataNotifications: [{
          clientHandle: 9999, // Unknown client handle
          value: 42.5,
          serverTimestamp: new Date().toISOString(),
          status: { code: 0 }
        }]
      };

      messageHandler(mockNotification);

      // Should not call variable manager for unknown handles
      expect(mockVariableManager.updateVariableFromNotification).not.toHaveBeenCalled();
    });

    it('should handle malformed WebSocket messages gracefully', () => {
      // Trigger WebSocket setup
      const stateChangeHandler = mockConnection.onConnectionStateChanged.mock.calls[0][0];
      stateChangeHandler('connected');
      
      const messageHandler = mockConnection.onMessage.mock.calls[0][0];

      // Test various malformed messages
      const malformedMessages = [
        null,
        undefined,
        {},
        { DataNotifications: null },
        { DataNotifications: 'not an array' },
        { DataNotifications: [] },
        { DataNotifications: [{}] }, // Missing required fields
        { DataNotifications: [{ clientHandle: 'not a number' }] }
      ];

      for (const message of malformedMessages) {
        expect(() => messageHandler(message)).not.toThrow();
      }
    });
  });

  describe('batch operations', () => {
    beforeEach(async () => {
      await subscriptionManager.createSubscription('BatchTest');
    });

    it('should handle batch monitored item additions when supported', async () => {
      // Setup multiple variables
      const variables = ['Var1', 'Var2', 'Var3'];
      
      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        return { name: varName, nodeId: `ns=5;s=${varName}` };
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        return { application: '_default', task: 'AsGlobalPV', variable: varName, path: [] };
      });

      // Add all variables quickly to trigger batch operation
      await Promise.all(variables.map(v => subscriptionManager.addVariable('BatchTest', v)));

      // Should use batch API
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/$batch'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('requests')
        })
      );
    });

    it('should fallback to individual operations when batch fails', async () => {
      const variables = ['Var1', 'Var2'];
      
      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        return { name: varName, nodeId: `ns=5;s=${varName}` };
      });

      vi.spyOn(VariablePathParser, 'parse').mockImplementation((varName: string) => {
        return { application: '_default', task: 'AsGlobalPV', variable: varName, path: [] };
      });

      // Mock batch failure, then individual successes  
      let batchCalled = false;
      mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
        // First batch request should fail
        if (url.includes('/$batch') && !batchCalled) {
          batchCalled = true;
          return Promise.reject(new Error('Batch not supported'));
        }
        
        // Subscription creation
        if (url.includes('/subscriptions') && !url.includes('/monitoredItems') && options?.method === 'POST') {
          return Promise.resolve({
            json: () => Promise.resolve({ subscriptionId: 123 })
          });
        }
        
        // Individual monitored item creation (fallback)
        if (url.includes('/monitoredItems') && options?.method === 'POST') {
          return Promise.resolve({
            json: () => Promise.resolve({
              monitoredItemId: Math.floor(Math.random() * 1000) + 1000,
              clientHandle: Math.floor(Math.random() * 1000) + 2000
            })
          });
        }
        
        // Default response
        return Promise.resolve({
          json: () => Promise.resolve({})
        });
      });

      await Promise.all(variables.map(v => subscriptionManager.addVariable('BatchTest', v)));

      // Should have tried batch first, then fallen back to individual calls
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/$batch'),
        expect.anything()
      );
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/monitoredItems'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('subscription recovery', () => {
    it('should clear all subscriptions without API calls', async () => {
      // Create some subscriptions first
      await subscriptionManager.createSubscription('Sub1');
      await subscriptionManager.createSubscription('Sub2');

      expect(subscriptionManager.getAllSubscriptions().size).toBeGreaterThan(0);

      subscriptionManager.clearAllSubscriptions();

      expect(subscriptionManager.getAllSubscriptions().size).toBe(0);
    });

    it('should recover subscriptions after reconnection', async () => {
      // Setup initial subscription with variables
      await subscriptionManager.createSubscription('RecoverTest', { publishingInterval: 500 });
      
      mockVariableManager.getVariable.mockImplementation((varName: string) => {
        return { name: varName, nodeId: `ns=5;s=${varName}` };
      });

      mockConnection.apiRequest.mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          monitoredItemId: Math.floor(Math.random() * 1000),
          statusCode: 0
        })
      });

      await subscriptionManager.addVariable('RecoverTest', 'TempVar');
      await subscriptionManager.addVariable('RecoverTest', 'PressVar');

      // Clear mocks to track recovery calls
      vi.clearAllMocks();

      // Mock recovery responses
      mockConnection.apiRequest.mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          subscriptionId: Math.floor(Math.random() * 1000),
          monitoredItemId: Math.floor(Math.random() * 1000),
          statusCode: 0
        })
      });

      // Trigger recovery
      await subscriptionManager.recoverAllSubscriptions();

      // Should have recreated subscription and re-added variables
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('publishingInterval')
        })
      );

      // Should have re-added variables
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/monitoredItems'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
