import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubscriptionManager } from '../../src/subscription-manager.js';

// Create simplified mocks
const mockConnection = {
  isConnected: vi.fn(() => true),
  apiRequest: vi.fn(),
  setWebSocketHandler: vi.fn(),
  onConnectionStateChanged: vi.fn(),
  getSessionInfo: vi.fn(() => ({ sessionId: 'test-session-123' })),
  registerSubscription: vi.fn(),
  unregisterSubscription: vi.fn(),
};

const mockVariableManager = {
  getNodeId: vi.fn((variableName: string) => {
    const nodeIds = {
      'Temperature': 'ns=5;s=Temperature',
      'Motor': 'ns=5;s=Motor',
      'Motor.Speed': 'ns=5;s=Motor.Speed',
      'TestVar': 'ns=5;s=TestVar',
      'Var1': 'ns=5;s=Var1',
      'Var2': 'ns=5;s=Var2',
    };
    return nodeIds[variableName as keyof typeof nodeIds] || null;
  }),
  getVariableName: vi.fn((nodeId: string) => {
    const variableNames = {
      'ns=5;s=Temperature': 'Temperature',
      'ns=5;s=Motor': 'Motor',
      'ns=5;s=Motor.Speed': 'Motor.Speed',
      'ns=5;s=TestVar': 'TestVar',
      'ns=5;s=Var1': 'Var1',
      'ns=5;s=Var2': 'Var2',
    };
    return variableNames[nodeId as keyof typeof variableNames] || null;
  }),
  getVariable: vi.fn((variableName: string) => {
    const variables = {
      'Temperature': { nodeId: 'ns=5;s=Temperature', name: 'Temperature' },
      'Motor': { nodeId: 'ns=5;s=Motor', name: 'Motor' },
      'Motor.Speed': { nodeId: 'ns=5;s=Motor.Speed', name: 'Motor.Speed' },
      'TestVar': { nodeId: 'ns=5;s=TestVar', name: 'TestVar' },
      'Var1': { nodeId: 'ns=5;s=Var1', name: 'Var1' },
      'Var2': { nodeId: 'ns=5;s=Var2', name: 'Var2' },
    };
    return variables[variableName as keyof typeof variables] || null;
  }),
};

const mockHierarchy = {
  getHierarchyPath: vi.fn(),
};

const mockPathParser = {
  parse: vi.fn(),
};

describe('SubscriptionManager - Simple Tests', () => {
  let subscriptionManager: SubscriptionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up API responses for subscription creation
    mockConnection.apiRequest.mockImplementation((url: string, options: any) => {
      // Handle batch operations for monitored items
      if (url.includes('/monitoredItems/$batch') && options?.method === 'POST') {
        const body = JSON.parse(options.body);
        const responses = body.requests.map((req: any, index: number) => {
          if (req.method === 'POST') {
            return {
              id: req.id,
              body: {
                monitoredItemId: 456 + index,
                clientHandle: 789 + index
              }
            };
          } else if (req.method === 'DELETE') {
            return {
              id: req.id,
              body: { success: true }
            };
          }
          return { id: req.id, body: {} };
        });
        
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({
            responses: responses
          })
        });
      }
      
      // Individual monitored item operations (fallback - should not be used anymore)
      if (url.includes('/monitoredItems') && !url.includes('$batch') && options?.method === 'POST') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({
            monitoredItemId: 456,
            clientHandle: 789
          })
        });
      }
      
      if (url.includes('/monitoredItems') && !url.includes('$batch') && options?.method === 'DELETE') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ success: true })
        });
      }
      
      if (url.includes('/subscriptions') && options?.method === 'DELETE') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ success: true })
        });
      }

      if (url.includes('/subscriptions') && options?.method === 'POST') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({
            subscriptionId: 123
          })
        });
      }
      
      return Promise.resolve({
        json: vi.fn().mockResolvedValue({})
      });
    });

    mockHierarchy.getHierarchyPath.mockReturnValue('/Path/To/Variable');
    mockPathParser.parse.mockReturnValue({
      application: 'TestApp',
      task: 'TestTask',
      variable: 'TestVar'
    });

    subscriptionManager = new SubscriptionManager(
      mockConnection as any,
      mockVariableManager as any
    );
  });

  describe('Basic Functionality', () => {
    it('should create a subscription successfully', async () => {
      await subscriptionManager.createSubscription('TestSub');
      
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should add a variable to subscription', async () => {
      await subscriptionManager.createSubscription('TestSub');
      await subscriptionManager.addVariable('TestSub', 'Temperature');
      
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/monitoredItems'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should remove a variable from subscription', async () => {
      await subscriptionManager.createSubscription('TestSub');
      await subscriptionManager.addVariable('TestSub', 'Temperature');
      await subscriptionManager.removeVariable('TestSub', 'Temperature');
      
      // Should call batch DELETE on monitored items
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/monitoredItems/$batch'),
        expect.objectContaining({ 
          method: 'POST',
          body: expect.stringContaining('"method":"DELETE"')
        })
      );
    });

    it('should delete a subscription', async () => {
      await subscriptionManager.createSubscription('TestSub');
      await subscriptionManager.deleteSubscription('TestSub');
      
      expect(mockConnection.apiRequest).toHaveBeenCalledWith(
        expect.stringContaining('/subscriptions/123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Parent/Child Relationships', () => {
    it('should handle parent and child variables', async () => {
      // Mock hierarchy to show Motor.Speed is child of Motor
      mockHierarchy.getHierarchyPath.mockImplementation((variableName: string) => {
        if (variableName === 'Motor.Speed') return '/Motor/Speed';
        if (variableName === 'Motor') return '/Motor';
        return '/Other/Path';
      });

      await subscriptionManager.createSubscription('TestSub');
      
      // Add parent first
      await subscriptionManager.addVariable('TestSub', 'Motor');
      
      // Add child - should optimize to just keep parent
      await subscriptionManager.addVariable('TestSub', 'Motor.Speed');
      
      // Should only have one monitored item (the parent)
      const info = subscriptionManager.getSubscription('TestSub');
      expect(info?.monitoredItems.size).toBe(1);
      expect(info?.monitoredItems.get(456)?.nodeId).toBe('ns=5;s=Motor');
    });

    it('should add child when parent is removed', async () => {
      mockHierarchy.getHierarchyPath.mockImplementation((variableName: string) => {
        if (variableName === 'Motor.Speed') return '/Motor/Speed';
        if (variableName === 'Motor') return '/Motor';
        return '/Other/Path';
      });

      await subscriptionManager.createSubscription('TestSub');
      
      // Add both parent and child
      await subscriptionManager.addVariable('TestSub', 'Motor');
      await subscriptionManager.addVariable('TestSub', 'Motor.Speed');
      
      // Remove parent - should add child back
      await subscriptionManager.removeVariable('TestSub', 'Motor');
      
      const info = subscriptionManager.getSubscription('TestSub');
      expect(info?.monitoredItems.size).toBe(1);
      expect(info?.monitoredItems.get(456)?.nodeId).toBe('ns=5;s=Motor.Speed');
    });
  });

  describe('Utility Methods', () => {
    it('should expose getHierarchyPathFromVariableName as public', () => {
      const result = subscriptionManager.getHierarchyPathFromVariableName('Temperature');
      expect(result).toBeDefined();
    });

    it('should expose findVariableNameByNodeId as public', () => {
      const mockHierarchy = new Map([
        ['Temperature', { nodeId: 'ns=5;s=Temperature', path: [] }]
      ]);
      const result = subscriptionManager.findVariableNameByNodeId('ns=5;s=Temperature', mockHierarchy);
      expect(result).toBe('Temperature');
    });
  });
});