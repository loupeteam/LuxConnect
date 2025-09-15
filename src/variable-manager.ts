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
  
  // NodeId generation settings
  private defaultNamespace: string = 'ns=5;s=';
  private defaultApplication: string = ''; // Empty means use parser default
  private defaultTask: string = 'AsGlobalPV'; // Default task for variables without explicit task

  constructor(connection: OpcuaConnection) {
    this.connection = connection;
  }

  /**
   * Set default namespace for NodeId generation
   */
  public setDefaultNamespace(namespace: string): void {
    this.defaultNamespace = namespace.endsWith(';s=') ? namespace : namespace + ';s=';
  }

  /**
   * Set default application/module for variables without explicit application
   */
  public setDefaultApplication(application: string): void {
    this.defaultApplication = application;
  }

  /**
   * Set default task for variables without explicit task
   */
  public setDefaultTask(task: string): void {
    this.defaultTask = task;
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

    // Normalize the variable name for consistent storage
    const normalizedName = this.normalizeVariableName(name);

    // Check if already registered
    const existingVar = this.hierarchy.getVariable(normalizedName);
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
    
    // Add to hierarchy using normalized name
    this.hierarchy.addVariable(
      normalizedName,
      nodeId,
      variableInfo.value,
      variableInfo.timestamp,
      variableInfo.quality,
      variableInfo.dataType
    );

    // Convert to OpcuaVariable format
    const namedVariable: OpcuaVariable = {
      name: normalizedName,
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
    const normalizedName = this.normalizeVariableName(name);
    const varData = this.hierarchy.getVariable(normalizedName);
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
    const normalizedName = this.normalizeVariableName(name);
    const removed = this.hierarchy.removeVariable(normalizedName);
    if (removed) {
      // Clean up change handlers using normalized name
      this.changeHandlers.delete(normalizedName);
    }
    return removed;
  }

  /**
   * Read the current value of a variable by name
   * No registration required - builds NodeId dynamically
   */
  public async readValue(name: string): Promise<any> {
    const normalizedName = this.normalizeVariableName(name);
    
    // Try to get nodeId from registered variable first
    let targetNodeId: string;
    const varData = this.hierarchy.getVariable(normalizedName);
    if (varData) {
      targetNodeId = varData.mapping.nodeId;
    } else {
      targetNodeId = this.buildNodeId(name);
    }

    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(targetNodeId)}/attributes/Value`, {
      method: 'GET'
    });

    const result = await response.json();
    
    if (result.status?.code !== 0) {
      throw new Error(`Failed to read variable '${name}': ${result.statusCode?.description || 'Unknown error'}`);
    }

    const newValue = result.value;
    const timestamp = new Date(result.serverTimestamp || Date.now());
    const quality = this.mapQualityCode(result.status?.code || 0);

    // If variable is registered, update hierarchy and emit change events
    if (varData) {
      const affectedVariables = this.hierarchy.updateVariable(normalizedName, newValue, timestamp, quality);
      
      // Emit change events for all affected variables
      for (const affectedName of affectedVariables) {
        const affectedData = this.hierarchy.getVariable(affectedName);
        if (affectedData) {
          this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
        }
      }
    }

    return newValue;
  }

  /**
   * Write a value to a variable by name
   * For complex objects, decomposes them into individual simple values and uses batch write
   * For array elements with primitive values, uses read-modify-write approach
   */
  public async writeValue(name: string, value: any): Promise<void> {
    const normalizedName = this.normalizeVariableName(name);
    
    // Check if this is an array element access pattern (e.g., "myArray[0]", "obj.array[1]")
    const arrayElementMatch = name.match(/^(.+)\[(\d+)\]$/);
    if (arrayElementMatch && !this.isComplexValue(value)) {
      // Only use array element logic for primitive values
      // Complex values in arrays will be handled by normal complex object decomposition
      const [, baseVariableName, indexStr] = arrayElementMatch;
      const index = parseInt(indexStr, 10);
      await this.writeArrayElement(baseVariableName, index, value);
      return;
    }
    
    // Check if value is a complex object that needs decomposition
    // This will handle both regular complex objects AND complex values in array elements
    if (this.isComplexValue(value)) {
      await this.writeComplexValue(value, name);
      return;
    }

    // Simple value write
    await this.writeSingleValue(normalizedName, value, name);
  }

  /**
   * Write a primitive value to a specific array element
   * First tries direct write to array element, falls back to read-modify-write if server doesn't support it
   * This method only handles primitive values; complex values are handled by writeComplexValue
   * No registration required - builds NodeId dynamically
   * No registration required - builds NodeId dynamically
   */
  private async writeArrayElement(baseVariableName: string, index: number, value: any): Promise<void> {
    const normalizedBaseName = this.normalizeVariableName(baseVariableName);
    const arrayElementName = `${baseVariableName}[${index}]`;

    try {
      // First attempt: Try direct write to array element (if server supports it)
      console.log(`🎯 Attempting direct write to array element: ${arrayElementName}`);
      
      try {
        await this.writeSingleValue(this.normalizeVariableName(arrayElementName), value, arrayElementName);
        console.log(`✅ Direct write successful: ${arrayElementName} = ${JSON.stringify(value)}`);
        return; // Success! No need for fallback
      } catch (directWriteError) {
        console.log(`⚠️ Direct write failed for ${arrayElementName}, falling back to read-modify-write`);
        console.log(`   Direct write error: ${directWriteError instanceof Error ? directWriteError.message : String(directWriteError)}`);
      }

      // Fallback: Use read-modify-write approach
      console.log(`🔧 Using read-modify-write fallback for primitive array element: ${baseVariableName}[${index}]`);
      
      // Step 1: Read the entire array (readValue now handles unregistered variables)
      const currentArray = await this.readValue(baseVariableName);
      
      if (!Array.isArray(currentArray)) {
        throw new Error(`Variable '${baseVariableName}' is not an array (got ${typeof currentArray})`);
      }

      // Step 2: Check if index is valid
      if (index < 0 || index >= currentArray.length) {
        throw new Error(`Array index ${index} is out of bounds for array of length ${currentArray.length}`);
      }

      // Step 3: Update the specific element
      const modifiedArray = [...currentArray];
      modifiedArray[index] = value;

      // Step 4: Write the entire modified array back (writeSingleValue now handles unregistered variables)
      await this.writeSingleValue(normalizedBaseName, modifiedArray, baseVariableName);
      
      console.log(`✅ Read-modify-write successful: ${baseVariableName}[${index}] = ${JSON.stringify(value)}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write array element '${baseVariableName}[${index}]': ${errorMessage}`);
    }
  }

  /**
   * Check if a value is complex (object or array) and needs decomposition
   * Arrays of primitives are now handled as simple values since array elements
   * use read-modify-write approach
   */
  private isComplexValue(value: any): boolean {
    // Arrays are handled as simple values now (read-modify-write for elements)
    if (Array.isArray(value)) {
      // Only treat arrays with objects as complex (for object property decomposition)
      return value.some(item => typeof item === 'object' && item !== null);
    }
    
    // Objects should be decomposed (unless they're null)
    return value !== null && typeof value === 'object';
  }

  /**
   * Write a complex value by decomposing it into individual simple values
   * Uses Microsoft Graph JSON batching for efficient multi-variable writes
   * No registration required - builds NodeIds dynamically
   */
  private async writeComplexValue(value: any, originalName: string): Promise<void> {
    const flattenedValues = this.flattenValue('', value);
    
    if (flattenedValues.length === 0) {
      throw new Error(`No writable values found in complex object for variable '${originalName}'`);
    }

    // Prepare batch write requests
    const batchWrites: Array<{
      nodeId: string;
      value: any;
      path: string;
    }> = [];

    for (const { path, value: simpleValue } of flattenedValues) {
      const fullVariableName = originalName + path;
      
      try {
        // Build nodeId dynamically for the sub-variable - no registration required
        const subNodeId = this.buildNodeId(fullVariableName);
        
        batchWrites.push({
          nodeId: subNodeId,
          value: simpleValue,
          path: path
        });
      } catch (error) {
        console.warn(`Could not build nodeId for sub-variable '${fullVariableName}': ${error}. Skipping.`);
        continue;
      }
    }

    // Execute batch write
    await this.executeBatchWrite(batchWrites, originalName);
  }

  /**
   * Flatten a complex value into simple path-value pairs
   */
  private flattenValue(basePath: string, value: any): Array<{ path: string; value: any }> {
    const result: Array<{ path: string; value: any }> = [];

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const path = `${basePath}[${index}]`;
        if (typeof item === 'object' && item !== null) {
          result.push(...this.flattenValue(path, item));
        } else {
          result.push({ path, value: item });
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([key, val]) => {
        const path = basePath ? `${basePath}.${key}` : `.${key}`;
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          result.push(...this.flattenValue(path, val));
        } else if (Array.isArray(val)) {
          result.push(...this.flattenValue(path, val));
        } else {
          result.push({ path, value: val });
        }
      });
    } else {
      result.push({ path: basePath, value });
    }

    return result;
  }

  /**
   * Execute batch write operations
   */
  private async executeBatchWrite(writes: Array<{ nodeId: string; value: any; path: string }>, originalName: string): Promise<void> {
    const sessionId = this.connection.getSessionInfo()?.sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    // Build batch request payload following mapp Connect batch API format
    const batchPayload = {
      requests: writes.map((write, index) => ({
        id: (index + 1).toString(),
        method: 'PUT',
        url: `/${encodeURIComponent(write.nodeId)}/attributes/Value`,
        body: { value: write.value },
        headers: {
          'Content-Type': 'application/json'
        }
      }))
    };

    try {
      const response = await this.connection.apiRequest(`/opcua/sessions/${sessionId}/nodes/$batch`, {
        method: 'POST',
        body: JSON.stringify(batchPayload)
      });

      const results = await response.json();
      
      // Check results and handle any failures
      if (Array.isArray(results.responses)) {
        const failures: string[] = [];
        results.responses.forEach((result: any, index: number) => {
          if (result.status >= 400 || (result.body && result.body.status?.code !== 0)) {
            const errorMsg = result.body?.statusCode?.description || result.statusText || 'Unknown error';
            failures.push(`${writes[index].path}: ${errorMsg}`);
          }
        });

        if (failures.length > 0) {
          throw new Error(`Failed to write some parts of complex variable '${originalName}':\n${failures.join('\n')}`);
        }
      }

      // Update hierarchy for all successful writes
      const timestamp = new Date();
      const quality = 'Good';
      
      for (const write of writes) {
        const fullVariableName = Object.keys(this.hierarchy.getAllVariables()).find(name => 
          this.hierarchy.getVariable(name)?.mapping.nodeId === write.nodeId
        );
        
        if (fullVariableName) {
          const affectedVariables = this.hierarchy.updateVariable(fullVariableName, write.value, timestamp, quality);
          
          // Emit change events for all affected variables
          for (const affectedName of affectedVariables) {
            const affectedData = this.hierarchy.getVariable(affectedName);
            if (affectedData) {
              this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
            }
          }
        }
      }

    } catch (error) {
      // If batch write fails, fall back to individual writes
      console.warn(`Batch write failed for '${originalName}', falling back to individual writes: ${error}`);
      
      const writePromises = writes.map(async write => {
        try {
          await this.writeSingleValueByNodeId(write.nodeId, write.value);
        } catch (err) {
          throw new Error(`Failed to write ${write.path}: ${err}`);
        }
      });

      await Promise.all(writePromises);
    }
  }

  /**
   * Write a single simple value
   * No registration required - builds NodeId dynamically
   */
  private async writeSingleValue(normalizedName: string, value: any, originalName: string): Promise<void> {
    // Try to get nodeId from registered variable first
    let targetNodeId: string;
    const varData = this.hierarchy.getVariable(normalizedName);
    if (varData) {
      targetNodeId = varData.mapping.nodeId;
    } else {
      // Generate NodeId dynamically - no registration required!
      targetNodeId = this.buildNodeId(originalName);
    }

    await this.writeSingleValueByNodeId(targetNodeId, value);

    // If variable is registered, update hierarchy and emit change events
    if (varData) {
      const timestamp = new Date();
      const quality = this.mapQualityCode(0); // Assume success
      const affectedVariables = this.hierarchy.updateVariable(normalizedName, value, timestamp, quality);
      
      // Emit change events for all affected variables
      for (const affectedName of affectedVariables) {
        const affectedData = this.hierarchy.getVariable(affectedName);
        if (affectedData) {
          this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
        }
      }
    }
  }

  /**
   * Write a single value by nodeId
   */
  private async writeSingleValueByNodeId(nodeId: string, value: any): Promise<void> {
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/attributes/Value`, {
      method: 'PUT',
      body: JSON.stringify({
        value: value
      })
    });

    const result = await response.json();
    
    if (result.status?.code !== 0) {
      throw new Error(`Failed to write value: ${result.statusCode?.description || 'Unknown error'}`);
    }
  }

  /**
   * Add a change handler for a specific variable
   */
  public onChange(name: string, handler: VariableChangeHandler): void {
    // Use normalized name for both checking registration and storing handlers
    const normalizedName = this.normalizeVariableName(name);
    
    if (!this.hierarchy.getVariable(normalizedName)) {
      throw new Error(`Variable '${name}' is not registered`);
    }

    if (!this.changeHandlers.has(normalizedName)) {
      this.changeHandlers.set(normalizedName, []);
    }
    
    this.changeHandlers.get(normalizedName)!.push(handler);
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
    // Use normalized name as key for change handlers lookup
    const normalizedName = this.normalizeVariableName(name);
    const handlers = this.changeHandlers.get(normalizedName);
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
   * Normalize variable name to ensure consistent key usage
   * This ensures that variable names like 'Temperature', '::AsGlobalPV:Temperature', 'gtest', '::gtest' 
   * are all treated consistently when used as keys for change handlers
   */
  private normalizeVariableName(name: string): string {
    try {
      const parsedPath = VariablePathParser.parse(name);
      return VariablePathParser.reconstruct(parsedPath);
    } catch (error) {
      // If parsing fails, return the original name as fallback
      return name;
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
    const normalizedName = this.normalizeVariableName(name);
    const related = this.hierarchy.findRelatedVariables(normalizedName);
    
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

    const normalizedName = this.normalizeVariableName(name);

    const changeEvent: VariableChangeEvent = {
      nodeId: varData.mapping.nodeId,
      name,
      value,
      timestamp,
      quality
    };

    // Emit to specific variable handlers using normalized name as key
    const handlers = this.changeHandlers.get(normalizedName);
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

  /**
   * Build NodeId from variable name
   */
  private buildNodeId(varName: string): string {
    // Pass instance-specific defaults to the centralized method
    return VariablePathParser.buildNodeId(varName, {
      namespace: this.defaultNamespace,
      defaultApplication: this.defaultApplication,
      defaultTask: this.defaultTask
    });
  }
}
