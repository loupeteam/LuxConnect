import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SubscriptionManager } from '../../src/subscription-manager.js';

// Create test-focused mocks
const mockConnection = {
  isConnected: vi.fn(() => true),
  apiRequest: vi.fn(),
  setWebSocketHandler: vi.fn(),
  onConnectionStateChanged: vi.fn(),
  getSessionInfo: vi.fn(() => ({ sessionId: 'test-session-123' })),
};

const mockVariableManager = {
  getVariable: vi.fn((variableName: string) => {
    const variables = {
      'Temperature': { nodeId: 'ns=5;s=Temperature', name: 'Temperature' },
      'Motor': { nodeId: 'ns=5;s=Motor', name: 'Motor' },
      'Motor.Speed': { nodeId: 'ns=5;s=Motor.Speed', name: 'Motor.Speed' },
    };
    return variables[variableName as keyof typeof variables] || null;
  }),
};

describe('Subscription Consolidation Logic', () => {
  let subscriptionManager: SubscriptionManager;
  let mockApiRequest: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockApiRequest = mockConnection.apiRequest;
    
    // Mock subscription creation
    mockApiRequest.mockImplementation((url: string, options: any) => {
      if (url.includes('/subscriptions') && !url.includes('/monitoredItems') && options?.method === 'POST') {
        return Promise.resolve({
          json: () => Promise.resolve({ subscriptionId: 123 })
        });
      }
      
      if (url.includes('/monitoredItems') && options?.method === 'POST') {
        const result = {
          monitoredItemId: Math.floor(Math.random() * 1000) + 1000,
          clientHandle: Math.floor(Math.random() * 1000) + 2000
        };
        return Promise.resolve({
          json: () => Promise.resolve(result)
        });
      }
      
      if (url.includes('/monitoredItems') && options?.method === 'DELETE') {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true })
        });
      }
      
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    subscriptionManager = new SubscriptionManager(
      mockConnection as any,
      mockVariableManager as any
    );
  });

  it('should track monitored items correctly using monitoredItems map', async () => {
    // Create subscription
    await subscriptionManager.createSubscription('TestSub');
    
    // Add a variable
    await subscriptionManager.addVariable('TestSub', 'Temperature');
    
    // Check that we have the monitored item
    const subscription = subscriptionManager.getSubscription('TestSub');
    expect(subscription?.monitoredItems.size).toBe(1);
    
    // Remove the variable
    await subscriptionManager.removeVariable('TestSub', 'Temperature');
    
    // Check that the monitored item is removed
    expect(subscription?.monitoredItems.size).toBe(0);
    
    // Verify DELETE was called
    expect(mockApiRequest).toHaveBeenCalledWith(
      expect.stringContaining('/monitoredItems/'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('should calculate toRemove correctly from monitoredItems', async () => {
    // Create subscription
    await subscriptionManager.createSubscription('TestSub');
    
    // Add two variables
    await subscriptionManager.addVariable('TestSub', 'Temperature');
    await subscriptionManager.addVariable('TestSub', 'Motor');
    
    const subscription = subscriptionManager.getSubscription('TestSub');
    expect(subscription?.monitoredItems.size).toBe(2);
    
    // Now remove both variables
    await subscriptionManager.removeVariable('TestSub', 'Temperature');
    await subscriptionManager.removeVariable('TestSub', 'Motor');
    
    // Should have no monitored items left
    expect(subscription?.monitoredItems.size).toBe(0);
    
    // Should have called DELETE twice
    const deleteRequests = mockApiRequest.mock.calls.filter((call: any) => 
      call[1]?.method === 'DELETE' && call[0].includes('/monitoredItems/')
    );
    expect(deleteRequests.length).toBe(2);
  });
});