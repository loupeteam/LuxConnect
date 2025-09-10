import { OpcuaConnection } from './connection.js';
import { VariableManager } from './variable-manager.js';
import { SubscriptionManager } from './subscription-manager.js';
import { 
  ConnectionConfig, 
  ConnectionState, 
  OpcuaVariable,
  SubscriptionOptions,
  MonitoredItemOptions,
  VariableChangeHandler,
  ConnectionStateHandler,
  ErrorHandler
} from './types.js';

/**
 * Main OPC UA client class implementing lux.js-style patterns
 * Provides a high-level API for OPC UA variable management with subscriptions
 */
export class OpcuaClient {
  private connection: OpcuaConnection;
  private variableManager: VariableManager;
  private subscriptionManager: SubscriptionManager;

  constructor(config: ConnectionConfig) {
    this.connection = new OpcuaConnection(config);
    this.variableManager = new VariableManager(this.connection);
    this.subscriptionManager = new SubscriptionManager(this.connection, this.variableManager);
  }

  // Connection management
  
  /**
   * Connect to the OPC UA server
   */
  public async connect(): Promise<void> {
    await this.connection.connect();
  }

  /**
   * Disconnect from the OPC UA server
   */
  public async disconnect(): Promise<void> {
    await this.connection.disconnect();
  }

  /**
   * Get current connection state
   */
  public get connectionState(): ConnectionState {
    return this.connection.state;
  }

  /**
   * Check if currently connected
   */
  public get isConnected(): boolean {
    return this.connection.isConnected;
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
   * Register a variable with a friendly name
   * This creates a local mirror that can be monitored for changes
   */
  public async registerVariable(name: string, nodeId: string): Promise<OpcuaVariable> {
    return await this.variableManager.registerVariable(name, nodeId);
  }

  /**
   * Get a registered variable by name
   */
  public getVariable(name: string): OpcuaVariable | undefined {
    return this.variableManager.getVariable(name);
  }

  /**
   * Get all registered variables
   */
  public getAllVariables(): Map<string, OpcuaVariable> {
    return this.variableManager.getAllVariables();
  }

  /**
   * Unregister a variable
   */
  public unregisterVariable(name: string): boolean {
    return this.variableManager.unregisterVariable(name);
  }

  /**
   * Read the current value of a variable by name
   */
  public async readValue(name: string): Promise<any> {
    return await this.variableManager.readValue(name);
  }

  /**
   * Write a value to a variable by name
   */
  public async writeValue(name: string, value: any): Promise<void> {
    await this.variableManager.writeValue(name, value);
  }

  /**
   * Add a change handler for a specific variable
   */
  public onChange(name: string, handler: VariableChangeHandler): void {
    this.variableManager.onChange(name, handler);
  }

  /**
   * Add a global change handler for all variables
   */
  public onAnyChange(handler: VariableChangeHandler): void {
    this.variableManager.onAnyChange(handler);
  }

  // Subscription management

  /**
   * Create a named subscription for real-time monitoring
   */
  public async createSubscription(
    name: string, 
    options: SubscriptionOptions = {}
  ): Promise<string> {
    return await this.subscriptionManager.createSubscription(name, options);
  }

  /**
   * Delete a subscription
   */
  public async deleteSubscription(name: string): Promise<void> {
    await this.subscriptionManager.deleteSubscription(name);
  }

  /**
   * Add a registered variable to a subscription for real-time monitoring
   */
  public async addVariableToSubscription(
    subscriptionName: string, 
    variableName: string, 
    options: MonitoredItemOptions = {}
  ): Promise<void> {
    await this.subscriptionManager.addVariable(subscriptionName, variableName, options);
  }

  /**
   * Add a node to a subscription by nodeId
   */
  public async addNodeToSubscription(
    subscriptionName: string, 
    nodeId: string, 
    options: MonitoredItemOptions = {}
  ): Promise<void> {
    await this.subscriptionManager.addNode(subscriptionName, nodeId, options);
  }

  /**
   * Remove a variable from a subscription
   */
  public async removeVariableFromSubscription(
    subscriptionName: string, 
    variableName: string
  ): Promise<void> {
    await this.subscriptionManager.removeVariable(subscriptionName, variableName);
  }

  /**
   * Subscribe to an entire structure recursively
   */
  public async subscribeToStructure(
    subscriptionName: string,
    rootNodeId: string,
    maxDepth: number = 10
  ): Promise<number> {
    return await this.subscriptionManager.subscribeToStructure(
      subscriptionName, 
      rootNodeId, 
      maxDepth
    );
  }

  // Utility methods

  /**
   * Browse OPC UA nodes
   */
  public async browse(nodeId: string): Promise<any> {
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/references`, {
      method: 'GET'
    });

    return await response.json();
  }

  /**
   * Read a node attribute
   */
  public async readAttribute(nodeId: string, attributeId: number): Promise<any> {
    // Map attribute IDs to attribute names for mapp Connect
    const attributeMap: { [key: number]: string } = {
      13: 'Value',
      14: 'DataType',
      2: 'DisplayName',
      3: 'Description',
      15: 'AccessLevel',
      16: 'UserAccessLevel'
    };
    
    const attributeName = attributeMap[attributeId] || 'Value';
    
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/attributes/${attributeName}`, {
      method: 'GET'
    });

    return await response.json();
  }

  /**
   * Convenience method: Register variable and add to subscription in one call
   */
  public async registerAndSubscribe(
    variableName: string,
    nodeId: string,
    subscriptionName: string = 'default',
    subscriptionOptions: SubscriptionOptions = {},
    monitoredItemOptions: MonitoredItemOptions = {}
  ): Promise<OpcuaVariable> {
    // Register the variable
    const variable = await this.registerVariable(variableName, nodeId);

    // Create subscription if it doesn't exist
    try {
      await this.createSubscription(subscriptionName, subscriptionOptions);
    } catch (error) {
      // Subscription might already exist
      if (!(error instanceof Error) || !error.message.includes('already exists')) {
        throw error;
      }
    }

    // Add variable to subscription
    await this.addVariableToSubscription(subscriptionName, variableName, monitoredItemOptions);

    return variable;
  }

  /**
   * Convenience method: Register multiple variables and subscribe them
   */
  public async registerMultipleAndSubscribe(
    variables: Array<{ name: string; nodeId: string }>,
    subscriptionName: string = 'default',
    subscriptionOptions: SubscriptionOptions = {},
    monitoredItemOptions: MonitoredItemOptions = {}
  ): Promise<OpcuaVariable[]> {
    const results: OpcuaVariable[] = [];

    // Create subscription if it doesn't exist
    try {
      await this.createSubscription(subscriptionName, subscriptionOptions);
    } catch (error) {
      // Subscription might already exist
      if (!(error instanceof Error) || !error.message.includes('already exists')) {
        throw error;
      }
    }

    // Register and subscribe each variable
    for (const { name, nodeId } of variables) {
      try {
        const variable = await this.registerVariable(name, nodeId);
        await this.addVariableToSubscription(subscriptionName, name, monitoredItemOptions);
        results.push(variable);
      } catch (error) {
        console.warn(`Failed to register/subscribe variable '${name}':`, error);
      }
    }

    return results;
  }

  /**
   * Get comprehensive status information
   */
  public getStatus(): {
    connection: {
      state: ConnectionState;
      isConnected: boolean;
      sessionId: string | null;
    };
    variables: {
      count: number;
      names: string[];
    };
    subscriptions: {
      count: number;
      names: string[];
    };
  } {
    const session = this.connection.getSessionInfo();
    const variables = this.variableManager.getAllVariables();
    const subscriptions = this.subscriptionManager.getAllSubscriptions();

    return {
      connection: {
        state: this.connection.state,
        isConnected: this.connection.isConnected,
        sessionId: session ? session.sessionId : null
      },
      variables: {
        count: variables.size,
        names: Array.from(variables.keys())
      },
      subscriptions: {
        count: subscriptions.size,
        names: Array.from(subscriptions.keys())
      }
    };
  }
}
