import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { SubscriptionManager } from './subscription-manager.js';
import { VariablePathParser } from './variable-hierarchy.js';
import { 
  ConnectionConfig, 
  ConnectionState, 
  ConnectionStateHandler, 
  ErrorHandler,
  ErrorPolicy 
} from './types.js';

/**
 * Read group configuration options (similar to lux.js)
 */
export interface ReadGroupOptions {
  publishingInterval?: number;      // How often to poll (ms)
  samplingInterval?: number;        // How often each variable is sampled (ms)
  maxNotificationsPerPublish?: number;
  priority?: number;
  enabled?: boolean;
}

/**
 * Variable options when adding to read groups
 */
export interface VariableOptions {
  namespace?: string;               // Override default namespace
  nodeId?: string;                 // Full nodeId if needed
  readGroup?: string;              // Which read group to use
}

/**
 * Subscription handle tracking info
 */
interface SubscriptionHandleInfo {
  varName: string;
  callback: (value: any) => void;
  readGroup: string;
}

/**
 * OPC UA Machine class implementing lux.js patterns
 * Provides direct property access and automatic subscription management
 */
export class OpcuaMachine {
  private connection: OpcuaConnection;
  private variableManager: VariableManager;
  private subscriptionManager: SubscriptionManager;
  private defaultNamespace: string = 'ns=5;s=';
  private defaultApplication: string = ''; // Empty means use parser default
  private defaultTask: string = 'AsGlobalPV'; // Default task for variables without explicit task
  private readGroups = new Map<string, ReadGroupInfo>();
  private subscriptionUpdateTimers = new Map<string, NodeJS.Timeout>();
  private subscriptionHandles?: Map<string, SubscriptionHandleInfo>;

  // Index signature for dynamic property access (lux.js style)
  [key: string]: any;

  constructor(config: ConnectionConfig) {
    this.connection = new OpcuaConnection(config);
    this.variableManager = new VariableManager(this.connection);
    this.subscriptionManager = new SubscriptionManager(this.connection, this.variableManager);
    
    // Initialize VariableManager with current defaults
    this.variableManager.setDefaultNamespace(this.defaultNamespace);
    this.variableManager.setDefaultApplication(this.defaultApplication);
    this.variableManager.setDefaultTask(this.defaultTask);
    
    // Create default read group
    this.readGroups.set('default', {
      name: 'default',
      options: {
        publishingInterval: 100,
        samplingInterval: 100,
        enabled: true
      },
      variables: new Set(),
      subscriptionId: null
    });

    this.setupWebSocketHandler();
    
    // Return proxy instead of this for property access
    return new Proxy(this, {
      get: (target, prop: string | symbol) => {
        // If it's a known method/property, return it normally
        if (typeof prop === 'symbol' || prop in target) {
          return (target as any)[prop];
        }
        
        const propStr = prop.toString();
        
        // First, try to get registered variable value by exact name
        const variable = target.variableManager.getVariable(propStr);
        if (variable !== undefined) {
          return variable.value;
        }
        
        // Check if this could be a simple variable access (machine.MyVar)
        const simpleVarValue = target.getFromGlobalState(propStr);
        if (simpleVarValue !== undefined && typeof simpleVarValue !== 'object') {
          // It's a primitive value, return it
          return simpleVarValue;
        }
        
        // If it's an object (scope/app module), return a scope proxy or the data itself
        const globalState = target.variableManager.getGlobalState();
        
        // Check if propStr is an app module
        if (globalState[propStr]) {
          return target.createScopeProxy(propStr);
        }
        
        // Check if propStr is a scope name in any app module
        for (const appModule of Object.keys(globalState)) {
          if (globalState[appModule][propStr]) {
            // Return the scope data wrapped in a proxy for individual variable access
            return target.createVariableProxy(appModule, propStr, globalState[appModule][propStr]);
          }
        }
        //If it isn't found, return the simpleVarValue, it MIGHT be an object, or could be undefined
        return simpleVarValue;
      },
      
      set: (target, prop: string | symbol, value: any) => {
        // If it's a known property, set it normally
        if (typeof prop === 'symbol' || prop in target || prop.toString().startsWith('_')) {
          (target as any)[prop] = value;
          return true;
        }
        
        //TODO: This probably doesn't work for most variables since it doesn't handle scopes or tasks
        // Remove?
        // If it's a variable name, write it via VariableManager
        if (typeof value !== 'function') {
          target.writeVariable(prop.toString(), value).catch(console.error);
          return true;
        }
        
        return false;
      }
    });
  }

  // Connection management (lux.js style)
  
  /**
   * Connect to the OPC UA server
   */
  public async connect(): Promise<void> {
    // TODO: Add connection retry logic with exponential backoff
    // TODO: Add connection timeout handling
    await this.connection.connect();
    
    // All variables should already be registered from initCyclicRead calls
    // Just create subscriptions for read groups that have variables
    // TODO: Consider parallelizing subscription creation for better performance
    for (const [name, group] of this.readGroups) {
      if (group.variables.size > 0 && group.options.enabled) {
        await this.createOrUpdateSubscription(name);
      }
    }
  }

  /**
   * Disconnect from the OPC UA server
   */
  public async disconnect(): Promise<void> {
    // Clear any pending subscription update timers
    for (const timer of this.subscriptionUpdateTimers.values()) {
      clearTimeout(timer);
    }
    this.subscriptionUpdateTimers.clear();
    
    await this.connection.disconnect();
  }

  /**
   * Change the logged-in user for the current session
   * @param username New username (or undefined for anonymous)
   * @param password New password (optional)
   */
  public async changeUser(username?: string, password?: string): Promise<void> {
    await this.connection.changeUser(username, password);
  }

  /**
   * Get current session information including username and roles
   */
  public getSessionInfo() {
    return this.connection.getSessionInfo();
  }

  /**
   * Check if currently connected
   */
  public get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /**
   * Get current connection state
   */
  public get connectionState(): ConnectionState {
    return this.connection.state;
  }

  /**
   * Add connection state change handler
   */
  public onConnectionStateChanged(handler: ConnectionStateHandler): void {
    this.connection.onConnectionStateChanged(handler);
  }

  /**
   * Add error handler
   */
  public onError(handler: ErrorHandler): void {
    this.connection.onError(handler);
  }

  /**
   * Manually trigger subscription recovery
   * Useful for testing or when connection issues are detected
   */
  public async recoverSubscriptions(): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Cannot recover subscriptions - not connected');
    }
    
    console.log('Manually triggering subscription recovery...');
    await this.subscriptionManager.recoverAllSubscriptions();
    console.log('Manual subscription recovery completed');
  }

  // Variable management (lux.js style)

  /**
   * Add a variable to cyclic reading (lux.js style)
   * @param varName Variable name (will use default namespace if no prefix)
   * @param callback Optional callback when value changes
   * @param options Optional configuration
   */
  public initCyclicRead(varName: string, callback?: (value: any) => void, options: VariableOptions = {}): void {
    const readGroup = options.readGroup || 'default';
    
    // Ensure read group exists
    this.ensureReadGroup(readGroup);
    
    // Build nodeId
    const nodeId = this.buildNodeId(varName, options);
    
    // Register variable immediately - no need to wait for connection
    // This will validate the variable name and add it to the hierarchy with default values
    if (!this.variableManager.getVariable(varName)) {
      try {
        this.variableManager.registerVariable(varName, nodeId);
      } catch (error) {
        console.warn(`Failed to register variable ${varName}:`, error);
        // TODO: Add error handling strategy - should we throw or continue?
        // TODO: Consider collecting failed registrations for retry after connection
      }
    }
    
    // Check if this is a new variable for the read group
    const group = this.readGroups.get(readGroup)!;
    const isNewVariable = !group.variables.has(varName);
    
    // Add to read group
    group.variables.add(varName);
    
    // Set up callback if provided
    if (callback) {
      // Register callback immediately - we'll handle it even if variable registration is pending
      this.onChange(varName, callback);
    }
    
    // Update subscription only if this is a new variable and we're connected
    if (this.isConnected && group.options.enabled && isNewVariable) {
      this.createOrUpdateSubscription(readGroup);
    }
  }

  /**
   * Add a variable to a specific read group (lux.js style)
   */
  public initCyclicReadGroup(readGroupName: string, varName: string, callback?: (value: any) => void, options: VariableOptions = {}): void {
    this.initCyclicRead(varName, callback, { ...options, readGroup: readGroupName });
  }

  /**
   * Set read group enabled/disabled (lux.js style)
   */
  public setReadGroupEnable(readGroupName: string, enabled: boolean): void {
    const group = this.readGroups.get(readGroupName);
    if (group) {
      group.options.enabled = enabled;
      
      if (this.isConnected) {
        if (enabled) {
          this.createOrUpdateSubscription(readGroupName);
        } else {
          this.deleteSubscription(readGroupName);
        }
      }
    }
  }

  /**
   * Configure read group options (lux.js style)
   */
  public configureReadGroup(readGroupName: string, options: ReadGroupOptions): void {
    this.ensureReadGroup(readGroupName);
    const group = this.readGroups.get(readGroupName)!;
    
    // Update options
    Object.assign(group.options, options);
    
    // If connected and enabled, recreate subscription with new options
    if (this.isConnected && group.options.enabled && group.variables.size > 0) {
      this.createOrUpdateSubscription(readGroupName);
    }
  }

  /**
   * Read a variable once (async with await)
   * No registration required - automatically resolves NodeId
   */
  public async readVariable(varName: string): Promise<any> {
    // VariableManager already has current defaults - no need to set them again
    return await this.variableManager.readValue(varName);
  }

  /**
   * Write a variable once (async with await)
   * No registration required - automatically resolves NodeId
   */
  public async writeVariable(varName: string, value: any): Promise<void> {
    // VariableManager already has current defaults - no need to set them again
    await this.variableManager.writeValue(varName, value);
  }

  /**
   * Set default namespace for variables
   */
  public setDefaultNamespace(namespace: string): void {
    this.defaultNamespace = namespace.endsWith(';s=') ? namespace : namespace + ';s=';
    // Automatically update VariableManager
    this.variableManager.setDefaultNamespace(this.defaultNamespace);
  }

  /**
   * Set default application/module for variables without explicit application
   */
  public setDefaultApplication(application: string): void {
    this.defaultApplication = application;
    // Automatically update VariableManager
    this.variableManager.setDefaultApplication(this.defaultApplication);
  }

  /**
   * Set default task for variables without explicit task
   */
  public setDefaultTask(task: string): void {
    this.defaultTask = task;
    // Automatically update VariableManager
    this.variableManager.setDefaultTask(this.defaultTask);
  }

  /**
   * Set error handling policy for read/write operations
   * @param policy 'default' - log errors and return cached values (won't crash), 'strict' - throw unhandled rejections (will crash), 'silent' - return cached values without logging
   */
  public setErrorPolicy(policy: ErrorPolicy): void {
    this.variableManager.setErrorPolicy(policy);
  }

  /**
   * Add change handler for a variable
   */
  public onChange(varName: string, callback: (value: any) => void): void {
    // Delegate to VariableManager
    this.variableManager.onChange(varName, (event) => {
      callback(event.value);
    });
  }

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
  public async subscribe(varName: string, callback: (value: any) => void, samplingInterval: number = 100): Promise<string> {
    // Generate unique subscription handle for this variable+callback combination
    const subscriptionHandle = `${varName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create read group name based on sampling interval to group variables with same rate
    const readGroupName = `subscriptions_${samplingInterval}ms`;
    
    // Ensure we have a read group for this sampling interval
    if (!this.readGroups.has(readGroupName)) {
      this.configureReadGroup(readGroupName, {
        publishingInterval: samplingInterval,  // Use requested sampling interval
        samplingInterval: samplingInterval,    // Keep both in sync
        maxNotificationsPerPublish: 20,
        priority: 10,                          // Higher priority than default groups
        enabled: true
      });
    }
    
    // Track this subscription handle for cleanup
    if (!this.subscriptionHandles) {
      this.subscriptionHandles = new Map();
    }
    this.subscriptionHandles.set(subscriptionHandle, {
      varName,
      callback,
      readGroup: readGroupName
    });
    
    // Add variable to the appropriate read group using existing infrastructure
    this.initCyclicRead(varName, callback, { readGroup: readGroupName });
    
    return subscriptionHandle;
  }

  /**
   * Remove a subscription created with subscribe()
   * 
   * This removes the variable from the read group and cleans up the callback.
   * If this was the last subscription to the variable, it will be removed from
   * the read group entirely. The read group infrastructure handles optimization.
   * 
   * @param subscriptionHandle The handle returned by subscribe()
   */
  public async unsubscribe(subscriptionHandle: string): Promise<void> {
    if (!this.subscriptionHandles) {
      throw new Error(`Subscription handle '${subscriptionHandle}' not found`);
    }
    
    const subscription = this.subscriptionHandles.get(subscriptionHandle);
    if (!subscription) {
      throw new Error(`Subscription handle '${subscriptionHandle}' not found`);
    }
    
    const { varName, readGroup } = subscription;
    
    // Remove the callback from the variable
    // Note: VariableManager doesn't currently support removing specific callbacks,
    // so we'll need to enhance this. For now, we'll remove the variable from the read group
    // if no other subscriptions exist for it.
    
    // Remove this handle from tracking
    this.subscriptionHandles.delete(subscriptionHandle);
    
    // Check if there are other subscriptions to this variable
    const hasOtherSubscriptions = Array.from(this.subscriptionHandles.values())
      .some((sub: SubscriptionHandleInfo) => sub.varName === varName);
    
    if (!hasOtherSubscriptions) {
      // Remove variable from read group
      const group = this.readGroups.get(readGroup);
      if (group) {
        group.variables.delete(varName);
        
        // Update the subscription if we're connected
        if (this.isConnected && group.options.enabled) {
          await this.createOrUpdateSubscription(readGroup);
        }
      }
    }
  }

  /**
   * Get a value from the global state hierarchy with intelligent fallback
   * Supports: machine.varname (checks global first, then tasks), machine.task.varname, etc.
   */
  public getFromGlobalState(path: string): any {
    const globalState = this.variableManager.getGlobalState();
    const pathComponents = path.split('.');
    
    // If single component (e.g., "MyVar"), try intelligent lookup
    if (pathComponents.length === 1) {
      const varName = pathComponents[0];
      
      // First check all app modules for AsGlobalPV scope
      for (const appModule of Object.keys(globalState)) {
        const asGlobalPV = globalState[appModule]?.AsGlobalPV?.[varName];
        if (asGlobalPV !== undefined) {
          return asGlobalPV;
        }
      }
      
      // If not found in global scope, check all tasks in all app modules
      for (const appModule of Object.keys(globalState)) {
        for (const scope of Object.keys(globalState[appModule] || {})) {
          if (scope !== 'AsGlobalPV') { // Already checked global
            const taskVar = globalState[appModule][scope]?.[varName];
            if (taskVar !== undefined) {
              return taskVar;
            }
          }
        }
      }
      
      return undefined;
    }
    
    // For multi-component paths, navigate directly
    let current = globalState;
    for (const component of pathComponents) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      current = current[component];
    }
    
    return current;
  }

  /**
   * Get all available app modules
   */
  public getAppModules(): string[] {
    const globalState = this.variableManager.getGlobalState();
    return Object.keys(globalState).filter(key => key !== '_default');
  }

  /**
   * Get all scopes (tasks + AsGlobalPV) for an app module
   */
  public getScopes(appModule: string = '_default'): string[] {
    const globalState = this.variableManager.getGlobalState();
    const moduleData = globalState[appModule];
    return moduleData ? Object.keys(moduleData) : [];
  }

  /**
   * Get all variables in a specific scope
   */
  public getVariablesInScope(appModule: string = '_default', scope: string = 'AsGlobalPV'): string[] {
    const globalState = this.variableManager.getGlobalState();
    const scopeData = globalState[appModule]?.[scope];
    return scopeData ? Object.keys(scopeData) : [];
  }

  /**
   * Get the complete global state (for debugging and introspection)
   */
  public getGlobalState(): any {
    return this.variableManager.getGlobalState();
  }

  /**
   * Create a proxy for accessing scopes within an app module
   * Handles: machine.AppModule.ScopeName
   */
  private createScopeProxy(appModule: string): any {
    const target = this;
    return new Proxy({}, {
      get: (_obj, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        
        const globalState = target.variableManager.getGlobalState();
        const scopeData = globalState[appModule]?.[prop];
        
        if (scopeData) {
          // Return a proxy that can access individual variables OR return the whole scope
          return target.createVariableProxy(appModule, prop, scopeData);
        }
        
        return undefined;
      }
    });
  }

  /**
   * Create a proxy for accessing variables within a specific scope
   * Handles: machine.ScopeName.VarName or machine.AppModule.ScopeName.VarName
   * Also supports: machine.ScopeName (returns all variables in scope)
   */
  private createVariableProxy(appModule: string, scope: string, scopeData?: any): any {
    const target = this;
    const data = scopeData || target.variableManager.getGlobalState()[appModule]?.[scope];
    
    if (!data) return undefined;
    
    // TODO: Consider caching proxy objects to improve performance
    // TODO: Add support for nested object access beyond 3 levels
    return new Proxy(data, {
      get: (obj, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        
        // If the property exists in the scope data, return it
        if (prop in obj) {
          return obj[prop];
        }
        
        return undefined;
      },
      
      // Allow enumeration of properties
      ownKeys: (obj) => {
        return Object.keys(obj);
      },
      
      getOwnPropertyDescriptor: (obj, prop) => {
        if (prop in obj) {
          return {
            enumerable: true,
            configurable: true,
            value: obj[prop]
          };
        }
        return undefined;
      }
    });
  }

  // Direct property access implementation (lux.js style)
  
  // Private implementation methods

  private buildNodeId(varName: string, options: VariableOptions): string {
    // Pass instance-specific defaults and per-call options to the centralized method
    const buildOptions: { 
      namespace?: string; 
      nodeId?: string; 
      defaultApplication?: string; 
      defaultTask?: string; 
    } = {
      namespace: options.namespace || this.defaultNamespace,
      defaultApplication: this.defaultApplication,
      defaultTask: this.defaultTask
    };
    
    if (options.nodeId) {
      buildOptions.nodeId = options.nodeId;
    }
    
    return VariablePathParser.buildNodeId(varName, buildOptions);
  }

  private ensureReadGroup(name: string): void {
    if (!this.readGroups.has(name)) {
      this.readGroups.set(name, {
        name,
        options: {
          publishingInterval: 1000,
          samplingInterval: 1000,
          enabled: true
        },
        variables: new Set(),
        subscriptionId: null
      });
    }
  }

  private async createOrUpdateSubscription(readGroupName: string): Promise<void> {
    // Debounce subscription updates to avoid race conditions
    const existingTimer = this.subscriptionUpdateTimers.get(readGroupName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.subscriptionUpdateTimers.delete(readGroupName);
      await this.doCreateOrUpdateSubscription(readGroupName);
    }, 100); // 100ms debounce

    this.subscriptionUpdateTimers.set(readGroupName, timer);
  }

  private async doCreateOrUpdateSubscription(readGroupName: string): Promise<void> {
    const group = this.readGroups.get(readGroupName);
    if (!group || !group.options.enabled || group.variables.size === 0) {
      return;
    }

    try {
      // Delete existing subscription if it exists
      if (group.subscriptionId !== null) {
        await this.deleteSubscription(readGroupName);
      }

      // All variables should already be registered from initCyclicRead calls
      // No need to check pendingVariables since registration happens immediately

      // Create subscription via SubscriptionManager
      const subscriptionOptions = {
        publishingInterval: group.options.publishingInterval || 1000,
        maxNotificationsPerPublish: group.options.maxNotificationsPerPublish || 10,
        priority: group.options.priority || 0,
        lifetimeCount: 3000,
        maxKeepAliveCount: 10
      };

      const subscriptionName = await this.subscriptionManager.createOrUpdateSubscription(readGroupName, subscriptionOptions);
      const subscriptionInfo = this.subscriptionManager.getSubscription(subscriptionName);
      group.subscriptionId = subscriptionInfo?.subscriptionId || null;

      // Add all variables to the subscription
      for (const varName of group.variables) {
        try {
          await this.subscriptionManager.addVariable(readGroupName, varName);
        } catch (error) {
          console.warn(`Failed to add variable ${varName} to subscription:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to create/update subscription '${readGroupName}':`, error);
    }
  }

  private async deleteSubscription(readGroupName: string): Promise<void> {
    const group = this.readGroups.get(readGroupName);
    if (!group || group.subscriptionId === null) {
      return;
    }

    try {
      await this.subscriptionManager.deleteSubscription(readGroupName);
    } catch (error) {
      console.warn(`Failed to delete subscription for read group '${readGroupName}':`, error);
    }

    group.subscriptionId = null;
  }

  private setupWebSocketHandler(): void {
    // WebSocket notifications are now handled by SubscriptionManager
    // No need for additional setup here since SubscriptionManager will
    // automatically update VariableManager when notifications arrive
    
    // Monitor connection state for subscription recovery
    this.connection.onConnectionStateChanged(async (state) => {
      if (state === 'connected') {
        // Check if this is a reconnection (we had subscriptions before)
        const allSubscriptions = this.subscriptionManager.getAllSubscriptions();
        if (allSubscriptions.size > 0) {
          console.log('Connection restored - recovering subscriptions...');
          try {
            await this.subscriptionManager.recoverAllSubscriptions();
            console.log('✅ Subscription recovery completed');
          } catch (error) {
            console.error('❌ Subscription recovery failed:', error);
          }
        }
      } else if (state === 'reconnecting') {
        console.log('Connection lost - subscriptions will be recovered after reconnection');
      }
    });
  }
}

interface ReadGroupInfo {
  name: string;
  options: ReadGroupOptions;
  variables: Set<string>;
  subscriptionId: number | null;
}
