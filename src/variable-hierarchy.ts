/**
 * Simplified variable hierarchy using a single state object with deep copying
 * Much simpler approach that's easier to understand and maintain
 */

export interface VariablePath {
  application: string;
  task: string;
  variable: string;
  path: string[];  // For structure navigation like ['SubStruct', 'Element', '[0]']
}

export interface VariableMapping {
  name: string;
  nodeId: string;
  dataType?: string;
  valueRank?: number; // -1 = scalar, 0 = 1D array, 1 = 2D array, etc.
  arrayDimensions?: Array<[number, number]>; // For each dimension: [start, end] e.g., [[1, 4], [0, 2]]
  parsedPath: VariablePath;
  statePath: string[]; // Path in the global state object
}

/**
 * Parse mapp Connect variable names according to the schema
 */
export class VariablePathParser {
  // Global default configuration (can be overridden by higher-level components)
  private static globalDefaults = {
    namespace: 'ns=5;s=',
    application: '', // Empty means use parser default
    task: 'AsGlobalPV' // Default task for variables without explicit task
  };

  /**
   * Configure global default namespace for nodeId generation
   */
  static setGlobalDefaultNamespace(namespace: string): void {
    VariablePathParser.globalDefaults.namespace = namespace.endsWith(';s=') ? namespace : namespace + ';s=';
  }

  /**
   * Configure global default application for nodeId generation
   */
  static setGlobalDefaultApplication(application: string): void {
    VariablePathParser.globalDefaults.application = application;
  }

  /**
   * Configure global default task for nodeId generation
   */
  static setGlobalDefaultTask(task: string): void {
    VariablePathParser.globalDefaults.task = task;
  }

  /**
   * Get current global defaults
   */
  static getGlobalDefaults(): { namespace: string; application: string; task: string } {
    return { ...VariablePathParser.globalDefaults };
  }
  
  /**
   * Parse a mapp Connect variable name into components
   * Supports multiple formats:
   * - 'VarName' → Global variable (AsGlobalPV scope)
   * - 'TaskName:VarName' → Task local variable
   * - '::TaskName:VarName' → Task local with empty module
   * - 'AppModule::TaskName:VarName' → Full format (module::task:variable)
   */
  static parse(variableName: string): VariablePath {
    // Handle different variable name formats
    
    // Check for format with :: separator (AppModule::TaskName:Variable or ::TaskName:Variable)
    if (variableName.includes('::')) {
      return this.parseModuleTaskFormat(variableName);
    }
    
    // Check if it contains a single : (task local)
    const colonCount = (variableName.match(/:/g) || []).length;
    if (colonCount === 1) {
      return this.parseTaskLocalFormat(variableName);
    }
    
    // No colons = global variable
    if (colonCount === 0) {
      return this.parseGlobalFormat(variableName);
    }
    
    throw new Error(`Invalid variable name format: ${variableName}`);
  }

  /**
   * Parse module::task format: AppModule::TaskName:Variable, ::TaskName:Variable, or ::GlobalVariable
   */
  private static parseModuleTaskFormat(variableName: string): VariablePath {
    // Split by :: to separate module and task:variable parts
    const parts = variableName.split('::');
    
    if (parts.length !== 2) {
      throw new Error(`Invalid module::task format: ${variableName}`);
    }
    
    const application = parts[0]; // Can be empty string
    const taskAndVariable = parts[1];
    
    // Check if there's a colon in the second part
    if (taskAndVariable.includes(':')) {
      // Format: AppModule::Task:Variable or ::Task:Variable
      const taskVariableParts = taskAndVariable.split(':');
      if (taskVariableParts.length !== 2) {
        throw new Error(`Invalid task:variable format in: ${taskAndVariable}`);
      }
      
      const task = taskVariableParts[0];
      const variableWithPath = taskVariableParts[1];
      
      const result = this.parseVariableWithPath(variableWithPath);
      
      return {
        application,
        task,
        variable: result.variable,
        path: result.path
      };
    } else {
      // Format: ::GlobalVariable (no colon, treat as global)
      const result = this.parseVariableWithPath(taskAndVariable);
      
      return {
        application, // Will be empty string for ::GlobalVariable
        task: 'AsGlobalPV', // Global variables use AsGlobalPV task
        variable: result.variable,
        path: result.path
      };
    }
  }

  /**
   * Parse task local format: TaskName:Variable
   */
  private static parseTaskLocalFormat(variableName: string): VariablePath {
    const parts = variableName.split(':');
    const task = parts[0];
    const variableWithPath = parts[1];
    
    const result = this.parseVariableWithPath(variableWithPath);
    
    return {
      application: '', // Default application
      task,
      variable: result.variable,
      path: result.path
    };
  }

  /**
   * Parse global format: Variable (no colons)
   */
  private static parseGlobalFormat(variableName: string): VariablePath {
    const result = this.parseVariableWithPath(variableName);
    
    return {
      application: '', // Default application
      task: 'AsGlobalPV', // Global scope
      variable: result.variable,
      path: result.path
    };
  }

  /**
   * Parse variable with structure path and array indices
   */
  private static parseVariableWithPath(variableWithPath: string): {
    variable: string;
    path: string[];
  } {
    const path: string[] = [];
    
    // Split by dots to get structure path
    const parts = variableWithPath.split('.');
    
    // Extract the clean variable name (remove any array indices from the first part)
    let variable = parts[0];
    const rootArrayMatches = variable.match(/\[([^\]]+)\]/g);
    if (rootArrayMatches) {
      // Extract array indices from root variable and add to path
      for (const match of rootArrayMatches) {
        // Add array indices to path with brackets (clearer representation)
        path.push(match); // Keep the full [0,1] format
      }
      // Clean the variable name
      variable = variable.replace(/\[[^\]]+\]/g, '');
    }
    
    // Process each part for array indices and structure navigation
    for (let i = 1; i < parts.length; i++) {
      let part = parts[i];
      
      // Extract array indices from this part and add them to path
      const arrayMatches = part.match(/\[([^\]]+)\]/g);
      if (arrayMatches) {
        // Remove array indices from part name first
        part = part.replace(/\[[^\]]+\]/g, '');
        
        // Add the part name to path
        if (part) {
          path.push(part);
        }
        
        // Add each array index bracket as a separate path segment
        for (const match of arrayMatches) {
          // Add array indices to path with brackets (e.g., "[0,1]")
          path.push(match); // Keep the full [0,1] format
        }
      } else {
        // Add to path
        if (part) {
          path.push(part);
        }
      }
    }

    return { variable, path };
  }

  /**
   * Convert parsed path to state path for global object
   * Stores as: appModule.scope.variable.path... (clean hierarchy)
   */
  static toStatePath(parsedPath: VariablePath): string[] {
    const statePath: string[] = [];
    
    // Add application if not empty, otherwise use a default key
    if (parsedPath.application) {
      statePath.push(parsedPath.application);
    } else {
      statePath.push('_default'); // Default app module when empty
    }
    
    // Add scope (task or AsGlobalPV) - always present
    const scope = parsedPath.task || 'AsGlobalPV';
    statePath.push(scope);
    
    // Add base variable
    statePath.push(parsedPath.variable);
    
    // Add structure path (which already includes array indices as string segments)
    statePath.push(...parsedPath.path);
    
    // Note: Array indices are already included in the path, so we don't add them separately
    // This avoids duplication while maintaining backward compatibility
    
    return statePath;
  }

  /**
   * Reconstruct the original variable name from parsed components
   * Always uses the full AppModule::Task:Variable format
   */
  static reconstruct(parsedPath: VariablePath): string {
    let result = '';
    
    // Always use the full module::task:variable format
    result += `${parsedPath.application}::${parsedPath.task}:`;
    
    // Add base variable name
    result += parsedPath.variable;
    
    // Add path segments
    for (const segment of parsedPath.path) {
      if (segment.startsWith('[') && segment.endsWith(']')) {
        // Array index - append directly (no dot)
        result += segment;
      } else {
        // Property name - append with dot
        result += '.' + segment;
      }
    }
    
    return result;
  }

  /**
   * Build OPC UA nodeId from variable name with optional configuration overrides
   * Falls back to global defaults when options are not provided
   */
  static buildNodeId(varName: string, options: {
    namespace?: string;
    nodeId?: string;
    defaultApplication?: string;
    defaultTask?: string;
  } = {}): string {
    // If explicit nodeId provided, use it
    if (options.nodeId) {
      return options.nodeId;
    }
    
    // If varName already has OPC UA namespace prefix, use as-is
    if (varName.includes('ns=') || varName.includes('i=') || varName.includes('s=')) {
      return varName;
    }
    
    // Parse the variable name to ensure it's in proper module::task:variable format
    let normalizedVarName: string;
    try {
      const parsedPath = VariablePathParser.parse(varName);
      
      // Apply defaults (use provided options or fall back to global defaults)
      const defaultApplication = options.defaultApplication ?? VariablePathParser.globalDefaults.application;
      const defaultTask = options.defaultTask ?? VariablePathParser.globalDefaults.task;
      
      if (!parsedPath.application && defaultApplication) {
        parsedPath.application = defaultApplication;
      }
      
      if (!parsedPath.task || parsedPath.task === 'AsGlobalPV') {
        if (defaultTask && defaultTask !== 'AsGlobalPV') {
          parsedPath.task = defaultTask;
        }
      }
      
      // Ensure task defaults to AsGlobalPV if still empty
      if (!parsedPath.task) {
        parsedPath.task = 'AsGlobalPV';
      }
      
      // Reconstruct the normalized variable name
      normalizedVarName = VariablePathParser.reconstruct(parsedPath);
    } catch (error) {
      // If parsing fails, use the variable name as-is
      normalizedVarName = varName;
    }
    
    // Use provided namespace or fall back to global default
    const namespace = options.namespace ?? VariablePathParser.globalDefaults.namespace;
    return namespace + normalizedVarName;
  }
}

/**
 * Variable hierarchy using global state object
 */
export class VariableHierarchy {
  private globalState: any = {};
  private variables = new Map<string, VariableMapping>();
  private nodeIdToName = new Map<string, string>();
  private stateMetadata = new Map<string, { timestamp: Date; quality: string }>();
  private arrayDimensionsCache = new Map<string, Array<[number, number]>>(); // Cache for array dimensions by base variable name

  /**
   * Add a variable to the hierarchy
   */
  addVariable(
    name: string, 
    nodeId: string, 
    value: any, 
    timestamp: Date, 
    quality: string, 
    dataType?: string,
    valueRank?: number,
    arrayDimensions?: Array<[number, number]>
  ): VariableMapping {
    const parsedPath = VariablePathParser.parse(name);
    const statePath = VariablePathParser.toStatePath(parsedPath);
    
    const mapping: VariableMapping = {
      name,
      nodeId,
      parsedPath,
      statePath,
      ...(dataType && { dataType }),
      ...(valueRank !== undefined && { valueRank }),
      ...(arrayDimensions && { arrayDimensions })
    };

    // Store the mapping
    // Cache array dimensions if provided
    if (arrayDimensions) {
      const baseArrayName = this.extractBaseArrayName(name);
      if (baseArrayName) {
        this.arrayDimensionsCache.set(baseArrayName, arrayDimensions);
      }
    }

    this.variables.set(name, mapping);
    this.nodeIdToName.set(nodeId, name);
    
    // Update global state directly
    this.setValueAtPath(this.globalState, statePath, value);
    this.stateMetadata.set(name, { timestamp, quality });
    
    return mapping;
  }

  /**
   * Update a variable value with automatic propagation
   */
  updateVariable(name: string, value: any, timestamp: Date, quality: string): string[] {
    let mapping = this.variables.get(name);
    if (!mapping) {
      // If no mapping exists, create one with proper nodeId (uses global defaults from VariablePathParser)
      const nodeId = VariablePathParser.buildNodeId(name);
      mapping = this.addVariable(name, nodeId, value, timestamp, quality);
      return [name]; // Return just this variable as affected
    }

    // Update global state directly
    this.setValueAtPath(this.globalState, mapping.statePath, value);
    this.stateMetadata.set(name, { timestamp, quality });
    
    // Find all variables that might be affected by this change
    return this.findAffectedVariables(mapping);
  }

  /**
   * Get variable by name
   */
  getVariable(name: string): { mapping: VariableMapping; value: any; timestamp: Date; quality: string } | undefined {
    const mapping = this.variables.get(name);
    if (!mapping) return undefined;

    const value = this.getValueAtPath(this.globalState, mapping.statePath);
    const metadata = this.stateMetadata.get(name) || { timestamp: new Date(), quality: 'unknown' };
    
    return { mapping, value, ...metadata };
  }

  /**
   * Get variable by nodeId
   */
  getVariableByNodeId(nodeId: string): { mapping: VariableMapping; value: any; timestamp: Date; quality: string } | undefined {
    const name = this.nodeIdToName.get(nodeId);
    return name ? this.getVariable(name) : undefined;
  }

  /**
   * Get all variables
   */
  getAllVariables(): Map<string, { mapping: VariableMapping; value: any; timestamp: Date; quality: string }> {
    const result = new Map();
    
    for (const [name] of this.variables) {
      const varData = this.getVariable(name);
      if (varData) {
        result.set(name, varData);
      }
    }
    
    return result;
  }

  /**
   * Remove variable from hierarchy
   */
  removeVariable(name: string): boolean {
    const mapping = this.variables.get(name);
    if (!mapping) return false;

    // Remove from mappings
    this.variables.delete(name);
    this.nodeIdToName.delete(mapping.nodeId);
    this.stateMetadata.delete(name);
    
    // Note: We don't remove from global state to avoid affecting other variables
    // that might share the same state path
    
    return true;
  }

  /**
   * Find variables that share state paths (potential conflicts/relationships)
   */
  findRelatedVariables(name: string): Array<{ type: 'parent' | 'child' | 'sibling'; variable: string }> {
    const mapping = this.variables.get(name);
    if (!mapping) return [];

    const related: Array<{ type: 'parent' | 'child' | 'sibling'; variable: string }> = [];
    
    for (const [otherName, otherMapping] of this.variables) {
      if (otherName === name) continue;
      
      const relationship = this.getRelationshipType(mapping.statePath, otherMapping.statePath);
      if (relationship) {
        related.push({ type: relationship, variable: otherName });
      }
    }
    
    return related;
  }


  /**
   * Get a reference to the global state object
   * WARNING: The returned object should be treated as read-only.
   * Modifying it directly will bypass validation and notification systems.
   * Use updateVariable() or writeVariable() methods to make changes.
   */
  getGlobalState(): any {
    return this.globalState;
  }

  /**
   * Find all variables that might be affected by a change to the given variable
   */
  private findAffectedVariables(changedMapping: VariableMapping): string[] {
    const affected: string[] = [changedMapping.name]; // Always include the changed variable itself
    
    for (const [name, mapping] of this.variables) {
      if (name === changedMapping.name) continue;
      
      // Check if this variable's path is affected by the change
      if (this.isPathAffected(mapping.statePath, changedMapping.statePath)) {
        affected.push(name);
      }
    }
    
    return affected;
  }

  /**
   * Check if a variable path is affected by changes to another path
   */
  private isPathAffected(variablePath: string[], changedPath: string[]): boolean {
    // If variable path is a parent of changed path, it's affected
    if (this.isParentPath(variablePath, changedPath)) {
      return true;
    }
    
    // If variable path is a child of changed path, it's affected
    if (this.isParentPath(changedPath, variablePath)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if one path is a parent of another
   */
  private isParentPath(parentPath: string[], childPath: string[]): boolean {
    if (parentPath.length >= childPath.length) {
      return false;
    }
    
    for (let i = 0; i < parentPath.length; i++) {
      if (parentPath[i] !== childPath[i]) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get relationship type between two paths
   */
  private getRelationshipType(path1: string[], path2: string[]): 'parent' | 'child' | 'sibling' | null {
    if (this.isParentPath(path1, path2)) {
      return 'child'; // path1 is parent of path2, so path2 is a child from path1's perspective
    }
    if (this.isParentPath(path2, path1)) {
      return 'parent'; // path2 is parent of path1, so path2 is a parent from path1's perspective
    }
    
    // Check if they're siblings (same parent)
    if (path1.length > 1 && path2.length > 1) {
      const parent1 = path1.slice(0, -1);
      const parent2 = path2.slice(0, -1);
      if (this.arraysEqual(parent1, parent2)) {
        return 'sibling';
      }
    }
    
    return null;
  }

  /**
   * Get value at a specific path in an object
   */
  private getValueAtPath(obj: any, path: string[]): any {
    let current = obj;
    for (const segment of path) {
      if (current == null || typeof current !== 'object') {
        return undefined;
      }
      
      if (this.isArrayIndex(segment)) {
        // Handle array indices - support flat arrays only
        const indices = this.parseArrayIndices(segment);
        
        // For multi-dimensional access, calculate flat index
        if (indices.length > 1) {
          // TODO: Look up array dimensions and calculate flat index
          // For now, navigate nested structure for testing compatibility
          let target = current;
          for (const index of indices) {
            if (target == null || typeof target !== 'object' || target[index] == null) {
              return undefined;
            }
            target = target[index];
          }
          current = target;
        } else {
          // Single-dimensional access
          const index = indices[0];
          if (current == null || typeof current !== 'object' || current[index] == null) {
            return undefined;
          }
          current = current[index];
        }
      } else {
        // Handle regular object properties
        current = current[segment];
      }
    }
    return current;
  }

  /**
   * Set value at a specific path in an object (mutates the object directly for performance)
   */
  private setValueAtPath(obj: any, path: string[], value: any): void {
    if (path.length === 0) {
      // Cannot set root object directly
      throw new Error('Cannot set value at empty path');
    }
    
    // Navigate to the target location, creating intermediate objects as needed
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      let isArray = false;
      if (path.length > i + 1) {
        const nextSegment = path[i + 1];
        isArray = this.isArrayIndex(nextSegment);
      }
      const segment = path[i];
      current = this.ensurePathSegment(current, segment, isArray);
    }
    
    // Set the final value directly
    const finalSegment = path[path.length - 1];
    this.setPathSegmentValue(current, finalSegment, value);
  }

  /**
   * Ensure a path segment exists and return the next level
   */
  private ensurePathSegment(current: any, segment: string, isArray: boolean): any {
    if (this.isArrayIndex(segment)) {
      // Handle array indices - keep arrays flat and simple
      const indices = this.parseArrayIndices(segment);
      
      // For multi-dimensional access like [1,2,3], calculate flat index
      if (indices.length > 1) {
        // TODO: Look up array dimensions and calculate flat index
        // For now, create nested array structure for testing compatibility
        let target = current;
        for (let j = 0; j < indices.length - 1; j++) {
          const index = indices[j];
          if (!Array.isArray(target)) {
            // Convert to array if needed
            const newArray: any[] = [];
            if (target && typeof target === 'object') {
              Object.keys(target).forEach(key => {
                const numKey = parseInt(key, 10);
                if (!isNaN(numKey) && numKey.toString() === key) {
                  newArray[numKey] = target[key];
                }
              });
            }
            Object.keys(target).forEach(key => delete target[key]);
            Object.assign(target, newArray);
            Object.setPrototypeOf(target, Array.prototype);
            target.length = newArray.length;
          }
          
          if (target[index] == null) {
            target[index] = [];
          }
          target = target[index];
        }
        
        const finalIndex = indices[indices.length - 1];
        if (target[finalIndex] == null) {
          target[finalIndex] = {};
        }
        return target[finalIndex];
      }
      
      // Single-dimensional access - ensure current is a proper array
      if (!Array.isArray(current)) {
        // Convert object with numeric keys to real array
        const newArray: any[] = [];
        if (current && typeof current === 'object') {
          Object.keys(current).forEach(key => {
            const numKey = parseInt(key, 10);
            if (!isNaN(numKey) && numKey.toString() === key) {
              newArray[numKey] = current[key];
            }
          });
        }
        
        // Replace the object with a real array
        Object.keys(current).forEach(key => delete current[key]);
        Object.assign(current, newArray);
        Object.setPrototypeOf(current, Array.prototype);
        current.length = newArray.length;
        
        console.log(`Created array for segment: ${segment}, isArray: ${Array.isArray(current)}`);
      }
      
      const index = indices[0];
      if (current[index] == null) {
        current[index] = {};
      }
      return current[index];
    } else {
      // Handle regular object properties
      if (current[segment] == null) {
        current[segment] = isArray ? [] : {};
      } else if (isArray && !Array.isArray(current[segment])) {
        // Convert object to array if needed
        const newArray: any[] = [];
        if (typeof current[segment] === 'object') {
          Object.keys(current[segment]).forEach(key => {
        const numKey = parseInt(key, 10);
        if (!isNaN(numKey) && numKey.toString() === key) {
          newArray[numKey] = current[segment][key];
        }
          });
        }
        current[segment] = newArray;
      } else if (!isArray && Array.isArray(current[segment])) {
        // Convert array to object if needed
        const newObj: any = {};
        current[segment].forEach((value, index) => {
          newObj[index] = value;
        });
        current[segment] = newObj;
      }
      return current[segment];
    }
  }

  /**
   * Set a value on a path segment (final step)
   */
  private setPathSegmentValue(current: any, segment: string, value: any): void {
    if (this.isArrayIndex(segment)) {
      // Handle array indices 
      const indices = this.parseArrayIndices(segment);
      
      // Multi-dimensional access - for now support nested structure for testing
      if (indices.length > 1) {
        let target = current;
        for (let j = 0; j < indices.length - 1; j++) {
          const index = indices[j];
          if (target[index] == null) {
            target[index] = [];
          }
          target = target[index];
        }
        target[indices[indices.length - 1]] = value;
      } else {
        // Single-dimensional access
        const index = indices[0];
        current[index] = value;
      }
    } else {
      // Handle regular object properties
      if (this.shouldMergeObjects(current[segment], value)) {
        // Perform deep merge instead of replacement
        current[segment] = this.deepMerge(current[segment], value);
      } else {
        // Replace for non-objects or when current doesn't exist
        current[segment] = value;
      }
    }
  }

  /**
   * Check if two values should be merged (both are mergeable objects or arrays)
   */
  private shouldMergeObjects(existing: any, newValue: any): boolean {
    return existing != null &&
           newValue != null &&
           this.isMergeable(existing) &&
           this.isMergeable(newValue) &&
           (this.isPlainObject(existing) === this.isPlainObject(newValue)); // Both objects or both arrays
  }

  /**
   * Check if a value is mergeable (plain object or array)
   */
  private isMergeable(value: any): boolean {
    return this.isPlainObject(value) || Array.isArray(value);
  }

  /**
   * Check if a value is a plain object (not array, date, or other special types)
   */
  private isPlainObject(value: any): boolean {
    return value != null &&
           typeof value === 'object' &&
           !Array.isArray(value) &&
           !(value instanceof Date) &&
           value.constructor === Object;
  }

  /**
   * Deep merge two objects or arrays, with newObj properties overriding existing ones
   */
  private deepMerge(existing: any, newObj: any): any {
    // Handle array merging by index
    if (Array.isArray(existing) && Array.isArray(newObj)) {
      return this.mergeArraysByIndex(existing, newObj);
    }

    // Handle object merging
    if (this.isPlainObject(existing) && this.isPlainObject(newObj)) {
      return this.mergeObjects(existing, newObj);
    }

    // Fallback: replace entirely
    return newObj;
  }

  /**
   * Merge arrays by index, preserving existing elements not overridden by new array
   */
  private mergeArraysByIndex(existingArray: any[], newArray: any[]): any[] {
    // Start with a copy of the existing array
    const result = [...existingArray];

    // Override/extend with new array values
    for (let i = 0; i < newArray.length; i++) {
      const newValue = newArray[i];
      
      // Skip undefined values (preserve existing)
      if (newValue === undefined) {
        continue;
      }
      
      const existingValue = result[i];

      if (this.shouldMergeObjects(existingValue, newValue)) {
        // Recursively merge nested objects/arrays
        result[i] = this.deepMerge(existingValue, newValue);
      } else {
        // Replace with new value (primitives, null, different types, etc.)
        result[i] = newValue;
      }
    }

    return result;
  }

  /**
   * Merge plain objects, with new properties overriding existing ones
   */
  private mergeObjects(existingObj: any, newObj: any): any {
    const result = { ...existingObj };

    for (const key in newObj) {
      const newValue = newObj[key];
      const existingValue = result[key];

      if (this.shouldMergeObjects(existingValue, newValue)) {
        // Recursively merge nested objects/arrays
        result[key] = this.deepMerge(existingValue, newValue);
      } else {
        // Replace with new value (primitives, arrays, null, etc.)
        result[key] = newValue;
      }
    }

    return result;
  }

  /**
   * Check if a segment represents an array index like [0] or [1,2]
   */
  private isArrayIndex(segment: string): boolean {
    return segment.startsWith('[') && segment.endsWith(']');
  }

  /**
   * Calculate flat array index from multi-dimensional indices using OPC UA array dimensions
   * @param indices The multi-dimensional indices (e.g., [3, 1] for Matrix[3,1])
   * @param arrayDimensions The OPC UA array dimensions (e.g., [[1, 4], [0, 2]])
   * @returns The flat index to access the value in a 1D array
   */
  /* TODO: Implement multi-dimensional array support
  private calculateFlatIndex(indices: number[], arrayDimensions: Array<[number, number]>): number {
    if (indices.length !== arrayDimensions.length) {
      throw new Error(`Index dimensions (${indices.length}) must match array dimensions (${arrayDimensions.length})`);
    }

    // Validate indices are within bounds and normalize them (subtract start values)
    const normalizedIndices: number[] = [];
    const sizes: number[] = [];
    
    for (let i = 0; i < indices.length; i++) {
      const [start, end] = arrayDimensions[i];
      const index = indices[i];
      
      if (index < start || index > end) {
        throw new Error(`Index ${index} is out of bounds for dimension ${i} [${start}, ${end}]`);
      }
      
      normalizedIndices[i] = index - start; // Normalize to zero-based
      sizes[i] = end - start + 1; // Calculate size of this dimension
    }

    // Calculate flat index using row-major order (rightmost dimension varies fastest)
    let flatIndex = 0;
    let multiplier = 1;
    
    for (let i = normalizedIndices.length - 1; i >= 0; i--) {
      flatIndex += normalizedIndices[i] * multiplier;
      multiplier *= sizes[i];
    }

    return flatIndex;
  }
  */

  /**
   * Extract the base array name from a variable name
   * Examples: 
   * - 'Matrix[1,2,3]' → 'Matrix'
   * - 'DataArray[5].Value' → 'DataArray' 
   * - 'Sensor[0].Readings[1,2]' → first occurrence would be 'Sensor'
   */
  private extractBaseArrayName(variableName: string): string | null {
    const firstBracket = variableName.indexOf('[');
    if (firstBracket === -1) return null; // No array syntax
    
    // Find the variable name before the first bracket
    const beforeBracket = variableName.substring(0, firstBracket);
    
    // Handle dot-separated paths - we want the last segment before the bracket
    const segments = beforeBracket.split('.');
    return segments[segments.length - 1] || null;
  }

  /**
   * Parse array indices from a segment like [0] or [1,2,3]
   */
  private parseArrayIndices(segment: string): number[] {
    const content = segment.slice(1, -1); // Remove [ and ]
    return content.split(',').map(s => parseInt(s.trim(), 10));
  }

  /**
   * Check if an object has array-like string keys (like "[0]", "[1]")
   */
  /* TODO: Remove if not needed for backward compatibility
  private hasArrayLikeKeys(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    return keys.length > 0 && keys.every(key => /^\[\d+.*\]$/.test(key));
  }
  */

  /**
   * Convert an object with array-like keys to a proper array
   */
  /* TODO: Remove if not needed for backward compatibility
  private convertObjectToArray(obj: any): any[] {
  /* TODO: Remove if not needed for backward compatibility
  private convertObjectToArray(obj: any): any[] {
    const result: any[] = [];
    
    for (const [key, value] of Object.entries(obj)) {
      if (this.isArrayIndex(key)) {
        const indices = this.parseArrayIndices(key);
        let target = result;
        
        // Navigate to the right position in multi-dimensional array
        for (let i = 0; i < indices.length - 1; i++) {
          const index = indices[i];
          if (target[index] == null) {
            target[index] = [];
          }
          target = target[index];
        }
        
        target[indices[indices.length - 1]] = value;
      }
    }
    
    return result;
  }
  */

  /**
   * Deep clone a value
   */
  private deepClone(value: any): any {
    if (value == null || typeof value !== 'object') {
      return value;
    }
    
    if (Array.isArray(value)) {
      return value.map(item => this.deepClone(item));
    }
    
    const cloned: any = {};
    for (const [key, val] of Object.entries(value)) {
      cloned[key] = this.deepClone(val);
    }
    return cloned;
  }

  /**
   * Check if two arrays are equal
   */
  private arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }
}
