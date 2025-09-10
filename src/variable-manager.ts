import { OpcuaConnection } from './connection.js';
import { 
  OpcuaVariable, 
  VariableChangeEvent, 
  VariableChangeHandler 
} from './types.js';

/**
 * Variable manager implementing lux.js-style patterns for OPC UA variables
 * Provides named variable management with local value mirroring and change notifications
 */
export class VariableManager {
  private connection: OpcuaConnection;
  private variables = new Map<string, OpcuaVariable>();
  private changeHandlers = new Map<string, VariableChangeHandler[]>();
  private globalChangeHandlers: VariableChangeHandler[] = [];

  constructor(connection: OpcuaConnection) {
    this.connection = connection;
  }

  /**
   * Register a variable with a friendly name (lux.js style)
   * This creates a local mirror of the OPC UA variable
   */
  public async registerVariable(name: string, nodeId: string): Promise<OpcuaVariable> {
    if (this.variables.has(name)) {
      throw new Error(`Variable '${name}' is already registered`);
    }

    // Read initial value and metadata
    const variable = await this.readVariableInfo(nodeId);
    const namedVariable: OpcuaVariable = {
      ...variable,
      name,
      nodeId
    };

    this.variables.set(name, namedVariable);
    return namedVariable;
  }

  /**
   * Get a registered variable by name
   */
  public getVariable(name: string): OpcuaVariable | undefined {
    return this.variables.get(name);
  }

  /**
   * Get all registered variables
   */
  public getAllVariables(): Map<string, OpcuaVariable> {
    return new Map(this.variables);
  }

  /**
   * Unregister a variable
   */
  public unregisterVariable(name: string): boolean {
    const removed = this.variables.delete(name);
    if (removed) {
      this.changeHandlers.delete(name);
    }
    return removed;
  }

  /**
   * Read the current value of a variable by name (lux.js style)
   */
  public async readValue(name: string): Promise<any> {
    const variable = this.variables.get(name);
    if (!variable) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    const response = await this.connection.apiRequest('/opcua/readValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: variable.nodeId,
        attributeId: 13 // Value attribute
      })
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to read variable '${name}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    // Update local mirror
    const newValue = result.value?.value;
    const timestamp = new Date(result.serverTimestamp || Date.now());
    const quality = this.mapQualityCode(result.statusCode?.value || 0);

    this.updateLocalVariable(name, newValue, timestamp, quality);

    return newValue;
  }

  /**
   * Write a value to a variable by name (lux.js style)
   */
  public async writeValue(name: string, value: any): Promise<void> {
    const variable = this.variables.get(name);
    if (!variable) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    const response = await this.connection.apiRequest('/opcua/writeValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: variable.nodeId,
        attributeId: 13, // Value attribute
        value: {
          value: value,
          type: this.inferDataType(value)
        }
      })
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to write variable '${name}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    // Update local mirror
    const timestamp = new Date();
    const quality = this.mapQualityCode(result.statusCode?.value || 0);
    this.updateLocalVariable(name, value, timestamp, quality);
  }

  /**
   * Add a change handler for a specific variable (lux.js style)
   */
  public onChange(name: string, handler: VariableChangeHandler): void {
    if (!this.variables.has(name)) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    if (!this.changeHandlers.has(name)) {
      this.changeHandlers.set(name, []);
    }
    
    this.changeHandlers.get(name)!.push(handler);
  }

  /**
   * Add a global change handler for all variables
   */
  public onAnyChange(handler: VariableChangeHandler): void {
    this.globalChangeHandlers.push(handler);
  }

  /**
   * Remove a change handler for a specific variable
   */
  public removeChangeHandler(name: string, handler: VariableChangeHandler): void {
    const handlers = this.changeHandlers.get(name);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Remove a global change handler
   */
  public removeGlobalChangeHandler(handler: VariableChangeHandler): void {
    const index = this.globalChangeHandlers.indexOf(handler);
    if (index > -1) {
      this.globalChangeHandlers.splice(index, 1);
    }
  }

  /**
   * Update a variable from external source (e.g., subscription notification)
   * This is used internally by the subscription manager
   */
  public updateVariableFromNotification(nodeId: string, value: any, timestamp: Date, quality: string): void {
    // Find variable by nodeId
    for (const [name, variable] of this.variables) {
      if (variable.nodeId === nodeId) {
        this.updateLocalVariable(name, value, timestamp, quality);
        break;
      }
    }
  }

  /**
   * Read variable information from the server
   */
  private async readVariableInfo(nodeId: string): Promise<OpcuaVariable> {
    // Read value
    const valueResponse = await this.connection.apiRequest('/opcua/readValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: nodeId,
        attributeId: 13 // Value attribute
      })
    });

    const valueResult = await valueResponse.json();
    
    // Read data type
    const dataTypeResponse = await this.connection.apiRequest('/opcua/readValue', {
      method: 'POST',
      body: JSON.stringify({
        nodeId: nodeId,
        attributeId: 14 // DataType attribute
      })
    });

    const dataTypeResult = await dataTypeResponse.json();

    return {
      nodeId,
      name: '', // Will be set by caller
      value: valueResult.value?.value,
      timestamp: new Date(valueResult.serverTimestamp || Date.now()),
      quality: this.mapQualityCode(valueResult.statusCode?.value || 0),
      dataType: dataTypeResult.value?.value || 'Unknown'
    };
  }

  /**
   * Update local variable mirror and emit change events
   */
  private updateLocalVariable(name: string, value: any, timestamp: Date, quality: string): void {
    const variable = this.variables.get(name);
    if (!variable) return;

    const oldValue = variable.value;
    
    // Update local mirror
    const updatedVariable: OpcuaVariable = {
      ...variable,
      value,
      timestamp,
      quality
    };
    
    this.variables.set(name, updatedVariable);

    // Only emit change if value actually changed
    if (oldValue !== value) {
      const changeEvent: VariableChangeEvent = {
        nodeId: variable.nodeId,
        name,
        value,
        timestamp,
        quality
      };

      // Emit to specific variable handlers
      const handlers = this.changeHandlers.get(name);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(changeEvent);
          } catch (error) {
            console.error(`Variable change handler error for '${name}':`, error);
          }
        });
      }

      // Emit to global handlers
      this.globalChangeHandlers.forEach(handler => {
        try {
          handler(changeEvent);
        } catch (error) {
          console.error(`Global change handler error for '${name}':`, error);
        }
      });
    }
  }

  /**
   * Map OPC UA status code to quality string
   */
  private mapQualityCode(statusCode: number): string {
    // Basic quality mapping (can be expanded)
    switch (statusCode) {
      case 0: return 'good';
      case 0x40000000: return 'uncertain';
      case 0x80000000: return 'bad';
      default: return 'unknown';
    }
  }

  /**
   * Infer OPC UA data type from JavaScript value
   */
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
