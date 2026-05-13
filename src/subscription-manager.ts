import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { VariablePathParser, DEFAULT_GLOBAL_TASK } from './variable-hierarchy.js';
import { LuxConnectError, LuxConnectErrorCode } from './errors.js';
import type { Logger } from './logger.js';
import { silentLogger } from './logger.js';
import { 
  SubscriptionOptions, 
  MonitoredItemOptions,
  DataNotification
} from './types.js';

interface SubscriptionInfo {
  subscriptionId: number;
  name: string;  
  monitoredItems: Map<number, MonitoredItemInfo>;
  desiredVariables: Set<string>; // Variables we want to monitor
  parameters: SubscriptionOptions; // Store options for reference
}

interface MonitoredItemInfo {
  monitoredItemId: number;
  clientHandle: number;
  nodeId: string;
  variableName?: string; // For registered variables
  /**
   * Whether we've received and inspected the first notification for this
   * monitored item. The first notification typically reports whether the
   * server could actually resolve the node (e.g. BadNodeIdUnknown for a
   * misspelled variable), so we use it to surface bad-variable warnings
   * that the subscribe call itself doesn't tell us about.
   */
  firstNotificationSeen?: boolean;
}

/**
 * Subscription manager for real-time OPC UA variable monitoring
 * Handles OPC UA subscriptions and integrates with WebSocket notifications
 */
export class SubscriptionManager {
  private connection: OpcuaConnection;
  private variableManager: VariableManager;
  private readonly log: Logger;
  private subscriptions = new Map<string, SubscriptionInfo>();
  private clientHandleCounter = 1;
  private clientHandleMap = new Map<number, MonitoredItemInfo>();
  /**
   * Per-subscription serialization chain. consolidateSubscription mutates
   * monitoredItems based on a snapshot taken at the start of the call, but
   * the actual server delete/add round-trips are async. If two consolidation
   * passes run concurrently for the same subscription they race: both compute
   * overlapping toRemove/toAdd sets from stale snapshots, and the second
   * batch-delete 404s with 'Could not find monitoredItemId' because the
   * first call already removed those items on the server. Chaining all
   * consolidations through a per-subscription promise ensures each pass
   * sees a fully reconciled state.
   */
  private consolidationChains = new Map<string, Promise<void>>();

  constructor(connection: OpcuaConnection, variableManager: VariableManager, logger?: Logger) {
    this.connection = connection;
    this.variableManager = variableManager;
    // Reuse the connection's logger by default for unified output routing.
    // Falls back to silentLogger if the connection doesn't expose one (e.g. test mocks).
    this.log = logger ?? (typeof connection.getLogger === 'function' ? connection.getLogger() : silentLogger);
    // Register the message handler once at construction. The connection's
    // onMessage list is append-only, so we must NOT re-subscribe on every
    // reconnect (would dispatch each notification N times after N reconnects).
    this.setupWebSocketNotifications();
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
      parameters: subscriptionParams
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
   * Add multiple variables to a subscription efficiently
   * This is more efficient than calling addVariable multiple times as it
   * consolidates the subscription only once after adding all variables
   */
  public async addVariables(
    subscriptionName: string, 
    variableNames: string[], 
    options: MonitoredItemOptions = {}
  ): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionName);
    if (!subscription) {
      throw new Error(`Subscription '${subscriptionName}' not found`);
    }

    // Validate all variables exist before adding any
    for (const variableName of variableNames) {
      const variable = this.variableManager.getVariable(variableName);
      if (!variable) {
        throw new Error(`Variable '${variableName}' is not registered`);
      }
    }

    // Filter out variables that are already desired
    const newVariables = variableNames.filter(varName => !subscription.desiredVariables.has(varName));
    
    if (newVariables.length === 0) {
      return; // All variables already added
    }

    // Warn about samplingInterval mismatches
    if (options.samplingInterval && options.samplingInterval !== subscription.parameters.publishingInterval) {
      this.log.warn(`Warning: Variables samplingInterval (${options.samplingInterval}ms) differs from subscription '${subscriptionName}' publishingInterval (${subscription.parameters.publishingInterval}ms). All variables in a subscription should use the same rate. Consider using a separate subscription for different rates.`);
    }

    // Add all variables to desired set
    for (const variableName of newVariables) {
      subscription.desiredVariables.add(variableName);
    }

    // Consolidate once after adding all variables (this triggers batching)
    await this.consolidateSubscription(subscription);
  }

  /**
   * Add a variable to a subscription by variable name (lux.js style)
   * Handles hierarchical relationships and prevents duplicates
   * 
   * Note: All variables in a subscription will use the subscription's publishingInterval
   * as their samplingInterval. If you need different sampling rates, create separate
   * subscriptions with different intervals.
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

    // Check if variable is already desired to avoid redundant operations
    if (subscription.desiredVariables.has(variableName)) {
      return;
    }

    // Warn if trying to override samplingInterval - it should match subscription rate
    if (options.samplingInterval && options.samplingInterval !== subscription.parameters.publishingInterval) {
      this.log.warn(`Warning: Variable '${variableName}' samplingInterval (${options.samplingInterval}ms) differs from subscription '${subscriptionName}' publishingInterval (${subscription.parameters.publishingInterval}ms). All variables in a subscription should use the same rate. Consider using a separate subscription for different rates.`);
    }

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
   * but leverages VariableManager for consistent parsing.
   * This method is exposed publicly to allow external batch updates to subscriptions.
   *
   * Calls are serialized per subscription via `consolidationChains` so that
   * back-to-back add/remove flurries (e.g. React reconciliation) don't issue
   * overlapping DELETEs against the server.
   */
  public consolidateSubscription(subscription: SubscriptionInfo): Promise<void> {
    const prev = this.consolidationChains.get(subscription.name) ?? Promise.resolve();
    const next = prev
      .catch(() => { /* prior consolidation errors are surfaced to their own awaiter */ })
      .then(() => this.doConsolidateSubscription(subscription));
    // Track the latest link; clean up once it settles so the map doesn't grow
    // unbounded for long-lived subscriptions.
    this.consolidationChains.set(subscription.name, next);
    next.finally(() => {
      if (this.consolidationChains.get(subscription.name) === next) {
        this.consolidationChains.delete(subscription.name);
      }
    });
    return next;
  }

  private async doConsolidateSubscription(subscription: SubscriptionInfo): Promise<void> {
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

    // Get currently monitored nodeIds from the monitoredItems map
    const currentlyMonitored = new Set<string>();
    for (const [, monitoredItem] of subscription.monitoredItems) {
      currentlyMonitored.add(monitoredItem.nodeId);
    }

    // Calculate what needs to be added/removed
    const toAdd = Array.from(consolidatedNodeIds).filter(nodeId => !currentlyMonitored.has(nodeId));
    const toRemove = Array.from(currentlyMonitored).filter(nodeId => !consolidatedNodeIds.has(nodeId));

    // Always use batch operations for consistency and simplicity
    if (toRemove.length > 0) {
      await this.removeMultipleMonitoredItems(subscription, toRemove);
    }

    if (toAdd.length > 0) {
      const batchItems = toAdd.map(nodeId => {
        const varName = this.findVariableNameByNodeId(nodeId, subscriptionHierarchy);
        return {
          nodeId: nodeId,
          ...(varName && { variableName: varName }),
          options: {} as MonitoredItemOptions
        };
      });
      await this.addMultipleMonitoredItems(subscription, batchItems);
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

      // Apply the same task-name truncation used when building nodeIds so that
      // hierarchy paths used for subscription consolidation match the actual
      // nodeIds. Otherwise two variables that resolve to the same truncated
      // task could appear as siblings in different hierarchy branches and fail
      // to consolidate correctly.
      const taskNameMaxLength = this.variableManager.getTaskNameMaxLength();
      if (
        taskNameMaxLength !== undefined &&
        parsedPath.task &&
        parsedPath.task !== DEFAULT_GLOBAL_TASK &&
        parsedPath.task.length > taskNameMaxLength
      ) {
        parsedPath.task = parsedPath.task.slice(0, taskNameMaxLength);
      }

      // Convert VariablePath to simple hierarchy path for subscription consolidation
      // This represents the logical hierarchy depth for parent/child optimization
      const hierarchyParts: string[] = [];

      // Add application if present
      if (parsedPath.application) {
        hierarchyParts.push(parsedPath.application);
      }

      // Add task if not the default AsGlobalPV
      if (parsedPath.task && parsedPath.task !== DEFAULT_GLOBAL_TASK) {
        hierarchyParts.push(parsedPath.task);
      }
      
      // Add the variable name
      hierarchyParts.push(parsedPath.variable);
      
      // Add any structure path elements
      hierarchyParts.push(...parsedPath.path);
      
      return hierarchyParts;
    } catch (error) {
      // Fallback to simple parsing if VariablePathParser fails
      this.log.warn(`Failed to parse variable name '${variableName}' with VariablePathParser, using fallback:`, error);
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
    for (const [varName, info] of variableHierarchy) {
      if (info.nodeId === nodeId) {
        return varName;
      }
    }
    return undefined;
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
   * Recover all subscriptions after reconnection
   * This recreates all subscriptions and monitored items with the new session
   */
  public async recoverAllSubscriptions(): Promise<void> {
    this.log.info('Recovering subscriptions after reconnection...');
    
    // Store current subscription configurations
    const subscriptionConfigs: Array<{
      name: string;
      parameters: SubscriptionOptions;
      variables: Set<string>;
    }> = [];
    
    // Collect all current subscription configurations
    for (const [name, subscription] of this.subscriptions) {
      subscriptionConfigs.push({
        name,
        parameters: subscription.parameters,
        variables: new Set(subscription.desiredVariables)
      });
    }
    
    // Clear current subscriptions (they're invalid with the old session)
    this.clearAllSubscriptions();
    
    this.log.info(`Recreating ${subscriptionConfigs.length} subscriptions...`);
    
    // Recreate each subscription
    for (const config of subscriptionConfigs) {
      try {
        this.log.info(`Recreating subscription: ${config.name}`);
        
        // Create the subscription
        await this.createSubscription(config.name, config.parameters);
        const subscription = this.subscriptions.get(config.name);
        
        if (!subscription) {
          this.log.error(`Failed to find recreated subscription: ${config.name}`);
          continue;
        }

        // Re-add all variables in a single batched operation. addVariables
        // adds them to the desired-set together and runs ONE consolidation,
        // which produces a single $batch monitoredItems POST.
        if (config.variables.size > 0) {
          try {
            await this.addVariables(config.name, Array.from(config.variables));
          } catch (error) {
            this.log.warn(`Batched re-add failed for subscription ${config.name}, falling back to per-variable:`, error);
            for (const variableName of config.variables) {
              try {
                await this.addVariable(config.name, variableName);
              } catch (e) {
                this.log.warn(`Failed to re-add variable ${variableName} to subscription ${config.name}:`, e);
              }
            }
          }
        }
        
        this.log.info(`✅ Recreated subscription: ${config.name} with ${config.variables.size} variables`);
      } catch (error) {
        this.log.error(`Failed to recreate subscription ${config.name}:`, error);
      }
    }
    
    this.log.info('Subscription recovery completed');
  }

  /**
   * Clear all subscriptions without making API calls
   * Used during reconnection when old subscriptions are invalid
   */
  public clearAllSubscriptions(): void {
    this.log.info('Clearing all subscription state...');
    this.subscriptions.clear();
    this.clientHandleMap.clear();
    this.clientHandleCounter = 1;
    this.orphanCleanupAttempted.clear();
    this.log.info('Subscription state cleared');
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

    // Use subscription's monitoring parameters, with option overrides
    const monitoredItemParams = {
      itemToMonitor: {
        nodeId: nodeId,
        attribute: 'Value'
      },
      monitoringParameters: {
        clientHandle: clientHandle,
        // Use subscription's publishingInterval as the default samplingInterval
        // This ensures all variables in a subscription use the same rate
        samplingInterval: options.samplingInterval || subscription.parameters.publishingInterval || 1000,
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
   * Add multiple monitored items to a subscription in a batch operation
   */
  private async addMultipleMonitoredItems(
    subscription: SubscriptionInfo,
    items: Array<{ nodeId: string; options?: MonitoredItemOptions; variableName?: string }>
  ): Promise<void> {
    if (items.length === 0) return;
    
    this.log.info(`Adding ${items.length} monitored items in batch...`);
    
    // Prepare batch request
    const monitoredItemsParams = items.map(item => {
      const clientHandle = this.clientHandleCounter++;
      return {
        itemToMonitor: {
          nodeId: item.nodeId,
          attribute: 'Value'
        },
        monitoringParameters: {
          clientHandle: clientHandle,
          samplingInterval: item.options?.samplingInterval || subscription.parameters.publishingInterval || 1000,
          queueSize: item.options?.queueSize || 1
        },
        timestampsToReturn: 'Both',
        monitoringMode: 'Reporting',
        // Store metadata for result processing
        _metadata: {
          nodeId: item.nodeId,
          variableName: item.variableName,
          clientHandle: clientHandle
        }
      };
    });

    try {
      // Try batch operation first using the correct mapp Connect batch format
      const batchRequests = monitoredItemsParams.map((param, index) => ({
        id: `add-${index}`,
        method: 'POST',
        url: `/`,  // Relative URL within the monitoredItems context
        body: {
          itemToMonitor: {
            nodeId: param.itemToMonitor.nodeId,
            attribute: param.itemToMonitor.attribute
          },
          monitoringParameters: {
            samplingInterval: param.monitoringParameters.samplingInterval,
            queueSize: param.monitoringParameters.queueSize,
            clientHandle: param.monitoringParameters.clientHandle
          },
          timestampsToReturn: param.timestampsToReturn,
          monitoringMode: param.monitoringMode
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }));

      const batchBody = {
        requests: batchRequests
      };

      const response = await this.connection.apiRequest(
        `/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/$batch`, 
        {
          method: 'POST',
          body: JSON.stringify(batchBody)
        }
      );

      const results = await response.json();
      
      if (results.responses && Array.isArray(results.responses)) {
        const failures: Array<{ nodeId: string; status?: number; statusText?: string; body?: unknown }> = [];
        let successCount = 0;
        // Process batch results
        for (let i = 0; i < results.responses.length; i++) {
          const response = results.responses[i];
          const originalItem = monitoredItemsParams[i];

          // Treat any 2xx (or missing) HTTP status as success. Some firmwares
          // respond with 204 No Content and no body for successful adds, so we
          // can't require `monitoredItemId` to decide success.
          const httpStatus: number | undefined = response?.status;
          const httpOk = httpStatus === undefined || (httpStatus >= 200 && httpStatus < 300);

          if (httpOk) {
            successCount++;
            // If the server included the monitoredItemId, track it locally so
            // we can manage/remove it later. Otherwise we just trust the server
            // accepted it but won't be able to remove it individually.
            const monitoredItemId = response?.body?.monitoredItemId;
            if (monitoredItemId !== undefined && monitoredItemId !== null) {
              const monitoredItemInfo: MonitoredItemInfo = {
                monitoredItemId,
                clientHandle: originalItem._metadata.clientHandle,
                nodeId: originalItem._metadata.nodeId,
                ...(originalItem._metadata.variableName && { variableName: originalItem._metadata.variableName })
              };
              subscription.monitoredItems.set(monitoredItemId, monitoredItemInfo);
              this.clientHandleMap.set(originalItem._metadata.clientHandle, monitoredItemInfo);
            } else {
              this.log.debug(
                `Add accepted (status=${httpStatus ?? '?'}) for ${originalItem._metadata.nodeId} ` +
                `but no monitoredItemId returned; not tracked locally.`
              );
            }
          } else {
            failures.push({
              nodeId: originalItem._metadata.nodeId,
              status: httpStatus,
              statusText: response?.statusText,
              body: response?.body
            });
            this.log.warn(
              `Failed to create monitored item for ${originalItem._metadata.nodeId} ` +
              `(status=${httpStatus ?? '?'}${response?.statusText ? ' ' + response.statusText : ''}):`,
              response?.body ?? response
            );
            // If the server says the subscription no longer exists, throw so the caller
            // can delete and re-create it rather than silently losing the variable.
            const msg: string = response?.body?.message ?? '';
            if (httpStatus === 404 && msg.toLowerCase().includes('subscriptionid')) {
              throw new LuxConnectError(
                LuxConnectErrorCode.SUBSCRIPTION_NOT_FOUND,
                `Subscription ${subscription.subscriptionId} not found on server (404). Will retry.`
              );
            }
          }
        }
        if (failures.length > 0) {
          this.log.warn(
            `⚠️ Batch add: ${failures.length}/${results.responses.length} monitored items FAILED for subscription ${subscription.subscriptionId}:`,
            failures
          );
        }
        this.log.info(`✅ Batch add completed: ${successCount}/${results.responses.length} items registered`);
      } else {
        this.log.warn('Batch add returned no responses array; raw result:', results);
      }
    } catch (err) {
      // Don't swallow our explicit "subscription is gone, please recreate" signal.
      if (err instanceof LuxConnectError && err.code === LuxConnectErrorCode.SUBSCRIPTION_NOT_FOUND) {
        throw err;
      }
      // Fallback to individual operations if batch is not supported by the server.
      this.log.warn('Batch add failed, falling back to individual operations:', err);
      
      for (const item of items) {
        try {
          await this.addMonitoredItem(subscription, item.nodeId, item.options || {}, item.variableName);
        } catch (error) {
          this.log.warn(`Failed to add monitored item ${item.nodeId}:`, error);
        }
      }
    }
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

    // Always remove from local maps first so that a server-side error cannot
    // cause the item to be retried on every subsequent consolidation pass.
    subscription.monitoredItems.delete(monitoredItemId);
    this.clientHandleMap.delete(clientHandle);

    // Remove from server (best-effort — local state is already cleaned up).
    await this.connection.apiRequest(
      `/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/${monitoredItemId}`, 
      {
        method: 'DELETE'
      }
    );
  }

  /**
   * Remove multiple monitored items from a subscription in a batch operation
   */
  private async removeMultipleMonitoredItems(
    subscription: SubscriptionInfo,
    nodeIds: string[]
  ): Promise<void> {
    if (nodeIds.length === 0) return;
    
    this.log.info(`Removing ${nodeIds.length} monitored items in batch...`);
    
    // Find monitored item IDs for the given node IDs
    const itemsToRemove: Array<{ monitoredItemId: number; clientHandle: number; nodeId: string }> = [];
    
    for (const nodeId of nodeIds) {
      for (const [itemId, item] of subscription.monitoredItems) {
        if (item.nodeId === nodeId) {
          itemsToRemove.push({
            monitoredItemId: itemId,
            clientHandle: item.clientHandle,
            nodeId: nodeId
          });
          break;
        }
      }
    }
    
    if (itemsToRemove.length === 0) {
      this.log.warn('No monitored items found for the given node IDs');
      return;
    }

    try {
      // Try batch delete operation using the correct mapp Connect batch format
      const batchRequests = itemsToRemove.map((item, index) => ({
        id: index,
        method: 'DELETE',
        url: `/${item.monitoredItemId}`,  // Relative URL for the specific monitored item
        headers: {
          'Content-Type': 'application/json'
        }
      }));

      const removeResponse = await this.connection.apiRequest(
        `/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/$batch`, 
        {
          method: 'POST',  // Batch operations are always POST
          body: JSON.stringify({
            requests: batchRequests
          })
        }
      );

      // Inspect per-item responses so we surface bad statuses instead of
      // silently reporting success when the server rejected individual deletes.
      let removeResults: { responses?: unknown[] } | undefined;
      try {
        removeResults = await removeResponse.json();
      } catch {
        removeResults = undefined;
      }

      const failures: Array<{ nodeId: string; monitoredItemId: number; status?: number; body?: unknown }> = [];
      if (removeResults && Array.isArray(removeResults.responses)) {
        for (let i = 0; i < removeResults.responses.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = removeResults.responses[i] as any;
          const item = itemsToRemove[i];
          const ok = r && (r.status === undefined || (r.status >= 200 && r.status < 300));
          if (!ok) {
            failures.push({
              nodeId: item.nodeId,
              monitoredItemId: item.monitoredItemId,
              status: r?.status,
              body: r?.body
            });
            this.log.warn(
              `Failed to remove monitored item ${item.monitoredItemId} (${item.nodeId}) ` +
              `(status=${r?.status ?? '?'}):`,
              r?.body ?? r
            );
          }
        }
      }

      // Always clean up local state after a deletion attempt, regardless of
      // server response. Keeping failed items in local state causes the next
      // consolidation pass to re-add them to `toRemove` and retry forever.
      // If the server couldn't find the item (404) it's already gone; for
      // other errors the item is untrackable so we remove it locally and log.
      for (const item of itemsToRemove) {
        subscription.monitoredItems.delete(item.monitoredItemId);
        this.clientHandleMap.delete(item.clientHandle);
      }

      const removed = itemsToRemove.length - failures.length;
      if (failures.length > 0) {
        this.log.warn(
          `⚠️ Batch remove: ${failures.length}/${itemsToRemove.length} monitored items FAILED for subscription ${subscription.subscriptionId}`
        );
      }
      console.log(`✅ Batch remove completed: ${removed}/${itemsToRemove.length} items removed`);
    } catch (err) {
      // Fallback to individual operations if batch is not supported by the server.
      this.log.warn('Batch remove failed, falling back to individual operations:', err);
      
      for (const nodeId of nodeIds) {
        try {
          await this.removeMonitoredItem(subscription, nodeId);
        } catch (error) {
          this.log.warn(`Failed to remove monitored item ${nodeId}:`, error);
        }
      }
    }
  }

  /**
   * Setup WebSocket notification handling. Called ONCE from the constructor —
   * the connection's onMessage list is append-only, so re-subscribing on every
   * `connected` transition would dispatch each notification N times.
   */
  private setupWebSocketNotifications(): void {
    // Use the connection's message handler instead of direct WebSocket access
// eslint-disable-next-line @typescript-eslint/no-explicit-any    
    this.connection.onMessage((message: any) => {
      if (message && message.DataNotifications && Array.isArray(message.DataNotifications)) {
        // Filter out stale messages from previous sessions
        if (this.isStaleMessage(message)) {
          this.log.debug(`🚫 Ignoring stale WebSocket message from session ${message.sessionId} (current: ${this.connection.getSessionInfo()?.sessionId})`);
          return;
        }

        // Orphan-subscription cleanup: if the message references a subscription
        // we don't own (e.g. left over from a previous page load that restored
        // the same session), DELETE it on the server so it stops sending us
        // notifications.
        const subId = typeof message.subscriptionId === 'number'
          ? message.subscriptionId
          : undefined;
        if (subId !== undefined && !this.ownsSubscription(subId)) {
          if (!this.orphanCleanupAttempted.has(subId)) {
            this.orphanCleanupAttempted.add(subId);
            this.log.warn(`Detected orphaned subscription ${subId} from previous session — deleting`);
            void this.connection.deleteServerSubscription(subId);
          }
          return;
        }

        for (const dataNotification of message.DataNotifications) {
          this.handleDataNotification(dataNotification);
        }
      }
    });
  }

  /** Tracks subscription IDs we've already issued a DELETE for, to avoid spam. */
  private orphanCleanupAttempted = new Set<number>();

  private ownsSubscription(subscriptionId: number): boolean {
    for (const sub of this.subscriptions.values()) {
      if (sub.subscriptionId === subscriptionId) return true;
    }
    return false;
  }

  /**
   * Check if a WebSocket message is from a previous session
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isStaleMessage(message: any): boolean {
    const currentSessionId = this.connection.getSessionInfo()?.sessionId;
    const messageSessionId = message.sessionId;
    
    // If we can't determine session IDs, allow the message (fail safe)
    if (!currentSessionId || messageSessionId === undefined) {
      return false;
    }
    
    // Convert to strings for comparison to handle both string and number session IDs
    const currentId = String(currentSessionId);
    const msgId = String(messageSessionId);
    
    // Return true if this message is from a different session (stale)
    return currentId !== msgId;
  }

  /**
   * Handle incoming data notification from WebSocket
   */
  private handleDataNotification(dataNotification: DataNotification): void {
    // Each dataNotification in the array contains the actual data value
    const monitoredItem = this.clientHandleMap.get(dataNotification.clientHandle);
    if (!monitoredItem) return;

    const timestamp = new Date(dataNotification.serverTimestamp || Date.now());
    const statusCode = dataNotification.status?.code ?? 0;
    const quality = this.mapQualityCode(statusCode);

    // The mapp Connect / OPC UA server doesn't reject a subscribe for a
    // missing variable; instead the very first DataChangeNotification carries
    // a non-zero status (typically BadNodeIdUnknown = 0x80340000). Log that
    // exactly once per monitored item so misspelled / non-existent variables
    // are visible without spamming on every subsequent (still-bad) update.
    if (!monitoredItem.firstNotificationSeen) {
      monitoredItem.firstNotificationSeen = true;
      if (statusCode !== 0) {
        const symbol = dataNotification.status?.symbol;
        const hex = '0x' + (statusCode >>> 0).toString(16).toUpperCase();
        const label = monitoredItem.variableName
          ? `'${monitoredItem.variableName}' (${monitoredItem.nodeId})`
          : monitoredItem.nodeId;
        this.log.warn(
          `⚠️ First notification for ${label} reports bad/uncertain status ` +
          `${symbol ?? ''} (${hex}). The variable may not exist on the server.`
        );
      }
    }

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
