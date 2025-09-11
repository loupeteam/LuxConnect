import { OpcuaConnection } from './connection.js';
import { 
  OpcuaVariable, 
  VariableChangeEvent, 
  VariableChangeHandler 
} from './types.js';
import { 
  VariableHierarchy, 
  VariablePathParser
} from './variable-hierarchy.js';

/**
 * Simplified variable manager using global state with deep copying
 * Much simpler and easier to understand than the complex hierarchical approach
 */
export class VariableManager {
  private connection: OpcuaConnection;
  private hierarchy = new VariableHierarchy();
  private changeHandlers = new Map<string, VariableChangeHandler[]>();
  private globalChangeHandlers: VariableChangeHandler[] = [];

  constructor(connection: OpcuaConnection) {
    this.connection = connection;
  }

  /**
   * Register a variable with format validation
   */
  public registerVariable(name: string, nodeId: string): OpcuaVariable {
    // Validate variable name format
    try {
      VariablePathParser.parse(name);
    } catch (error) {
      throw new Error(`Invalid variable name format '${name}': ${error}`);
    }

    // Check if already registered
    const existingVar = this.hierarchy.getVariable(name);
    if (existingVar && existingVar.mapping.nodeId !== nodeId) {
      throw new Error(`Variable '${name}' is already registered with different nodeId '${existingVar.mapping.nodeId}'`);
    }
    
    // If variable exists with same nodeId, return existing variable
    if (existingVar) {
      return {
        name: existingVar.mapping.name,
        nodeId: existingVar.mapping.nodeId,
        value: existingVar.value,
        timestamp: existingVar.timestamp,
        quality: existingVar.quality,
        ...(existingVar.mapping.dataType && { dataType: existingVar.mapping.dataType })
      };
    }

    // Use default values - real values will come from subscription updates
    const variableInfo = {
      value: undefined,
      timestamp: new Date(),
      quality: 'unknown' as const,
      dataType: undefined
    };
    
    // Add to hierarchy
    this.hierarchy.addVariable(
      name,
      nodeId,
      variableInfo.value,
      variableInfo.timestamp,
      variableInfo.quality,
      variableInfo.dataType
    );

    // Convert to OpcuaVariable format for backward compatibility
    const namedVariable: OpcuaVariable = {
      name,
      nodeId,
      value: variableInfo.value,
      timestamp: variableInfo.timestamp,
      quality: variableInfo.quality,
      ...(variableInfo.dataType ? { dataType: variableInfo.dataType } : {})
    };

    return namedVariable;
  }

  /**
   * Get a registered variable by name
   */
  public getVariable(name: string): OpcuaVariable | undefined {
    const varData = this.hierarchy.getVariable(name);
    if (!varData) return undefined;

    return {
      name: varData.mapping.name,
      nodeId: varData.mapping.nodeId,
      value: varData.value,
      timestamp: varData.timestamp,
      quality: varData.quality,
      ...(varData.mapping.dataType && { dataType: varData.mapping.dataType })
    };
  }

  /**
   * Get all registered variables
   */
  public getAllVariables(): Map<string, OpcuaVariable> {
    const result = new Map<string, OpcuaVariable>();
    
    for (const [name, varData] of this.hierarchy.getAllVariables()) {
      result.set(name, {
        name: varData.mapping.name,
        nodeId: varData.mapping.nodeId,
        value: varData.value,
        timestamp: varData.timestamp,
        quality: varData.quality,
        ...(varData.mapping.dataType && { dataType: varData.mapping.dataType })
      });
    }
    
    return result;
  }

  /**
   * Unregister a variable
   */
  public unregisterVariable(name: string): boolean {
    const removed = this.hierarchy.removeVariable(name);
    if (removed) {
      this.changeHandlers.delete(name);
    }
    return removed;
  }

  /**
   * Read the current value of a variable by name
   */
  public async readValue(name: string): Promise<any> {
    const varData = this.hierarchy.getVariable(name);
    if (!varData) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(varData.mapping.nodeId)}/attributes/Value`, {
      method: 'GET'
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to read variable '${name}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    // Update hierarchy with new value
    const newValue = result.value?.value;
    const timestamp = new Date(result.serverTimestamp || Date.now());
    const quality = this.mapQualityCode(result.statusCode?.value || 0);

    const affectedVariables = this.hierarchy.updateVariable(name, newValue, timestamp, quality);
    
    // Emit change events for all affected variables
    for (const affectedName of affectedVariables) {
      const affectedData = this.hierarchy.getVariable(affectedName);
      if (affectedData) {
        this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
      }
    }

    return newValue;
  }

  /**
   * Write a value to a variable by name
   */
  public async writeValue(name: string, value: any): Promise<void> {
    const varData = this.hierarchy.getVariable(name);
    if (!varData) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    // TODO: Add write queue to handle concurrent writes properly
    // TODO: Add write confirmation callback or event
    // TODO: Validate value type against variable's dataType if available
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(varData.mapping.nodeId)}/attributes/Value`, {
      method: 'PUT',
      body: JSON.stringify({
        value: value
      })
    });

    const result = await response.json();
    
    if (result.statusCode?.value !== 0) {
      throw new Error(`Failed to write variable '${name}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    // Update hierarchy
    const timestamp = new Date();
    const quality = this.mapQualityCode(result.statusCode?.value || 0);
    const affectedVariables = this.hierarchy.updateVariable(name, value, timestamp, quality);
    
    // Emit change events for all affected variables
    for (const affectedName of affectedVariables) {
      const affectedData = this.hierarchy.getVariable(affectedName);
      if (affectedData) {
        this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
      }
    }
  }

  /**
   * Add a change handler for a specific variable
   */
  public onChange(name: string, handler: VariableChangeHandler): void {
    if (!this.hierarchy.getVariable(name)) {
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
   * This automatically handles hierarchical updates through the global state
   */
  public updateVariableFromNotification(nodeId: string, value: any, timestamp: Date, quality: string): void {
    const varData = this.hierarchy.getVariableByNodeId(nodeId);
    if (!varData) return;

    // Update in hierarchy (this automatically updates related variables via global state)
    const affectedVariables = this.hierarchy.updateVariable(varData.mapping.name, value, timestamp, quality);
    
    // Emit change events for all affected variables
    for (const affectedName of affectedVariables) {
      const affectedData = this.hierarchy.getVariable(affectedName);
      if (affectedData) {
        this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
      }
    }
  }

  /**
   * Get variables that are related to the given variable
   */
  public getRelatedVariables(name: string): Array<{ type: 'parent' | 'child' | 'sibling'; variable: OpcuaVariable }> {
    const related = this.hierarchy.findRelatedVariables(name);
    
    return related.map(rel => {
      const varData = this.hierarchy.getVariable(rel.variable);
      if (!varData) throw new Error(`Related variable ${rel.variable} not found`);
      
      return {
        type: rel.type,
        variable: {
          name: varData.mapping.name,
          nodeId: varData.mapping.nodeId,
          value: varData.value,
          timestamp: varData.timestamp,
          quality: varData.quality,
          ...(varData.mapping.dataType && { dataType: varData.mapping.dataType })
        }
      };
    });
  }

  /**
   * Get current global state (for debugging)
   */
  public getGlobalState(): any {
    return this.hierarchy.getGlobalState();
  }

  /**
   * Emit change event for a variable
   */
  private emitChangeEvent(name: string, value: any, timestamp: Date, quality: string): void {
    const varData = this.hierarchy.getVariable(name);
    if (!varData) return;

    const changeEvent: VariableChangeEvent = {
      nodeId: varData.mapping.nodeId,
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
}
