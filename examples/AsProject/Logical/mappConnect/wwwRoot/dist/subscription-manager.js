import { VariablePathParser } from './variable-hierarchy.js';
/**
 * Subscription manager for real-time OPC UA variable monitoring
 * Handles OPC UA subscriptions and integrates with WebSocket notifications
 */
export class SubscriptionManager {
    connection;
    variableManager;
    subscriptions = new Map();
    clientHandleCounter = 1;
    clientHandleMap = new Map();
    constructor(connection, variableManager) {
        this.connection = connection;
        this.variableManager = variableManager;
        this.setupWebSocketHandler();
    }
    /**
     * Create a named subscription (lux.js style)
     */
    async createSubscription(name, options = {}) {
        if (this.subscriptions.has(name)) {
            throw new Error(`Subscription '${name}' already exists`);
        }
        return this.doCreateSubscription(name, options);
    }
    /**
     * Create or update a named subscription (handles existing subscriptions gracefully)
     */
    async createOrUpdateSubscription(name, options = {}) {
        // If subscription exists, delete it first
        if (this.subscriptions.has(name)) {
            await this.deleteSubscription(name);
        }
        return this.doCreateSubscription(name, options);
    }
    /**
     * Internal method to create a subscription
     */
    async doCreateSubscription(name, options = {}) {
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
        const subscriptionInfo = {
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
    async deleteSubscription(name) {
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
     *
     * Note: All variables in a subscription will use the subscription's publishingInterval
     * as their samplingInterval. If you need different sampling rates, create separate
     * subscriptions with different intervals.
     */
    async addVariable(subscriptionName, variableName, options = {}) {
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
            console.warn(`Warning: Variable '${variableName}' samplingInterval (${options.samplingInterval}ms) differs from subscription '${subscriptionName}' publishingInterval (${subscription.parameters.publishingInterval}ms). All variables in a subscription should use the same rate. Consider using a separate subscription for different rates.`);
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
    async removeVariable(subscriptionName, variableName) {
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
    async consolidateSubscription(subscription) {
        // Build hierarchy map for THIS subscription's variables only
        const subscriptionHierarchy = new Map();
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
        const currentlyMonitored = new Set();
        for (const [, monitoredItem] of subscription.monitoredItems) {
            currentlyMonitored.add(monitoredItem.nodeId);
        }
        // Calculate what needs to be added/removed
        const toAdd = Array.from(consolidatedNodeIds).filter(nodeId => !currentlyMonitored.has(nodeId));
        const toRemove = Array.from(currentlyMonitored).filter(nodeId => !consolidatedNodeIds.has(nodeId));
        // Use batch operations for efficiency when dealing with multiple items
        if (toRemove.length > 1) {
            // Batch remove multiple monitored items
            await this.removeMultipleMonitoredItems(subscription, toRemove);
        }
        else {
            // Remove obsolete monitored items individually
            for (const nodeId of toRemove) {
                await this.removeMonitoredItemByNodeId(subscription, nodeId);
            }
        }
        if (toAdd.length > 1) {
            // Batch add multiple monitored items
            const batchItems = toAdd.map(nodeId => {
                const varName = this.findVariableNameByNodeId(nodeId, subscriptionHierarchy);
                return {
                    nodeId: nodeId,
                    ...(varName && { variableName: varName }),
                    options: {}
                };
            });
            await this.addMultipleMonitoredItems(subscription, batchItems);
        }
        else {
            // Add new monitored items individually
            for (const nodeId of toAdd) {
                // Find the variable name for this nodeId
                const varName = this.findVariableNameByNodeId(nodeId, subscriptionHierarchy);
                await this.addMonitoredItem(subscription, nodeId, {}, varName);
            }
        }
    }
    /**
     * Find optimal set of nodeIds to subscribe to based on hierarchy
     */
    findOptimalSubscriptionSet(variableHierarchy) {
        const result = new Set();
        const processed = new Set();
        // Sort variables by path depth (parents first)
        const sortedVars = Array.from(variableHierarchy.entries())
            .sort(([, a], [, b]) => a.path.length - b.path.length);
        for (const [varName, info] of sortedVars) {
            if (processed.has(varName))
                continue;
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
    hasParentInSet(path, resultSet, variableHierarchy) {
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
    markChildrenAsProcessed(parentPath, variableHierarchy, processed) {
        for (const [varName, info] of variableHierarchy) {
            if (this.isChildPath(parentPath, info.path)) {
                processed.add(varName);
            }
        }
    }
    /**
     * Check if childPath is a child of parentPath
     */
    isChildPath(parentPath, childPath) {
        if (childPath.length <= parentPath.length)
            return false;
        for (let i = 0; i < parentPath.length; i++) {
            if (parentPath[i] !== childPath[i])
                return false;
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
    getHierarchyPathFromVariableName(variableName) {
        try {
            // Use the proper VariablePathParser for consistent results
            const parsedPath = VariablePathParser.parse(variableName);
            // Convert VariablePath to simple hierarchy path for subscription consolidation
            // This represents the logical hierarchy depth for parent/child optimization
            const hierarchyParts = [];
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
        }
        catch (error) {
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
    findVariableNameByNodeId(nodeId, variableHierarchy) {
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
    async removeMonitoredItemByNodeId(subscription, nodeId) {
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
    arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length)
            return false;
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i])
                return false;
        }
        return true;
    }
    /**
     * Get subscription information
     */
    getSubscription(name) {
        return this.subscriptions.get(name);
    }
    /**
     * Get all subscriptions
     */
    getAllSubscriptions() {
        return new Map(this.subscriptions);
    }
    /**
     * Recover all subscriptions after reconnection
     * This recreates all subscriptions and monitored items with the new session
     */
    async recoverAllSubscriptions() {
        console.log('Recovering subscriptions after reconnection...');
        // Store current subscription configurations
        const subscriptionConfigs = [];
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
        console.log(`Recreating ${subscriptionConfigs.length} subscriptions...`);
        // Recreate each subscription
        for (const config of subscriptionConfigs) {
            try {
                console.log(`Recreating subscription: ${config.name}`);
                // Create the subscription
                await this.createSubscription(config.name, config.parameters);
                const subscription = this.subscriptions.get(config.name);
                if (!subscription) {
                    console.error(`Failed to find recreated subscription: ${config.name}`);
                    continue;
                }
                // Use individual operations for variable re-addition
                // (Batch operations would require complex nodeId resolution that's already handled in addVariable)
                for (const variableName of config.variables) {
                    try {
                        await this.addVariable(config.name, variableName);
                    }
                    catch (error) {
                        console.warn(`Failed to re-add variable ${variableName} to subscription ${config.name}:`, error);
                    }
                }
                console.log(`✅ Recreated subscription: ${config.name} with ${config.variables.size} variables`);
            }
            catch (error) {
                console.error(`Failed to recreate subscription ${config.name}:`, error);
            }
        }
        console.log('Subscription recovery completed');
    }
    /**
     * Clear all subscriptions without making API calls
     * Used during reconnection when old subscriptions are invalid
     */
    clearAllSubscriptions() {
        console.log('Clearing all subscription state...');
        this.subscriptions.clear();
        this.clientHandleMap.clear();
        this.clientHandleCounter = 1;
        console.log('Subscription state cleared');
    }
    /**
     * Add a monitored item to a subscription
     */
    async addMonitoredItem(subscription, nodeId, options = {}, variableName) {
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
        const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems`, {
            method: 'POST',
            body: JSON.stringify(monitoredItemParams)
        });
        const results = await response.json();
        if (!results || !results.monitoredItemId) {
            throw new Error(`Failed to create monitored item for ${nodeId}`);
        }
        const monitoredItemInfo = {
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
    async addMultipleMonitoredItems(subscription, items) {
        if (items.length === 0)
            return;
        console.log(`Adding ${items.length} monitored items in batch...`);
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
                url: `/`, // Relative URL within the monitoredItems context
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
            const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/$batch`, {
                method: 'POST',
                body: JSON.stringify({
                    requests: batchRequests
                })
            });
            const results = await response.json();
            if (results.responses && Array.isArray(results.responses)) {
                // Process batch results
                for (let i = 0; i < results.responses.length; i++) {
                    const response = results.responses[i];
                    const originalItem = monitoredItemsParams[i];
                    if (response.body && response.body.monitoredItemId) {
                        const monitoredItemInfo = {
                            monitoredItemId: response.body.monitoredItemId,
                            clientHandle: originalItem._metadata.clientHandle,
                            nodeId: originalItem._metadata.nodeId,
                            ...(originalItem._metadata.variableName && { variableName: originalItem._metadata.variableName })
                        };
                        subscription.monitoredItems.set(response.body.monitoredItemId, monitoredItemInfo);
                        this.clientHandleMap.set(originalItem._metadata.clientHandle, monitoredItemInfo);
                    }
                    else {
                        console.warn(`Failed to create monitored item for ${originalItem._metadata.nodeId}:`, response);
                    }
                }
                console.log(`✅ Batch add completed: ${results.responses.length} items processed`);
            }
        }
        catch (batchError) {
            // Fallback to individual operations if batch is not supported
            console.log('Batch operation not supported, falling back to individual operations...');
            for (const item of items) {
                try {
                    await this.addMonitoredItem(subscription, item.nodeId, item.options || {}, item.variableName);
                }
                catch (error) {
                    console.warn(`Failed to add monitored item ${item.nodeId}:`, error);
                }
            }
        }
    }
    /**
     * Remove a monitored item from a subscription
     */
    async removeMonitoredItem(subscription, nodeId) {
        let monitoredItemId;
        let clientHandle;
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
        await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/${monitoredItemId}`, {
            method: 'DELETE'
        });
        // Remove from local maps
        subscription.monitoredItems.delete(monitoredItemId);
        this.clientHandleMap.delete(clientHandle);
    }
    /**
     * Remove multiple monitored items from a subscription in a batch operation
     */
    async removeMultipleMonitoredItems(subscription, nodeIds) {
        if (nodeIds.length === 0)
            return;
        console.log(`Removing ${nodeIds.length} monitored items in batch...`);
        // Find monitored item IDs for the given node IDs
        const itemsToRemove = [];
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
            console.warn('No monitored items found for the given node IDs');
            return;
        }
        try {
            // Try batch delete operation using the correct mapp Connect batch format
            const batchRequests = itemsToRemove.map((item, index) => ({
                id: index,
                method: 'DELETE',
                url: `/${item.monitoredItemId}`, // Relative URL for the specific monitored item
                headers: {
                    'Content-Type': 'application/json'
                }
            }));
            await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/subscriptions/${subscription.subscriptionId}/monitoredItems/$batch`, {
                method: 'POST', // Batch operations are always POST
                body: JSON.stringify({
                    requests: batchRequests
                })
            });
            // Clean up local state
            for (const item of itemsToRemove) {
                subscription.monitoredItems.delete(item.monitoredItemId);
                this.clientHandleMap.delete(item.clientHandle);
            }
            console.log(`✅ Batch remove completed: ${itemsToRemove.length} items removed`);
        }
        catch (batchError) {
            // Fallback to individual operations if batch is not supported
            console.log('Batch delete not supported, falling back to individual operations...');
            for (const nodeId of nodeIds) {
                try {
                    await this.removeMonitoredItem(subscription, nodeId);
                }
                catch (error) {
                    console.warn(`Failed to remove monitored item ${nodeId}:`, error);
                }
            }
        }
    }
    /**
     * Setup WebSocket message handler for subscription notifications
     */
    setupWebSocketHandler() {
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
    setupWebSocketNotifications() {
        // Use the connection's message handler instead of direct WebSocket access
        // eslint-disable-next-line @typescript-eslint/no-explicit-any    
        this.connection.onMessage((message) => {
            if (message && message.DataNotifications && Array.isArray(message.DataNotifications)) {
                for (const dataNotification of message.DataNotifications) {
                    this.handleDataNotification(dataNotification);
                }
            }
        });
    }
    /**
     * Handle incoming data notification from WebSocket
     */
    handleDataNotification(dataNotification) {
        // Each dataNotification in the array contains the actual data value
        const monitoredItem = this.clientHandleMap.get(dataNotification.clientHandle);
        if (!monitoredItem)
            return;
        const timestamp = new Date(dataNotification.serverTimestamp || Date.now());
        const quality = this.mapQualityCode(dataNotification.status?.code || 0);
        // Update variable manager if this is a registered variable
        if (monitoredItem.variableName) {
            this.variableManager.updateVariableFromNotification(monitoredItem.nodeId, dataNotification.value, timestamp, quality);
        }
    }
    /**
     * Map OPC UA status code to quality string
     */
    mapQualityCode(statusCode) {
        switch (statusCode) {
            case 0: return 'good';
            case 0x40000000: return 'uncertain';
            case 0x80000000: return 'bad';
            default: return 'unknown';
        }
    }
}
//# sourceMappingURL=subscription-manager.js.map