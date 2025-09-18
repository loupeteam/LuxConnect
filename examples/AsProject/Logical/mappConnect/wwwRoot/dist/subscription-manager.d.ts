import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { SubscriptionOptions, MonitoredItemOptions } from './types.js';
interface SubscriptionInfo {
    subscriptionId: number;
    name: string;
    monitoredItems: Map<number, MonitoredItemInfo>;
    desiredVariables: Set<string>;
    parameters: SubscriptionOptions;
}
interface MonitoredItemInfo {
    monitoredItemId: number;
    clientHandle: number;
    nodeId: string;
    variableName?: string;
}
/**
 * Subscription manager for real-time OPC UA variable monitoring
 * Handles OPC UA subscriptions and integrates with WebSocket notifications
 */
export declare class SubscriptionManager {
    private connection;
    private variableManager;
    private subscriptions;
    private clientHandleCounter;
    private clientHandleMap;
    constructor(connection: OpcuaConnection, variableManager: VariableManager);
    /**
     * Create a named subscription (lux.js style)
     */
    createSubscription(name: string, options?: SubscriptionOptions): Promise<string>;
    /**
     * Create or update a named subscription (handles existing subscriptions gracefully)
     */
    createOrUpdateSubscription(name: string, options?: SubscriptionOptions): Promise<string>;
    /**
     * Internal method to create a subscription
     */
    private doCreateSubscription;
    /**
     * Delete a subscription
     */
    deleteSubscription(name: string): Promise<void>;
    /**
     * Add a variable to a subscription by variable name (lux.js style)
     * Handles hierarchical relationships and prevents duplicates
     *
     * Note: All variables in a subscription will use the subscription's publishingInterval
     * as their samplingInterval. If you need different sampling rates, create separate
     * subscriptions with different intervals.
     */
    addVariable(subscriptionName: string, variableName: string, options?: MonitoredItemOptions): Promise<void>;
    /**
     * Remove a variable from a subscription
     */
    removeVariable(subscriptionName: string, variableName: string): Promise<void>;
    /**
     * Consolidate subscription based on hierarchical relationships
     * - If parent is desired, don't subscribe to children
     * - If children are desired but parent is added, remove children and add parent
     * - Avoid duplicate subscriptions
     *
     * Each subscription maintains its own variable list for proper isolation,
     * but leverages VariableManager for consistent parsing
     */
    private consolidateSubscription;
    /**
     * Find optimal set of nodeIds to subscribe to based on hierarchy
     */
    private findOptimalSubscriptionSet;
    /**
     * Check if any parent of the given path is already in the result set
     */
    private hasParentInSet;
    /**
     * Mark all children of the given path as processed
     */
    private markChildrenAsProcessed;
    /**
     * Check if childPath is a child of parentPath
     */
    private isChildPath;
    /**
     * Get hierarchy path for subscription consolidation using static parser
     * Uses VariablePathParser for consistent parsing across the entire system
     *
     * @param variableName - The variable name to parse
     * @returns Array representing the hierarchical path
     * @public For testing and external tools that need variable hierarchy information
     */
    getHierarchyPathFromVariableName(variableName: string): string[];
    /**
     * Find variable name by nodeId in the hierarchy map
     *
     * @param nodeId - The OPC UA node ID to search for
     * @param variableHierarchy - The hierarchy map to search in
     * @returns Variable name if found, undefined otherwise
     * @public For debugging and external tools that need reverse node ID lookups
     */
    findVariableNameByNodeId(nodeId: string, variableHierarchy: Map<string, {
        nodeId: string;
        path: string[];
    }>): string | undefined;
    /**
     * Remove monitored item by nodeId
     */
    private removeMonitoredItemByNodeId;
    /**
     * Check if two arrays are equal
     */
    private arraysEqual;
    /**
     * Get subscription information
     */
    getSubscription(name: string): SubscriptionInfo | undefined;
    /**
     * Get all subscriptions
     */
    getAllSubscriptions(): Map<string, SubscriptionInfo>;
    /**
     * Recover all subscriptions after reconnection
     * This recreates all subscriptions and monitored items with the new session
     */
    recoverAllSubscriptions(): Promise<void>;
    /**
     * Clear all subscriptions without making API calls
     * Used during reconnection when old subscriptions are invalid
     */
    clearAllSubscriptions(): void;
    /**
     * Add a monitored item to a subscription
     */
    private addMonitoredItem;
    /**
     * Add multiple monitored items to a subscription in a batch operation
     */
    private addMultipleMonitoredItems;
    /**
     * Remove a monitored item from a subscription
     */
    private removeMonitoredItem;
    /**
     * Remove multiple monitored items from a subscription in a batch operation
     */
    private removeMultipleMonitoredItems;
    /**
     * Setup WebSocket message handler for subscription notifications
     */
    private setupWebSocketHandler;
    /**
     * Setup WebSocket notification handling
     */
    private setupWebSocketNotifications;
    /**
     * Handle incoming data notification from WebSocket
     */
    private handleDataNotification;
    /**
     * Map OPC UA status code to quality string
     */
    private mapQualityCode;
}
export {};
//# sourceMappingURL=subscription-manager.d.ts.map