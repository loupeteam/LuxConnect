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
  parsedPath: VariablePath;
  statePath: string[]; // Path in the global state object
  dataType?: string;
}

/**
 * Parse mapp Connect variable names according to the schema
 */
export class VariablePathParser {
  
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
}

/**
 * Simplified variable hierarchy using global state object
 */
export class VariableHierarchy {
  private globalState: any = {};
  private variables = new Map<string, VariableMapping>();
  private nodeIdToName = new Map<string, string>();
  private stateMetadata = new Map<string, { timestamp: Date; quality: string }>();

  /**
   * Add a variable to the hierarchy
   */
  addVariable(name: string, nodeId: string, value: any, timestamp: Date, quality: string, dataType?: string): VariableMapping {
    const parsedPath = VariablePathParser.parse(name);
    const statePath = VariablePathParser.toStatePath(parsedPath);
    
    const mapping: VariableMapping = {
      name,
      nodeId,
      parsedPath,
      statePath,
      ...(dataType && { dataType })
    };

    // Store the mapping
    this.variables.set(name, mapping);
    this.nodeIdToName.set(nodeId, name);
    
    // Update global state
    this.globalState = this.setValueAtPath(this.globalState, statePath, value);
    this.stateMetadata.set(name, { timestamp, quality });
    
    return mapping;
  }

  /**
   * Update a variable value with automatic propagation
   */
  updateVariable(name: string, value: any, timestamp: Date, quality: string): string[] {
    const mapping = this.variables.get(name);
    if (!mapping) return [];

    // Update global state
    this.globalState = this.setValueAtPath(this.globalState, mapping.statePath, value);
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
   * Get the current global state (for debugging)
   */
  getGlobalState(): any {
    return this.deepClone(this.globalState);
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
      return 'parent';
    }
    if (this.isParentPath(path2, path1)) {
      return 'child';
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
      current = current[segment];
    }
    return current;
  }

  /**
   * Set value at a specific path in an object (returns new object)
   */
  private setValueAtPath(obj: any, path: string[], value: any): any {
    if (path.length === 0) return value;
    
    // Deep clone the object
    const newObj = this.deepClone(obj);
    
    // Navigate to the target location
    let current = newObj;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      if (current[segment] == null || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment];
    }
    
    // Set the final value
    current[path[path.length - 1]] = value;
    
    return newObj;
  }

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
