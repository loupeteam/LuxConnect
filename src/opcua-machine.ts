import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { SubscriptionManager } from './subscription-manager.js';
import { VariablePathParser } from './variable-hierarchy.js';
import { 
  ConnectionConfig, 
  ConnectionState, 
  ConnectionStateHandler, 
  ErrorHandler,
  ErrorPolicy,
  OpcuaValue,
  OpcuaObject,
  OpcuaVariable
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
  callback: (value: OpcuaValue) => void;
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
  [key: string]: OpcuaValue;

  constructor(config: ConnectionConfig) {
    this.connection = new OpcuaConnection(config);
    this.variableManager = new VariableManager(this.connection);
    this.subscriptionManager = new SubscriptionManager(this.connection, this.variableManager);
    
    // Initialize VariableManager with current defaults
    this.variableManager.setDefaultNamespace(this.defaultNamespace);
    this.variableManager.setDefaultApplication(this.defaultApplication);
    this.variableManager.setDefaultTask(this.defaultTask);
    if (config.taskNameMaxLength !== undefined) {
      this.variableManager.setTaskNameMaxLength(config.taskNameMaxLength);
    }
    
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
          return (target as unknown as Record<string | symbol, OpcuaValue>)[prop];
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
      
      set: (target, prop: string | symbol, value: OpcuaValue) => {
        // Allow setting known own properties (internal state, methods, etc.)
        if (typeof prop === 'symbol' || prop in target || prop.toString().startsWith('_')) {
          (target as unknown as Record<string | symbol, OpcuaValue>)[prop] = value;
          return true;
        }
        // Convenience: machine.MyVar = x writes the variable.
        // Note: only works for top-level variables — scoped paths (tasks, programs)
        // need machine.writeVariable('Program:Task.Var', x) instead.
        if (typeof value !== 'function') {
          target.writeVariable(prop.toString(), value).catch(console.error);
        }
        // Always return true — returning false throws TypeError in strict mode.
        return true;
      }
    });
  }

  // Connection management (lux.js style)
  
  /**
   * Connect to the OPC UA server
   */
  public async connect(): Promise<void> {
    await this.connection.connect();

    // All variables should already be registered from initCyclicRead calls
    // Just create subscriptions for read groups that have variables
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
   * Get the username of the currently authenticated user, or undefined if anonymous / not connected.
   */
  public getCurrentUser(): string | undefined {
    return this.connection.getSessionInfo()?.username;
  }

  /**
   * Register a handler that fires whenever the authenticated user changes (including on connect).
   * Returns an unsubscribe function.
   */
  public onUserChanged(handler: (username: string | undefined) => void): () => void {
    return this.connection.onUserChanged(handler);
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
  public initCyclicRead(varName: string, callback?: (value: OpcuaValue) => void, options: VariableOptions = {}): void {
    const readGroup = options.readGroup || 'default';
    
    // Ensure read group exists
    this.ensureReadGroup(readGroup);
    
    // Build nodeId
    const nodeId = this.buildNodeId(varName, options);
    
    // Register variable immediately - no need to wait for connection
    // This will validate the variable name and add it to the hierarchy with default values
    if (!this.variableManager.getVariable(varName)) {
      this.variableManager.registerVariable(varName, nodeId);
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
  public initCyclicReadGroup(readGroupName: string, varName: string, callback?: (value: OpcuaValue) => void, options: VariableOptions = {}): void {
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
  public async readVariable(varName: string): Promise<OpcuaValue> {
    // VariableManager already has current defaults - no need to set them again
    return await this.variableManager.readValue(varName);
  }

  /**
   * Write a variable once (async with await)
   * No registration required - automatically resolves NodeId
   */
  public async writeVariable(varName: string, value: OpcuaValue): Promise<void> {
    // VariableManager already has current defaults - no need to set them again
    await this.variableManager.writeValue(varName, value);
  }

  public value(varName: string): OpcuaValue {
    return this.getFromGlobalState(varName);
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
  public onChange(varName: string, callback: (value: OpcuaValue) => void): void {
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
  public async subscribe(varName: string, callback: (value: OpcuaValue) => void, samplingIntervalOrOptions: number | { samplingInterval?: number; publishingInterval?: number;[key: string]: unknown } = 100): Promise<string> {
    const samplingInterval = typeof samplingIntervalOrOptions === 'number'
      ? samplingIntervalOrOptions
      : (samplingIntervalOrOptions?.samplingInterval ?? samplingIntervalOrOptions?.publishingInterval ?? 100);

    // Generate unique subscription handle for this variable+callback combination
    const subscriptionHandle = `${varName}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
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
  public getFromGlobalState(path: string): OpcuaValue {
    const globalState = this.variableManager.getGlobalState();
    const pathComponents = path.replace(":",".").split('.');
    
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
    
    // For multi-component paths, navigate with scope checking
    let current = globalState;
    for (let i = 0; i < pathComponents.length; i++) {
      const component = pathComponents[i];
      
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      
      // If we can navigate directly, do so
      if (component in current) {
        current = current[component];
        continue;
      }
      
      // If direct navigation fails, check if this component is a scope name in any app module
      if (i === 0) { // First component might be a scope name
        let found = false;
        for (const appModule of Object.keys(globalState)) {
          if (globalState[appModule] && component in globalState[appModule]) {
            current = globalState[appModule][component];
            found = true;
            break;
          }
        }
        if (!found) {
          return undefined;
        }
      } else {
        // For subsequent components, navigate normally
        current = current[component];
      }
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
  public getGlobalState(): OpcuaObject {
    return this.variableManager.getGlobalState();
  }

  /**
   * Get all subscribed variables with their current value, timestamp, and quality.
   * quality: 'good' | 'uncertain' | 'bad' | 'unknown'
   */
  public getAllVariables(): Map<string, OpcuaVariable> {
    return this.variableManager.getAllVariables();
  }

  /**
   * Create a proxy for accessing scopes within an app module
   * Handles: machine.AppModule.ScopeName
   */
  private createScopeProxy(appModule: string): OpcuaObject {
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
  private createVariableProxy(appModule: string, scope: string, scopeData?: OpcuaValue): OpcuaObject | undefined {
    const target = this;
    const data = scopeData || target.variableManager.getGlobalState()[appModule]?.[scope];
    
    if (!data) return undefined;
    
    return new Proxy(data, {
      get: (obj, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;

        // If the property exists in the scope data, return it
        if (prop in obj) {
          return obj[prop];
        }

        return undefined;
      },

      set: (_obj, prop: string | symbol, value: OpcuaValue) => {
        if (typeof prop === 'string' && typeof value !== 'function') {
          // machine[task].myVar = x  →  writes  appModule::scope:myVar
          target.writeVariable(`${appModule}::${scope}:${prop}`, value).catch(console.error);
        }
        // Always return true — returning false throws TypeError in strict mode.
        return true;
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
    // Debounce subscription so that multiple calls in the same event loop tick are batched
    const existingTimer = this.subscriptionUpdateTimers.get(readGroupName);
    if (existingTimer) {
      return; // Update already scheduled
    }

    const timer = setTimeout(async () => {
      this.subscriptionUpdateTimers.delete(readGroupName);
      await this.doCreateOrUpdateSubscription(readGroupName);
    }, 0); //Add a 0 delay to batch multiple calls in the same event loop tick

    this.subscriptionUpdateTimers.set(readGroupName, timer);
  }

  private async doCreateOrUpdateSubscription(readGroupName: string): Promise<void> {
    const group = this.readGroups.get(readGroupName);
    if (!group || !group.options.enabled || group.variables.size === 0) {
      return;
    }

    try {
      const subscriptionOptions = {
        publishingInterval: group.options.publishingInterval || 1000,
        maxNotificationsPerPublish: group.options.maxNotificationsPerPublish || 10,
        priority: group.options.priority || 0,
        lifetimeCount: 3000,
        maxKeepAliveCount: 10
      };

      const variablesToAdd = Array.from(group.variables);
      const existingSubscription = this.subscriptionManager.getSubscription(readGroupName);

      if (existingSubscription) {
        // Update existing subscription by setting desired variables and consolidating
        console.log(`Updating existing subscription '${readGroupName}' from ${existingSubscription.desiredVariables.size} to ${variablesToAdd.length} variables`);
        
        // Clear current desired variables and set new ones
        existingSubscription.desiredVariables.clear();
        for (const varName of variablesToAdd) {
          existingSubscription.desiredVariables.add(varName);
        }
        
        // Trigger consolidation which will efficiently add/remove monitored items using batching
        await this.subscriptionManager.consolidateSubscription(existingSubscription);
        
        group.subscriptionId = existingSubscription.subscriptionId;
        console.log(`✅ Subscription '${readGroupName}' updated with ${variablesToAdd.length} variables`);
      } else {
        // Create new subscription
        console.log(`Creating new subscription '${readGroupName}' with ${variablesToAdd.length} variables`);
        
        // Create empty subscription first
        await this.subscriptionManager.createSubscription(readGroupName, subscriptionOptions);
        
        // Add all variables efficiently using the new batch method
        await this.subscriptionManager.addVariables(readGroupName, variablesToAdd);
        
        const subscriptionInfo = this.subscriptionManager.getSubscription(readGroupName);
        group.subscriptionId = subscriptionInfo?.subscriptionId || null;
        console.log(`✅ Subscription '${readGroupName}' created with ${variablesToAdd.length} variables`);
      }
    } catch (error) {
      // If the subscription was stale on the server (e.g. from a previous session that
      // disconnected mid-flight), delete it locally and retry once from scratch.
      const msg = (error as Error).message ?? '';
      if (msg.includes('not found on server')) {
        console.warn(`Subscription '${readGroupName}' was stale — deleting and retrying...`);
        try {
          await this.subscriptionManager.deleteSubscription(readGroupName);
        } catch {
          // Ignore — the subscription may already be gone server-side
        }
        try {
          await this.doCreateOrUpdateSubscription(readGroupName);
        } catch (retryError) {
          console.error(`Retry also failed for subscription '${readGroupName}':`, retryError);
        }
      } else {
        console.error(`Failed to create/update subscription '${readGroupName}':`, error);
      }
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
