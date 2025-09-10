import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { 
  SubscriptionOptions, 
  MonitoredItemOptions
} from './types.js';

interface SubscriptionInfo {
  subscriptionId: number;
  name: string;
  monitoredItems: Map<number, MonitoredItemInfo>;
}

interface MonitoredItemInfo {
  monitoredItemId: number;
  clientHandle: number;
  nodeId: string;
  variableName?: string; // For registered variables
}

interface WebSocketNotification {
  subscriptionId: number;
  dataValues: Array<{
    clientHandle: number;
    value: any;
    statusCode: { value: number };
    serverTimestamp: string;
  }>;
}

/**
 * Subscription manager for real-time OPC UA variable monitoring
 * Handles OPC UA subscriptions and integrates with WebSocket notifications
 */
export class SubscriptionManager {
  private connection: OpcuaConnection;
  private variableManager: VariableManager;
  private subscriptions = new Map<string, SubscriptionInfo>();
  private clientHandleCounter = 1;
  private clientHandleMap = new Map<number, MonitoredItemInfo>();

  constructor(connection: OpcuaConnection, variableManager: VariableManager) {
    this.connection = connection;
    this.variableManager = variableManager;
    this.setupWebSocketHandler();
  }

  /**
   * Create a named subscription (lux.js style)
   */
  public async createSubscription(
    name: string, 
    options: SubscriptionOptions = {}
  ): Promise<string> {
    if (this.subscriptions.has(name)) {
      throw new Error(`Subscription '${name}' already exists`);
    }

    const subscriptionParams = {
      publishingInterval: options.publishingInterval || 1000,
      maxNotificationsPerPublish: options.maxNotificationsPerPublish || 10,
      priority: options.priority || 0,
      lifetimeCount: options.lifetimeCount || 3000,
      maxKeepAliveCount: options.maxKeepAliveCount || 10,
      publishingEnabled: true
    };

    const response = await this.connection.apiRequest('/opcua/subscription', {
      method: 'POST',
      body: JSON.stringify(subscriptionParams)
    });

    const result = await response.json();
    
    if (!result.subscriptionId) {
      throw new Error(`Failed to create subscription '${name}': Invalid response`);
    }

    const subscriptionInfo: SubscriptionInfo = {
      subscriptionId: result.subscriptionId,
      name,
      monitoredItems: new Map()
    };

    this.subscriptions.set(name, subscriptionInfo);
    return name;
  }

  /**
   * Delete a subscription
   */
  public async deleteSubscription(name: string): Promise<void> {
    const subscription = this.subscriptions.get(name);
    if (!subscription) {
      throw new Error(`Subscription '${name}' not found`);
    }

    // Remove all monitored items from client handle map
    for (const [, monitoredItem] of subscription.monitoredItems) {
      this.clientHandleMap.delete(monitoredItem.clientHandle);
    }

    // Delete subscription on server
    await this.connection.apiRequest(`/opcua/subscription/${subscription.subscriptionId}`, {
      method: 'DELETE'
    });

    this.subscriptions.delete(name);
  }

  /**
   * Add a variable to a subscription by variable name (lux.js style)
   */
  public async addVariable(
    subscriptionName: string, 
    variableName: string, 
    options: MonitoredItemOptions = {}
  ): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    const variable = this.variableManager.getVariable(variableName);
    if (!variable) {
      throw new Error(`Variable '${variableName}' is not registered`);
    }

    await this.addMonitoredItem(subscription, variable.nodeId, options, variableName);
  }

  /**
   * Add a node to a subscription by nodeId
   */
  public async addNode(
    subscriptionName: string, 
    nodeId: string, 
    options: MonitoredItemOptions = {}
  ): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    await this.addMonitoredItem(subscription, nodeId, options);
  }

  /**
   * Remove a variable from a subscription
   */
  public async removeVariable(subscriptionName: string, variableName: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    const variable = this.variableManager.getVariable(variableName);
    if (!variable) {
      throw new Error(`Variable '${variableName}' is not registered`);
    }

    await this.removeMonitoredItem(subscription, variable.nodeId);
  }

  /**
   * Remove a node from a subscription
   */
  public async removeNode(subscriptionName: string, nodeId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    await this.removeMonitoredItem(subscription, nodeId);
  }

  /**
   * Get subscription information
   */
  public getSubscription(name: string): SubscriptionInfo | undefined {
    return this.subscriptions.get(name);
  }

  /**
   * Get all subscriptions
   */
  public getAllSubscriptions(): Map<string, SubscriptionInfo> {
    return new Map(this.subscriptions);
  }

  /**
   * Subscribe to an entire structure recursively (like the test interface)
   */
  public async subscribeToStructure(
    subscriptionName: string,
    rootNodeId: string,
    maxDepth: number = 10
  ): Promise<number> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    const nodeIds = await this.discoverStructureNodes(rootNodeId, maxDepth);
    
    // Add all discovered nodes to the subscription
    for (const nodeId of nodeIds) {
      try {
        await this.addMonitoredItem(subscription, nodeId);
      } catch (error) {
        console.warn(`Failed to add node ${nodeId} to subscription:`, error);
      }
    }

    return nodeIds.length;
  }

  /**
   * Add a monitored item to a subscription
   */
  private async addMonitoredItem(
    subscription: SubscriptionInfo, 
    nodeId: string, 
    options: MonitoredItemOptions = {},
    variableName?: string
  ): Promise<void> {
    const clientHandle = this.clientHandleCounter++;

    const monitoredItemParams = {
      nodeId: nodeId,
      attributeId: 13, // Value attribute
      samplingInterval: options.samplingInterval || 1000,
      discardOldest: options.discardOldest !== false,
      queueSize: options.queueSize || 1,
      clientHandle: clientHandle
    };

    const response = await this.connection.apiRequest(
      `/opcua/subscription/${subscription.subscriptionId}/monitoredItems`, 
      {
        method: 'POST',
        body: JSON.stringify([monitoredItemParams])
      }
    );

    const results = await response.json();
    
    if (!results || results.length === 0 || !results[0].monitoredItemId) {
      throw new Error(`Failed to create monitored item for ${nodeId}`);
    }

    const monitoredItemInfo: MonitoredItemInfo = {
      monitoredItemId: results[0].monitoredItemId,
      clientHandle: clientHandle,
      nodeId: nodeId,
      ...(variableName && { variableName })
    };

    subscription.monitoredItems.set(results[0].monitoredItemId, monitoredItemInfo);
    this.clientHandleMap.set(clientHandle, monitoredItemInfo);
  }

  /**
   * Remove a monitored item from a subscription
   */
  private async removeMonitoredItem(subscription: SubscriptionInfo, nodeId: string): Promise<void> {
    let monitoredItemId: number | undefined;
    let clientHandle: number | undefined;

    // Find the monitored item
    for (const [itemId, item] of subscription.monitoredItems) {
      if (item.nodeId === nodeId) {
        monitoredItemId = itemId;
        clientHandle = item.clientHandle;
        break;
      }
    }

    if (monitoredItemId === undefined || clientHandle === undefined) {
      throw new Error(`Monitored item for ${nodeId} not found in subscription`);
    }

    // Remove from server
    await this.connection.apiRequest(
      `/opcua/subscription/${subscription.subscriptionId}/monitoredItems/${monitoredItemId}`, 
      {
        method: 'DELETE'
      }
    );

    // Remove from local maps
    subscription.monitoredItems.delete(monitoredItemId);
    this.clientHandleMap.delete(clientHandle);
  }

  /**
   * Discover all nodes in a structure recursively
   */
  private async discoverStructureNodes(rootNodeId: string, maxDepth: number): Promise<string[]> {
    const discovered = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootNodeId, depth: 0 }];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      
      if (depth >= maxDepth || discovered.has(nodeId)) {
        continue;
      }

      discovered.add(nodeId);

      try {
        // Browse children
        const response = await this.connection.apiRequest('/opcua/browse', {
          method: 'POST',
          body: JSON.stringify({
            nodeId: nodeId,
            browseDirection: 0, // Forward
            includeSubtypes: true,
            maxResults: 100
          })
        });

        const result = await response.json();
        
        if (result.references) {
          for (const ref of result.references) {
            if (ref.nodeId?.value) {
              queue.push({ nodeId: ref.nodeId.value, depth: depth + 1 });
            }
          }
        }
      } catch (error) {
        console.warn(`Failed to browse node ${nodeId}:`, error);
      }
    }

    return Array.from(discovered);
  }

  /**
   * Setup WebSocket message handler for subscription notifications
   */
  private setupWebSocketHandler(): void {
    // Monitor connection state for WebSocket setup
    this.connection.onConnectionStateChanged((state) => {
      if (state === 'connected') {
        this.setupWebSocketNotifications();
      }
    });
  }

  /**
   * Setup WebSocket notification handling
   */
  private setupWebSocketNotifications(): void {
    // Use the connection's message handler instead of direct WebSocket access
    this.connection.onMessage((message: any) => {
      if (message.type === 'DataNotification') {
        this.handleDataNotification(message);
      }
    });
  }

  /**
   * Handle incoming data notification from WebSocket
   */
  private handleDataNotification(notification: WebSocketNotification): void {
    if (!notification.dataValues) return;

    for (const dataValue of notification.dataValues) {
      const monitoredItem = this.clientHandleMap.get(dataValue.clientHandle);
      if (!monitoredItem) continue;

      const timestamp = new Date(dataValue.serverTimestamp || Date.now());
      const quality = this.mapQualityCode(dataValue.statusCode?.value || 0);

      // Update variable manager if this is a registered variable
      if (monitoredItem.variableName) {
        this.variableManager.updateVariableFromNotification(
          monitoredItem.nodeId,
          dataValue.value,
          timestamp,
          quality
        );
      }
    }
  }

  /**
   * Map OPC UA status code to quality string
   */
  private mapQualityCode(statusCode: number): string {
    switch (statusCode) {
      case 0: return 'good';
      case 0x40000000: return 'uncertain';
      case 0x80000000: return 'bad';
      default: return 'unknown';
    }
  }
}
