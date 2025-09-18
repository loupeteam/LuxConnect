import { ConnectionConfig, ConnectionState, ConnectionStateHandler, ErrorHandler, ErrorPolicy, OpcuaValue, OpcuaObject } from './types.js';
/**
 * Read group configuration options (similar to lux.js)
 */
export interface ReadGroupOptions {
    publishingInterval?: number;
    samplingInterval?: number;
    maxNotificationsPerPublish?: number;
    priority?: number;
    enabled?: boolean;
}
/**
 * Variable options when adding to read groups
 */
export interface VariableOptions {
    namespace?: string;
    nodeId?: string;
    readGroup?: string;
}
/**
 * OPC UA Machine class implementing lux.js patterns
 * Provides direct property access and automatic subscription management
 */
export declare class OpcuaMachine {
    private connection;
    private variableManager;
    private subscriptionManager;
    private defaultNamespace;
    private defaultApplication;
    private defaultTask;
    private readGroups;
    private subscriptionUpdateTimers;
    private subscriptionHandles?;
    [key: string]: OpcuaValue;
    constructor(config: ConnectionConfig);
    /**
     * Connect to the OPC UA server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the OPC UA server
     */
    disconnect(): Promise<void>;
    /**
     * Change the logged-in user for the current session
     * @param username New username (or undefined for anonymous)
     * @param password New password (optional)
     */
    changeUser(username?: string, password?: string): Promise<void>;
    /**
     * Get current session information including username and roles
     */
    getSessionInfo(): import("./types.js").SessionInfo | null;
    /**
     * Check if currently connected
     */
    get isConnected(): boolean;
    /**
     * Get current connection state
     */
    get connectionState(): ConnectionState;
    /**
     * Add connection state change handler
     */
    onConnectionStateChanged(handler: ConnectionStateHandler): void;
    /**
     * Add error handler
     */
    onError(handler: ErrorHandler): void;
    /**
     * Manually trigger subscription recovery
     * Useful for testing or when connection issues are detected
     */
    recoverSubscriptions(): Promise<void>;
    /**
     * Add a variable to cyclic reading (lux.js style)
     * @param varName Variable name (will use default namespace if no prefix)
     * @param callback Optional callback when value changes
     * @param options Optional configuration
     */
    initCyclicRead(varName: string, callback?: (value: OpcuaValue) => void, options?: VariableOptions): void;
    /**
     * Add a variable to a specific read group (lux.js style)
     */
    initCyclicReadGroup(readGroupName: string, varName: string, callback?: (value: OpcuaValue) => void, options?: VariableOptions): void;
    /**
     * Set read group enabled/disabled (lux.js style)
     */
    setReadGroupEnable(readGroupName: string, enabled: boolean): void;
    /**
     * Configure read group options (lux.js style)
     */
    configureReadGroup(readGroupName: string, options: ReadGroupOptions): void;
    /**
     * Read a variable once (async with await)
     * No registration required - automatically resolves NodeId
     */
    readVariable(varName: string): Promise<OpcuaValue>;
    /**
     * Write a variable once (async with await)
     * No registration required - automatically resolves NodeId
     */
    writeVariable(varName: string, value: OpcuaValue): Promise<void>;
    /**
     * Set default namespace for variables
     */
    setDefaultNamespace(namespace: string): void;
    /**
     * Set default application/module for variables without explicit application
     */
    setDefaultApplication(application: string): void;
    /**
     * Set default task for variables without explicit task
     */
    setDefaultTask(task: string): void;
    /**
     * Set error handling policy for read/write operations
     * @param policy 'default' - log errors and return cached values (won't crash), 'strict' - throw unhandled rejections (will crash), 'silent' - return cached values without logging
     */
    setErrorPolicy(policy: ErrorPolicy): void;
    /**
     * Add change handler for a variable
     */
    onChange(varName: string, callback: (value: OpcuaValue) => void): void;
    /**
     * Create a subscription to a single variable (uses existing read group infrastructure)
     * Returns a subscription handle that can be used with unsubscribe()
     *
     * This is a convenience API that uses the existing optimized read group system.
     * Variables with the same sampling interval will be grouped together for efficiency.
     *
     * @param varName Variable name to subscribe to
     * @param callback Callback function to call when value changes
     * @param samplingInterval Optional sampling interval in ms (default: 100ms for fast updates)
     * @returns Subscription handle for unsubscribing
     */
    subscribe(varName: string, callback: (value: OpcuaValue) => void, samplingInterval?: number): Promise<string>;
    /**
     * Remove a subscription created with subscribe()
     *
     * This removes the variable from the read group and cleans up the callback.
     * If this was the last subscription to the variable, it will be removed from
     * the read group entirely. The read group infrastructure handles optimization.
     *
     * @param subscriptionHandle The handle returned by subscribe()
     */
    unsubscribe(subscriptionHandle: string): Promise<void>;
    /**
     * Get a value from the global state hierarchy with intelligent fallback
     * Supports: machine.varname (checks global first, then tasks), machine.task.varname, etc.
     */
    getFromGlobalState(path: string): OpcuaValue;
    /**
     * Get all available app modules
     */
    getAppModules(): string[];
    /**
     * Get all scopes (tasks + AsGlobalPV) for an app module
     */
    getScopes(appModule?: string): string[];
    /**
     * Get all variables in a specific scope
     */
    getVariablesInScope(appModule?: string, scope?: string): string[];
    /**
     * Get the complete global state (for debugging and introspection)
     */
    getGlobalState(): OpcuaObject;
    /**
     * Create a proxy for accessing scopes within an app module
     * Handles: machine.AppModule.ScopeName
     */
    private createScopeProxy;
    /**
     * Create a proxy for accessing variables within a specific scope
     * Handles: machine.ScopeName.VarName or machine.AppModule.ScopeName.VarName
     * Also supports: machine.ScopeName (returns all variables in scope)
     */
    private createVariableProxy;
    private buildNodeId;
    private ensureReadGroup;
    private createOrUpdateSubscription;
    private doCreateOrUpdateSubscription;
    private deleteSubscription;
    private setupWebSocketHandler;
}
//# sourceMappingURL=opcua-machine.d.ts.map