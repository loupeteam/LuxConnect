import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { VariablePathParser } from './variable-hierarchy.js';
import { 
  SubscriptionOptions, 
  MonitoredItemOptions
} from './types.js';

interface SubscriptionInfo {
  subscriptionId: number;
  name: string;
  monitoredItems: Map<number, MonitoredItemInfo>;
  desiredVariables: Set<string>; // Variables we want to monitor
  actualNodeIds: Set<string>;    // NodeIds we're actually monitoring
}

interface MonitoredItemInfo {
  monitoredItemId: number;
  clientHandle: number;
  nodeId: string;
  variableName?: string; // For registered variables
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

    return this.doCreateSubscription(name, options);
  }

  /**
   * Create or update a named subscription (handles existing subscriptions gracefully)
   */
  public async createOrUpdateSubscription(
    name: string, 
    options: SubscriptionOptions = {}
  ): Promise<string> {
    // If subscription exists, delete it first
    if (this.subscriptions.has(name)) {
      await this.deleteSubscription(name);
    }

    return this.doCreateSubscription(name, options);
  }

  /**
   * Internal method to create a subscription
   */
  private async doCreateSubscription(
    name: string, 
    options: SubscriptionOptions = {}
  ): Promise<string> {
    const subscriptionParams = {
      publishingInterval: options.publishingInterval || 1000,
      maxNotificationsPerPublish: options.maxNotificationsPerPublish || 10,
      priority: options.priority || 0,
      lifetimeCount: options.lifetimeCount || 3000,
      maxKeepAliveCount: options.maxKeepAliveCount || 10,
      publishingEnabled: true
    };

    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions`, {
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
      monitoredItems: new Map(),
      desiredVariables: new Set(),
      actualNodeIds: new Set()
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
    await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}`, {
      method: 'DELETE'
    });

    this.subscriptions.delete(name);
  }

  /**
   * Add a variable to a subscription by variable name (lux.js style)
   * Handles hierarchical relationships and prevents duplicates
   */
  public async addVariable(
    subscriptionName: string, 
    variableName: string, 
    _options: MonitoredItemOptions = {}
  ): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    const variable = this.variableManager.getVariable(variableName);
    if (!variable) {
      throw new Error(`Variable '${variableName}' is not registered`);
    }

    // Check if variable is already desired to avoid redundant operations
    if (subscription.desiredVariables.has(variableName)) {
      return;
    }

    // TODO: Add batch operation support for adding multiple variables at once
    // TODO: Consider rate limiting for rapid successive variable additions
    // Add to desired variables
    subscription.desiredVariables.add(variableName);

    // Consolidate and update subscription
    await this.consolidateSubscription(subscription);
  }

  /**
   * Remove a variable from a subscription
   */
  public async removeVariable(subscriptionName: string, variableName: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    // Remove from desired variables
    subscription.desiredVariables.delete(variableName);

    // Consolidate and update subscription
    await this.consolidateSubscription(subscription);
  }

  /**
   * Consolidate subscription based on hierarchical relationships
   * - If parent is desired, don't subscribe to children
   * - If children are desired but parent is added, remove children and add parent
   * - Avoid duplicate subscriptions
   * 
   * Each subscription maintains its own variable list for proper isolation,
   * but leverages VariableManager for consistent parsing
   */
  private async consolidateSubscription(subscription: SubscriptionInfo): Promise<void> {
    // Build hierarchy map for THIS subscription's variables only
    const subscriptionHierarchy = new Map<string, { nodeId: string; path: string[] }>();

    // Use VariableManager's data and VariablePathParser for consistent parsing
    for (const varName of subscription.desiredVariables) {
      const variable = this.variableManager.getVariable(varName);
      if (variable) {
        // Use VariablePathParser static method for consistent parsing
        const hierarchyPath = this.getHierarchyPathFromVariableName(varName);
        
        subscriptionHierarchy.set(varName, {
          nodeId: variable.nodeId,
          path: hierarchyPath
        });
      }
    }

    // Determine optimal set of nodeIds to subscribe to for THIS subscription
    const consolidatedNodeIds = this.findOptimalSubscriptionSet(subscriptionHierarchy);

    // Calculate what needs to be added/removed
    const toAdd = Array.from(consolidatedNodeIds).filter(nodeId => !subscription.actualNodeIds.has(nodeId));
    const toRemove = Array.from(subscription.actualNodeIds).filter(nodeId => !consolidatedNodeIds.has(nodeId));

    // Remove obsolete monitored items
    for (const nodeId of toRemove) {
      await this.removeMonitoredItemByNodeId(subscription, nodeId);
      subscription.actualNodeIds.delete(nodeId);
    }

    // Add new monitored items
    for (const nodeId of toAdd) {
      // Find the variable name for this nodeId
      const varName = this.findVariableNameByNodeId(nodeId, subscriptionHierarchy);
      await this.addMonitoredItem(subscription, nodeId, {}, varName);
      subscription.actualNodeIds.add(nodeId);
    }
  }

  /**
   * Find optimal set of nodeIds to subscribe to based on hierarchy
   */
  private findOptimalSubscriptionSet(variableHierarchy: Map<string, { nodeId: string; path: string[] }>): Set<string> {
    const result = new Set<string>();
    const processed = new Set<string>();

    // Sort variables by path depth (parents first)
    const sortedVars = Array.from(variableHierarchy.entries())
      .sort(([, a], [, b]) => a.path.length - b.path.length);

    for (const [varName, info] of sortedVars) {
      if (processed.has(varName)) continue;

      // Check if any parent is already included
      const hasParentIncluded = this.hasParentInSet(info.path, result, variableHierarchy);
      
      if (!hasParentIncluded) {
        // Add this variable
        result.add(info.nodeId);
        processed.add(varName);

        // Mark all children as processed (they're covered by this parent)
        this.markChildrenAsProcessed(info.path, variableHierarchy, processed);
      }
    }

    return result;
  }

  /**
   * Check if any parent of the given path is already in the result set
   */
  private hasParentInSet(
    path: string[], 
    resultSet: Set<string>, 
    variableHierarchy: Map<string, { nodeId: string; path: string[] }>
  ): boolean {
    // Check all possible parent paths
    for (let i = 0; i < path.length; i++) {
      const parentPath = path.slice(0, i);
      
      // Find if any variable in hierarchy matches this parent path
      for (const [, info] of variableHierarchy) {
        if (this.arraysEqual(info.path, parentPath) && resultSet.has(info.nodeId)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Mark all children of the given path as processed
   */
  private markChildrenAsProcessed(
    parentPath: string[],
    variableHierarchy: Map<string, { nodeId: string; path: string[] }>,
    processed: Set<string>
  ): void {
    for (const [varName, info] of variableHierarchy) {
      if (this.isChildPath(parentPath, info.path)) {
        processed.add(varName);
      }
    }
  }

  /**
   * Check if childPath is a child of parentPath
   */
  private isChildPath(parentPath: string[], childPath: string[]): boolean {
    if (childPath.length <= parentPath.length) return false;
    
    for (let i = 0; i < parentPath.length; i++) {
      if (parentPath[i] !== childPath[i]) return false;
    }
    return true;
  }

  /**
   * Get hierarchy path for subscription consolidation using static parser
   * Uses VariablePathParser for consistent parsing across the entire system
   * 
   * @param variableName - The variable name to parse
   * @returns Array representing the hierarchical path
   * @public For testing and external tools that need variable hierarchy information
   */
  public getHierarchyPathFromVariableName(variableName: string): string[] {
    try {
      // Use the proper VariablePathParser for consistent results
      const parsedPath = VariablePathParser.parse(variableName);
      
      // Convert VariablePath to simple hierarchy path for subscription consolidation
      // This represents the logical hierarchy depth for parent/child optimization
      const hierarchyParts: string[] = [];
      
      // Add application if present
      if (parsedPath.application) {
        hierarchyParts.push(parsedPath.application);
      }
      
      // Add task if not the default AsGlobalPV
      if (parsedPath.task && parsedPath.task !== 'AsGlobalPV') {
        hierarchyParts.push(parsedPath.task);
      }
      
      // Add the variable name
      hierarchyParts.push(parsedPath.variable);
      
      // Add any structure path elements
      hierarchyParts.push(...parsedPath.path);
      
      return hierarchyParts;
    } catch (error) {
      // Fallback to simple parsing if VariablePathParser fails
      console.warn(`Failed to parse variable name '${variableName}' with VariablePathParser, using fallback:`, error);
      const parts = variableName.split('.');
      return parts.slice(1); // Remove the first part
    }
  }

  /**
   * Find variable name by nodeId in the hierarchy map
   * 
   * @param nodeId - The OPC UA node ID to search for
   * @param variableHierarchy - The hierarchy map to search in
   * @returns Variable name if found, undefined otherwise
   * @public For debugging and external tools that need reverse node ID lookups
   */
  public findVariableNameByNodeId(
    nodeId: string, 
    variableHierarchy: Map<string, { nodeId: string; path: string[] }>
  ): string | undefined {
    // TODO: Consider indexing by nodeId for better performance (O(1) vs O(n))
    for (const [varName, info] of variableHierarchy) {
      if (info.nodeId === nodeId) {
        return varName;
      }
    }
    return undefined;
  }

  /**
   * Remove monitored item by nodeId
   */
  private async removeMonitoredItemByNodeId(subscription: SubscriptionInfo, nodeId: string): Promise<void> {
    // Find the monitored item with this nodeId
    for (const [, monitoredItem] of subscription.monitoredItems) {
      if (monitoredItem.nodeId === nodeId) {
        await this.removeMonitoredItem(subscription, nodeId);
        break;
      }
    }
  }

  /**
   * Check if two arrays are equal
   */
  private arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
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
      itemToMonitor: {
        nodeId: nodeId,
        attribute: 'Value'
      },
      monitoringParameters: {
        clientHandle: clientHandle,
        samplingInterval: options.samplingInterval || 1000,
        queueSize: options.queueSize || 1
      },
      timestampsToReturn: 'Both',
      monitoringMode: 'Reporting'
    };

    const response = await this.connection.apiRequest(
      `/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems`, 
      {
        method: 'POST',
        body: JSON.stringify(monitoredItemParams)
      }
    );

    const results = await response.json();
    
    if (!results || !results.monitoredItemId) {
      throw new Error(`Failed to create monitored item for ${nodeId}`);
    }

    const monitoredItemInfo: MonitoredItemInfo = {
      monitoredItemId: results.monitoredItemId,
      clientHandle: clientHandle,
      nodeId: nodeId,
      ...(variableName && { variableName })
    };

    subscription.monitoredItems.set(results.monitoredItemId, monitoredItemInfo);
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
      `/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/${monitoredItemId}`, 
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
        const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/references`, {
          method: 'GET'
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
      if (message.DataNotifications && Array.isArray(message.DataNotifications)) {
        for (const dataNotification of message.DataNotifications) {
          this.handleDataNotification(dataNotification);
        }
      }
    });
  }

  /**
   * Handle incoming data notification from WebSocket
   */
  private handleDataNotification(dataNotification: any): void {
    // Each dataNotification in the array contains the actual data value
    const monitoredItem = this.clientHandleMap.get(dataNotification.clientHandle);
    if (!monitoredItem) return;

    const timestamp = new Date(dataNotification.serverTimestamp || Date.now());
    const quality = this.mapQualityCode(dataNotification.status?.code || 0);

    // Update variable manager if this is a registered variable
    if (monitoredItem.variableName) {
      this.variableManager.updateVariableFromNotification(
        monitoredItem.nodeId,
        dataNotification.value,
        timestamp,
        quality
      );
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
