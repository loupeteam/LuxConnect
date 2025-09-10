import { OpcuaConnection } from './connection.js';
import { 
  ConnectionConfig, 
  ConnectionState, 
  ConnectionStateHandler, 
  ErrorHandler 
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
 * OPC UA Machine class implementing lux.js patterns
 * Provides direct property access and automatic subscription management
 */
export class OpcuaMachine {
  private connection: OpcuaConnection;
  private defaultNamespace: string = 'ns=1;s=';
  private readGroups = new Map<string, ReadGroupInfo>();
  private variableMap = new Map<string, string>(); // varName -> nodeId
  private subscriptionMap = new Map<string, number>(); // readGroup -> subscriptionId
  private clientHandleMap = new Map<number, string>(); // clientHandle -> varName
  private clientHandleCounter = 1;

  // Direct property access storage (lux.js style)
  private _values = new Map<string, any>();
  private _callbacks = new Map<string, Array<(value: any) => void>>();

  // Index signature for dynamic property access (lux.js style)
  [key: string]: any;

  constructor(config: ConnectionConfig) {
    this.connection = new OpcuaConnection(config);
    
    // Create default read group
    this.readGroups.set('default', {
      name: 'default',
      options: {
        publishingInterval: 1000,
        samplingInterval: 1000,
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
        
        // If it's a variable name, return cached value
        if (target._values.has(prop)) {
          return target._values.get(prop);
        }
        
        return undefined;
      },
      
      set: (target, prop: string | symbol, value: any) => {
        // If it's a known property, set it normally
        if (typeof prop === 'symbol' || prop in target || prop.toString().startsWith('_')) {
          (target as any)[prop] = value;
          return true;
        }
        
        // If it's a variable name, write it
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
    await this.connection.connect();
    
    // Auto-create subscriptions for any existing read groups
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
    await this.connection.disconnect();
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
    
    // Store mapping
    this.variableMap.set(varName, nodeId);
    
    // Add to read group
    const group = this.readGroups.get(readGroup)!;
    group.variables.add(varName);
    
    // Set up callback if provided
    if (callback) {
      this.onChange(varName, callback);
    }
    
    // Initialize property access
    this._values.set(varName, undefined);
    
    // Update subscription if connected
    if (this.isConnected && group.options.enabled) {
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
   */
  public async readVariable(varName: string, options: VariableOptions = {}): Promise<any> {
    const nodeId = this.buildNodeId(varName, options);
    
    const response = await this.connection.apiRequest('/opcua/readValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: nodeId,
        attributeId: 13 // Value attribute
      })
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to read variable '${varName}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    const value = result.value?.value;
    
    // Update local cache
    this._values.set(varName, value);
    
    return value;
  }

  /**
   * Write a variable once (async with await)
   */
  public async writeVariable(varName: string, value: any, options: VariableOptions = {}): Promise<void> {
    const nodeId = this.buildNodeId(varName, options);
    
    const response = await this.connection.apiRequest('/opcua/writeValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: nodeId,
        attributeId: 13, // Value attribute
        value: {
          value: value,
          type: this.inferDataType(value)
        }
      })
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to write variable '${varName}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    // Update local cache
    this._values.set(varName, value);
  }

  /**
   * Set default namespace for variables
   */
  public setDefaultNamespace(namespace: string): void {
    this.defaultNamespace = namespace.endsWith(';s=') ? namespace : namespace + ';s=';
  }

  /**
   * Add change handler for a variable
   */
  public onChange(varName: string, callback: (value: any) => void): void {
    // Store callback - we'll implement this with a callback map
    const key = `${varName}_change`;
    if (!this._callbacks.has(key)) {
      this._callbacks.set(key, []);
    }
    this._callbacks.get(key)!.push(callback);
  }

  // Direct property access implementation (lux.js style)
  
  // Private implementation methods

  private buildNodeId(varName: string, options: VariableOptions): string {
    if (options.nodeId) {
      return options.nodeId;
    }
    
    // If varName already has namespace, use as-is
    if (varName.includes('ns=') || varName.includes('i=') || varName.includes('s=')) {
      return varName;
    }
    
    // Use custom namespace or default
    const namespace = options.namespace || this.defaultNamespace;
    return namespace + varName;
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
    const group = this.readGroups.get(readGroupName);
    if (!group || !group.options.enabled || group.variables.size === 0) {
      return;
    }

    // Delete existing subscription if it exists
    if (group.subscriptionId !== null) {
      await this.deleteSubscription(readGroupName);
    }

    // Create new subscription
    const subscriptionParams = {
      publishingInterval: group.options.publishingInterval || 1000,
      maxNotificationsPerPublish: group.options.maxNotificationsPerPublish || 10,
      priority: group.options.priority || 0,
      lifetimeCount: 3000,
      maxKeepAliveCount: 10,
      publishingEnabled: true
    };

    const response = await this.connection.apiRequest('/opcua/subscription', {
      method: 'POST',
      body: JSON.stringify(subscriptionParams)
    });

    const result = await response.json();
    
    if (!result.subscriptionId) {
      throw new Error(`Failed to create subscription for read group '${readGroupName}'`);
    }

    group.subscriptionId = result.subscriptionId;
    this.subscriptionMap.set(readGroupName, result.subscriptionId);

    // Add all variables to the subscription
    for (const varName of group.variables) {
      await this.addVariableToSubscription(result.subscriptionId, varName);
    }
  }

  private async deleteSubscription(readGroupName: string): Promise<void> {
    const group = this.readGroups.get(readGroupName);
    if (!group || group.subscriptionId === null) {
      return;
    }

    try {
      await this.connection.apiRequest(`/opcua/subscription/${group.subscriptionId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.warn(`Failed to delete subscription for read group '${readGroupName}':`, error);
    }

    group.subscriptionId = null;
    this.subscriptionMap.delete(readGroupName);
  }

  private async addVariableToSubscription(subscriptionId: number, varName: string): Promise<void> {
    const nodeId = this.variableMap.get(varName);
    if (!nodeId) return;

    const clientHandle = this.clientHandleCounter++;
    this.clientHandleMap.set(clientHandle, varName);

    const monitoredItemParams = {
      nodeId: nodeId,
      attributeId: 13, // Value attribute
      samplingInterval: 1000, // Could be configured per read group
      discardOldest: true,
      queueSize: 1,
      clientHandle: clientHandle
    };

    const response = await this.connection.apiRequest(
      `/opcua/subscription/${subscriptionId}/monitoredItems`, 
      {
        method: 'POST',
        body: JSON.stringify([monitoredItemParams])
      }
    );

    const results = await response.json();
    
    if (!results || results.length === 0 || !results[0].monitoredItemId) {
      throw new Error(`Failed to create monitored item for ${varName}`);
    }
  }

  private setupWebSocketHandler(): void {
    this.connection.onConnectionStateChanged((state) => {
      if (state === 'connected') {
        this.setupWebSocketNotifications();
      }
    });
  }

  private setupWebSocketNotifications(): void {
    // Set up message handler for WebSocket notifications
    this.connection.onMessage((message: any) => {
      if (message.type === 'DataNotification') {
        this.handleDataNotification(message);
      }
    });
  }

  private handleDataNotification(notification: any): void {
    if (!notification.dataValues) return;

    for (const dataValue of notification.dataValues) {
      const varName = this.clientHandleMap.get(dataValue.clientHandle);
      if (!varName) continue;

      const oldValue = this._values.get(varName);
      const newValue = dataValue.value;

      // Update cached value
      this._values.set(varName, newValue);

      // Call change callbacks if value actually changed
      if (oldValue !== newValue) {
        const callbacks = this._callbacks.get(`${varName}_change`);
        if (callbacks) {
          callbacks.forEach(callback => {
            try {
              callback(newValue);
            } catch (error) {
              console.error(`Callback error for ${varName}:`, error);
            }
          });
        }
      }
    }
  }

  private inferDataType(value: any): number {
    if (typeof value === 'boolean') return 1; // Boolean
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return 6; // Int32
      return 11; // Double
    }
    if (typeof value === 'string') return 12; // String
    return 24; // BaseDataType (generic)
  }
}

interface ReadGroupInfo {
  name: string;
  options: ReadGroupOptions;
  variables: Set<string>;
  subscriptionId: number | null;
}
