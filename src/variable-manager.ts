import { OpcuaConnection } from './connection.js';
import { 
  OpcuaVariable, 
  VariableChangeEvent, 
  VariableChangeHandler,
  ErrorPolicy,
  OpcuaValue,
  OpcuaObject
} from './types.js';
import {
  VariableHierarchy,
  VariablePathParser,
  DEFAULT_GLOBAL_TASK,
  DEFAULT_NAMESPACE
} from './variable-hierarchy.js';
import { LuxConnectErrorCode, rejectWithError } from './errors.js';

/**
 * Simplified variable manager using global state with deep copying
 * Much simpler and easier to understand than the complex hierarchical approach
 */
export class VariableManager {
  private connection: OpcuaConnection;
  private hierarchy = new VariableHierarchy();
  private changeHandlers = new Map<string, VariableChangeHandler[]>();
  private globalChangeHandlers: VariableChangeHandler[] = [];
  
  // Error handling policy
  private errorPolicy: ErrorPolicy = 'default';
  
  // NodeId generation settings
  private defaultNamespace: string = DEFAULT_NAMESPACE;
  private defaultApplication: string = ''; // Empty means use parser default
  private defaultTask: string = DEFAULT_GLOBAL_TASK;
  private taskNameMaxLength: number | undefined = undefined; // Optional truncation limit for task/scope names

  constructor(connection: OpcuaConnection) {
    this.connection = connection;
  }

  /**
   * Set default namespace for NodeId generation
   */
  public setDefaultNamespace(namespace: string): void {
    this.defaultNamespace = namespace.endsWith(';s=') ? namespace : namespace + ';s=';
  }

  public setDefaultApplication(application: string): void {
    this.defaultApplication = application;
  }

  public setDefaultTask(task: string): void {
    this.defaultTask = task;
  }

  /**
   * Set the maximum length for task/scope names in local variable nodeIds.
   * Task names exceeding this length are truncated. Pass undefined to disable.
   */
  public setTaskNameMaxLength(limit: number | undefined): void {
    this.taskNameMaxLength = limit;
  }

  /**
   * Get the configured task/scope name length limit, or undefined if unset.
   */
  public getTaskNameMaxLength(): number | undefined {
    return this.taskNameMaxLength;
  }

  /**
   * Get the effective nodeId for a registered variable.
   * Returns the explicit nodeId override if one was stored, otherwise generates from name + current namespace.
   */
  private getNodeIdForVar(normalizedName: string): string {
    const varData = this.hierarchy.getVariable(normalizedName);
    return varData?.mapping.explicitNodeId ?? this.buildNodeId(normalizedName);
  }

  /**
   * Set error handling policy
   * @param policy 'default' - log errors and return cached values, 'strict' - throw unhandled rejections, 'silent' - return cached values without logging
   */
  public setErrorPolicy(policy: ErrorPolicy): void {
    this.errorPolicy = policy;
  }

  /**
   * Creates a smart promise that handles errors based on the error policy
   * - strict: Returns promise as-is (will crash if unhandled)
   * - default: Logs errors and returns cached/fallback values
   * - silent: Returns cached/fallback values without logging
   */
  private createSmartPromise<T>(
    operation: () => Promise<T>,
    variableName: string,
    fallbackValue?: T
  ): Promise<T> {
    const promise = operation();
    
    if (this.errorPolicy === 'strict') {
      // In strict mode, return the promise as-is (will crash if unhandled)
      return promise;
    }
    
    // In default or silent mode, handle errors gracefully
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    return promise.catch((error: any): T => {
      const normalizedName = this.normalizeVariableName(variableName);
      const cachedVar = this.hierarchy.getVariable(normalizedName);
      const cachedValue = cachedVar?.value ?? fallbackValue;
      
      if (this.errorPolicy === 'default') {
        // Log the error in default mode
        const errorMsg = error?.message || String(error);
        console.warn(`🔄 Operation failed for '${variableName}': ${errorMsg} (using cached/fallback value)`);
      }
      
      return cachedValue as T;
    });
  }

  
  /**
   * Register a variable with format validation and optional array parameter detection.
   * @param name Variable name
   * @param nodeId Optional explicit nodeId override. If omitted, nodeId is generated on-the-fly from the name and current namespace.
   * @param readArrayParams Whether to read and store array parameters (ValueRank, ArrayDimensions)
   */
  public registerVariable(name: string, nodeId?: string, readArrayParams: boolean = false): OpcuaVariable | Promise<OpcuaVariable> {
    if (readArrayParams) {
      return this.registerVariableAsync(name, nodeId, true);
    } else {
      return this.registerVariableSync(name, nodeId);
    }
  }

  /**
   * Synchronous variable registration
   */
  private registerVariableSync(name: string, explicitNodeId?: string): OpcuaVariable {
    try {
      VariablePathParser.parse(name);
    } catch (error) {
      throw new Error(`Invalid variable name format '${name}': ${error}`);
    }

    const normalizedName = this.normalizeVariableName(name);

    // If already registered, return existing variable (idempotent)
    const existingVar = this.hierarchy.getVariable(normalizedName);
    if (existingVar) {
      return {
        name: existingVar.mapping.name,
        nodeId: this.getNodeIdForVar(normalizedName),
        value: existingVar.value,
        timestamp: existingVar.timestamp,
        quality: existingVar.quality,
        ...(existingVar.mapping.dataType && { dataType: existingVar.mapping.dataType })
      };
    }

    this.hierarchy.addVariable(
      normalizedName,
      explicitNodeId,
      undefined,
      new Date(),
      'unknown',
      undefined
    );

    return {
      name: normalizedName,
      nodeId: explicitNodeId ?? this.buildNodeId(normalizedName),
      value: undefined,
      timestamp: new Date(),
      quality: 'unknown'
    };
  }

  /**
   * Asynchronous variable registration with array parameter reading
   */
  private async registerVariableAsync(name: string, explicitNodeId: string | undefined, readArrayParams: boolean): Promise<OpcuaVariable> {
    try {
      VariablePathParser.parse(name);
    } catch (error) {
      throw new Error(`Invalid variable name format '${name}': ${error}`);
    }

    const normalizedName = this.normalizeVariableName(name);

    // If already registered, return existing variable (idempotent)
    const existingVar = this.hierarchy.getVariable(normalizedName);
    if (existingVar) {
      return {
        name: existingVar.mapping.name,
        nodeId: this.getNodeIdForVar(normalizedName),
        value: existingVar.value,
        timestamp: existingVar.timestamp,
        quality: existingVar.quality,
        ...(existingVar.mapping.dataType && { dataType: existingVar.mapping.dataType })
      };
    }

    let valueRank: number | undefined;
    let arrayDimensions: Array<[number, number]> | undefined;

    if (readArrayParams) {
      try {
        const arrayParams = await this.readArrayParameters(name);
        valueRank = arrayParams.valueRank;
        if (arrayParams.arrayDimensions) {
          arrayDimensions = arrayParams.arrayDimensions.map(size => [0, size - 1] as [number, number]);
        }
      } catch (error) {
        console.warn(`Could not read array parameters for '${name}': ${error}`);
      }
    }

    this.hierarchy.addVariable(
      normalizedName,
      explicitNodeId,
      undefined,
      new Date(),
      'unknown',
      undefined,
      valueRank,
      arrayDimensions
    );

    return {
      name: normalizedName,
      nodeId: explicitNodeId ?? this.buildNodeId(normalizedName),
      value: undefined,
      timestamp: new Date(),
      quality: 'unknown'
    };
  }

  public getVariable(name: string): OpcuaVariable | undefined {
    const normalizedName = this.normalizeVariableName(name);
    const varData = this.hierarchy.getVariable(normalizedName);
    if (!varData) return undefined;

    return {
      name: varData.mapping.name,
      nodeId: this.getNodeIdForVar(normalizedName),
      value: varData.value,
      timestamp: varData.timestamp,
      quality: varData.quality,
      ...(varData.mapping.dataType && { dataType: varData.mapping.dataType })
    };
  }

  public getAllVariables(): Map<string, OpcuaVariable> {
    const result = new Map<string, OpcuaVariable>();
    for (const [name, varData] of this.hierarchy.getAllVariables()) {
      result.set(name, {
        name: varData.mapping.name,
        nodeId: this.getNodeIdForVar(name),
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
   * Read a specific attribute from a node
   * @param nodeId The node ID to read from
   * @param attributeId The attribute ID to read (e.g., 'Value', 'ValueRank', 'ArrayDimensions', 'DataType')
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async readAttribute(nodeId: string, attributeId: string): Promise<any> {
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/attributes/${attributeId}`, {
      method: 'GET'
    });

    const result = await response.json();
    
    if (result.status?.code !== 0) {
      throw new Error(`Failed to read attribute '${attributeId}' from node '${nodeId}': ${result.status?.code?.description || 'Unknown error'}`);
    }

    return result.value;
  }

  /**
   * Read array parameters for a variable (ValueRank and ArrayDimensions)
   * Returns information about array structure
   */
  public async readArrayParameters(name: string): Promise<{
    valueRank: number;
    arrayDimensions: number[] | null;
    isArray: boolean;
    dimensionCount: number;
  }> {
    const normalizedName = this.normalizeVariableName(name);
    const targetNodeId = this.getNodeIdForVar(normalizedName);

    try {
      // Read ValueRank (-1 = scalar, 0 = 1D array, 1 = 2D array, etc.)
      const valueRank = await this.readAttribute(targetNodeId, 'ValueRank');
      
      // Read ArrayDimensions (only meaningful for arrays)
      let arrayDimensions: number[] | null = null;
      if (valueRank >= 0) {
        try {
          arrayDimensions = await this.readAttribute(targetNodeId, 'ArrayDimensions');
        } catch (error) {
          // ArrayDimensions might not be available for some nodes
          console.warn(`Could not read ArrayDimensions for '${name}': ${error}`);
        }
      }

      return {
        valueRank,
        arrayDimensions,
        isArray: valueRank >= 0,
        dimensionCount: valueRank >= 0 ? (arrayDimensions?.length || 1) : 0
      };
    } catch (error) {
      throw new Error(`Failed to read array parameters for variable '${name}': ${error}`);
    }
  }

  /**
   * Read the current value of a variable by name
   * No registration required - builds NodeId dynamically
   */
  public readValue(name: string): Promise<OpcuaValue> {
    return this.createSmartPromise(
      () => this.performReadValue(name),
      name
    );
  }

  /**
   * Internal method that performs the actual read operation
   */
  private async performReadValue(name: string): Promise<OpcuaValue> {
    const normalizedName = this.normalizeVariableName(name);

    let targetNodeId: string;
    try {
      targetNodeId = this.getNodeIdForVar(normalizedName);
    } catch (error) {
      return rejectWithError(
        LuxConnectErrorCode.INVALID_VARIABLE_NAME,
        `Invalid variable name '${name}': ${error}`,
        { variableName: name },
        error instanceof Error ? error : new Error(String(error))
      );
    }

    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(targetNodeId)}/attributes/Value`, {
      method: 'GET'
    });

    const result = await response.json();

    if (result.status?.code !== 0) {
      return rejectWithError(
        LuxConnectErrorCode.READ_FAILED,
        `Failed to read variable '${name}': ${result.status?.code?.description || 'Unknown error'}`,
        {
          variableName: name,
          nodeId: targetNodeId,
          statusCode: result.status?.code,
          statusDescription: result.status?.code?.description
        }
      );
    }

    const newValue = result.value;
    const timestamp = new Date(result.serverTimestamp || Date.now());
    const quality = this.mapQualityCode(result.status?.code || 0);

    // Auto-register unread variables so the value is stored in the hierarchy
    if (!this.hierarchy.getVariable(normalizedName)) {
      this.hierarchy.addVariable(normalizedName, undefined, undefined, timestamp, quality);
    }

    // If variable is registered, update hierarchy and emit change events
    const varData = this.hierarchy.getVariable(normalizedName);
    const affectedVariables = this.hierarchy.updateVariable(normalizedName, newValue, timestamp, quality);
    if (varData) {
      for (const affectedName of affectedVariables) {
        const affectedData = this.hierarchy.getVariable(affectedName);
        if (affectedData) {
          this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
        }
      }
    }

    return newValue;
  }  /**
   * Write a value to a variable by name
   * For complex objects, decomposes them into individual simple values and uses batch write
   * For array elements with primitive values, uses read-modify-write approach
   */
  public writeValue(name: string, value: OpcuaValue): Promise<void> {
    return this.createSmartPromise(
      () => this.performWriteValue(name, value),
      name
    );
  }

  /**
   * Internal method that performs the actual write operation
   */
  private async performWriteValue(name: string, value: OpcuaValue): Promise<void> {
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
   * 
   * Note:
   * By default, single elements are not enabled for read or write access. This means that
   * direct writes to elements like "myArray[0]" will often fail with "Bad_NodeIdUnknown".
   * In such cases, the method falls back to reading the entire array, modifying the specific
   * element, and writing the entire array back.
   */
  private async writeArrayElement(baseVariableName: string, index: number, value: OpcuaValue): Promise<void> {
    const normalizedBaseName = this.normalizeVariableName(baseVariableName);
    const arrayElementName = `${baseVariableName}[${index}]`;

    try {      
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
  private isComplexValue(value: OpcuaValue): boolean {
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
   * 
   * Always uses JavaScript bracket notation [0][0] for nested arrays.
   * The OpcUaProxy server handles conversion to OPC UA comma notation [0,0]
   * when the underlying PLC variable requires it.
   */
  private async writeComplexValue(value: OpcuaValue, originalName: string): Promise<void> {
    const flattenedValues = this.flattenValue('', value);

    if (flattenedValues.length === 0) {
      throw new Error(`No writable values found in complex object for variable '${originalName}'`);
    }

    const batchWrites: Array<{
      nodeId: string;
      varName: string;
      value: OpcuaValue;
      path: string;
    }> = [];

    for (const { path, value: simpleValue } of flattenedValues) {
      const fullVariableName = originalName + path;
      try {
        batchWrites.push({
          nodeId: this.buildNodeId(fullVariableName),
          varName: fullVariableName,
          value: simpleValue,
          path
        });
      } catch (error) {
        console.warn(`Could not build nodeId for sub-variable '${fullVariableName}': ${error}. Skipping.`);
      }
    }

    await this.executeBatchWrite(batchWrites, originalName);
  }

  /**
   * Flatten a complex value into simple path-value pairs.
   * Uses JavaScript bracket notation [0][1] for nested arrays.
   */
  private flattenValue(basePath: string, value: OpcuaValue): Array<{ path: string; value: OpcuaValue }> {
    const result: Array<{ path: string; value: OpcuaValue }> = [];

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
  private async executeBatchWrite(writes: Array<{ nodeId: string; varName: string; value: OpcuaValue; path: string }>, originalName: string): Promise<void> {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any        
        results.responses.forEach((result: any, index: number) => {
          const httpFailed = typeof result?.status === 'number' && result.status >= 400;
          const opcuaStatus = result?.body?.status;
          // OPC UA status code may be a number or an object with `code`.
          const opcuaCode = typeof opcuaStatus === 'number'
            ? opcuaStatus
            : (typeof opcuaStatus?.code === 'number' ? opcuaStatus.code : undefined);
          const opcuaFailed = opcuaCode !== undefined && opcuaCode !== 0;
          if (httpFailed || opcuaFailed) {
            const errorMsg =
              result?.body?.status?.description ??
              result?.body?.message ??
              result?.statusText ??
              `status=${result?.status ?? '?'} opcua=${opcuaCode ?? '?'}`;
            const detail = `${writes[index].path} (nodeId=${writes[index].nodeId}): ${errorMsg}`;
            failures.push(detail);
            console.warn(`Batch write failed for ${detail}`, result?.body ?? result);
          }
        });

        if (failures.length > 0) {
          throw new Error(`Failed to write some parts of complex variable '${originalName}':\n${failures.join('\n')}`);
        }
      } else {
        console.warn(`Batch write for '${originalName}' returned no responses array; raw result:`, results);
      }

      // Update hierarchy for all successful writes
      const timestamp = new Date();
      const quality = this.mapQualityCode(0);

      for (const write of writes) {
        const normalizedName = this.normalizeVariableName(write.varName);
        if (this.hierarchy.getVariable(normalizedName)) {
          const affectedVariables = this.hierarchy.updateVariable(normalizedName, write.value, timestamp, quality);
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
  private async writeSingleValue(normalizedName: string, value: OpcuaValue, _originalName: string): Promise<void> {
    const targetNodeId = this.getNodeIdForVar(normalizedName);
    await this.writeSingleValueByNodeId(targetNodeId, value);

    // If variable is registered, update hierarchy and emit change events
    const varData = this.hierarchy.getVariable(normalizedName);
    if (varData) {
      const timestamp = new Date();
      const quality = this.mapQualityCode(0);
      const affectedVariables = this.hierarchy.updateVariable(normalizedName, value, timestamp, quality);
      for (const affectedName of affectedVariables) {
        const affectedData = this.hierarchy.getVariable(affectedName);
        if (affectedData) {
          this.emitChangeEvent(affectedName, affectedData.value, affectedData.timestamp, affectedData.quality);
        }
      }
    }
  }

  /**
   * Write a single value by nodeId with intelligent type conversion
   */
  private async writeSingleValueByNodeId(nodeId: string, value: OpcuaValue): Promise<void> {
    // Simple string-to-boolean conversion
    const convertedValue = this.convertValueForWrite(value);
    
    const response = await this.connection.apiRequest(`/opcua/sessions/${this.connection.getSessionInfo()?.sessionId}/nodes/${encodeURIComponent(nodeId)}/attributes/Value`, {
      method: 'PUT',
      body: JSON.stringify({
        value: convertedValue
      })
    });

    const result = await response.json();
    
    if (result.status?.code !== 0) {
      throw new Error(`Failed to write value: ${result.status?.code?.description || 'Unknown error'}`);
    }
  }

  /**
   * Convert value for writing - simple string-to-boolean conversion
   */
  private convertValueForWrite(value: OpcuaValue): OpcuaValue {
    // Convert string "true"/"false" to boolean true/false
    if (value === 'true' || value === 'TRUE') {
      return true;
    }
    if (value === 'false' || value === 'FALSE') {
      return false;
    }
    
    // Return all other values as-is
    return value;
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
      // Apply the same task-name truncation used when building nodeIds, so that
      // hierarchy keys and nodeId strings always agree on the task name.
      if (
        this.taskNameMaxLength !== undefined &&
        parsedPath.task !== DEFAULT_GLOBAL_TASK &&
        parsedPath.task.length > this.taskNameMaxLength
      ) {
        parsedPath.task = parsedPath.task.slice(0, this.taskNameMaxLength);
      }
      return VariablePathParser.reconstruct(parsedPath);
    } catch {
      // If parsing fails, return the original name as fallback
      return name;
    }
  }

  /**
   * Update a variable from external source (e.g., subscription notification)
   * This automatically handles hierarchical updates through the global state
   */
  public updateVariableFromNotification(varName: string, value: OpcuaValue, timestamp: Date, quality: string): void {
    const normalizedName = this.normalizeVariableName(varName);
    const varData = this.hierarchy.getVariable(normalizedName);
    if (!varData) return;

    const affectedVariables = this.hierarchy.updateVariable(normalizedName, value, timestamp, quality);
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
          nodeId: this.getNodeIdForVar(rel.variable),
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
  public getGlobalState(): OpcuaObject {
    return this.hierarchy.getGlobalState();
  }

  /**
   * Emit change event for a variable
   */
  private emitChangeEvent(name: string, value: OpcuaValue, timestamp: Date, quality: string): void {
    const normalizedName = this.normalizeVariableName(name);

    const changeEvent: VariableChangeEvent = {
      nodeId: this.getNodeIdForVar(normalizedName),
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
  public buildNodeId(varName: string, overrides?: { namespace?: string; nodeId?: string }): string {
    return VariablePathParser.buildNodeId(varName, {
      namespace: overrides?.namespace || this.defaultNamespace,
      ...(overrides?.nodeId !== undefined && { nodeId: overrides.nodeId }),
      defaultApplication: this.defaultApplication,
      defaultTask: this.defaultTask,
      ...(this.taskNameMaxLength !== undefined && { taskNameMaxLength: this.taskNameMaxLength })
    });
  }
}
