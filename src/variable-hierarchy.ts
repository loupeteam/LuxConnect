/**
 * Variable hierarchy management for complex mapp Connect variable structures
 * Handles structured variables, arrays, and sub-element relationships
 */

export interface VariablePath {
  application: string;
  task: string;
  variable: string;
  path: string[];  // For structure navigation like ['SubStruct', 'Element']
  arrayIndices: number[][]; // For array access like [[2], [3,4]] for nested arrays
}

export interface HierarchicalVariable {
  nodeId: string;
  name: string;
  parsedPath: VariablePath;
  value: any;
  timestamp: Date;
  quality: string;
  dataType?: string;
  isStructure: boolean;
  isArray: boolean;
  children?: Map<string, HierarchicalVariable>;
  parent?: HierarchicalVariable | undefined;
}

/**
 * Parse mapp Connect variable names according to the schema
 */
export class VariablePathParser {
  
  /**
   * Parse a mapp Connect variable name into components
   * Examples:
   * - AppModuleName::MyGlobalVar1
   * - ::AsGlobalPV:MyGlobalVar2  
   * - AppModuleName::MyTask1:MyLocalVar1
   * - AppModuleName::AsGlobalPV:MyGlobalArray1[4]
   * - ::MyTask2:MyLocalStruct1.ArrayOfStruct[2].Element1
   */
  static parse(variableName: string): VariablePath {
    // Split by :: to get application and task::variable parts
    const mainParts = variableName.split('::');
    if (mainParts.length !== 2) {
      throw new Error(`Invalid variable name format: ${variableName}`);
    }

    const application = mainParts[0]; // Can be empty string
    const taskVariablePart = mainParts[1];

    // Split task:variable part
    const taskVariableParts = taskVariablePart.split(':');
    let task = '';
    let variableWithPath = '';

    if (taskVariableParts.length === 1) {
      // No task specified, this is the variable
      variableWithPath = taskVariableParts[0];
    } else if (taskVariableParts.length === 2) {
      // Task:Variable format
      task = taskVariableParts[0];
      variableWithPath = taskVariableParts[1];
    } else {
      throw new Error(`Invalid task:variable format in: ${variableName}`);
    }

    // Parse variable with potential structure path and array indices
    const result = this.parseVariableWithPath(variableWithPath);

    return {
      application,
      task,
      variable: result.variable,
      path: result.path,
      arrayIndices: result.arrayIndices
    };
  }

  /**
   * Parse variable with structure path and array indices
   */
  private static parseVariableWithPath(variableWithPath: string): {
    variable: string;
    path: string[];
    arrayIndices: number[][];
  } {
    const path: string[] = [];
    const arrayIndices: number[][] = [];
    
    // Split by dots to get structure path
    const parts = variableWithPath.split('.');
    const variable = parts[0];
    
    // Process each part for array indices and structure navigation
    for (let i = 0; i < parts.length; i++) {
      let part = parts[i];
      
      // Extract array indices from this part
      const arrayMatches = part.match(/\[([^\]]+)\]/g);
      if (arrayMatches) {
        for (const match of arrayMatches) {
          const indexStr = match.slice(1, -1); // Remove [ ]
          const indices = indexStr.split(',').map(s => parseInt(s.trim()));
          arrayIndices.push(indices);
        }
        // Remove array indices from part name
        part = part.replace(/\[[^\]]+\]/g, '');
      }
      
      // Add to path (except for the root variable)
      if (i > 0 && part) {
        path.push(part);
      }
    }

    return { variable, path, arrayIndices };
  }

  /**
   * Build the full variable name from parsed components
   */
  static build(parsedPath: VariablePath): string {
    let result = `${parsedPath.application}::`;
    
    if (parsedPath.task) {
      result += `${parsedPath.task}:`;
    }
    
    result += parsedPath.variable;
    
    // Add structure path
    if (parsedPath.path.length > 0) {
      result += '.' + parsedPath.path.join('.');
    }
    
    // Add array indices (simplified - assumes one array access per path segment)
    for (const indices of parsedPath.arrayIndices) {
      result += `[${indices.join(',')}]`;
    }
    
    return result;
  }

  /**
   * Check if one variable path is a parent of another
   */
  static isParentOf(parent: VariablePath, child: VariablePath): boolean {
    // Must be same application, task, and base variable
    if (parent.application !== child.application ||
        parent.task !== child.task ||
        parent.variable !== child.variable) {
      return false;
    }

    // Parent path must be shorter and a prefix of child path
    if (parent.path.length >= child.path.length) {
      return false;
    }

    // Check if parent path is a prefix of child path
    for (let i = 0; i < parent.path.length; i++) {
      if (parent.path[i] !== child.path[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if one variable path is a child of another
   */
  static isChildOf(child: VariablePath, parent: VariablePath): boolean {
    return this.isParentOf(parent, child);
  }

  /**
   * Get the relative path from parent to child
   */
  static getRelativePath(parent: VariablePath, child: VariablePath): string[] {
    if (!this.isParentOf(parent, child)) {
      throw new Error('Child is not a descendant of parent');
    }

    return child.path.slice(parent.path.length);
  }
}

/**
 * Manages hierarchical relationships between variables
 */
export class VariableHierarchy {
  private variables = new Map<string, HierarchicalVariable>();
  private nodeIdToName = new Map<string, string>();

  /**
   * Add a variable to the hierarchy
   */
  addVariable(name: string, nodeId: string, value: any, timestamp: Date, quality: string, dataType?: string): HierarchicalVariable {
    const parsedPath = VariablePathParser.parse(name);
    
    const variable: HierarchicalVariable = {
      nodeId,
      name,
      parsedPath,
      value,
      timestamp,
      quality,
      ...(dataType && { dataType }),
      isStructure: this.isStructureType(dataType),
      isArray: this.isArrayType(dataType),
      children: new Map()
    };

    this.variables.set(name, variable);
    this.nodeIdToName.set(nodeId, name);
    
    // Establish parent-child relationships
    this.updateHierarchicalRelationships(variable);
    
    return variable;
  }

  /**
   * Update a variable value and propagate changes through hierarchy
   */
  updateVariable(name: string, value: any, timestamp: Date, quality: string): void {
    const variable = this.variables.get(name);
    if (!variable) return;

    variable.value = value;
    variable.timestamp = timestamp;
    variable.quality = quality;

    // If this is a structure, update child values
    if (variable.isStructure && typeof value === 'object' && value !== null) {
      this.updateChildrenFromStructureValue(variable, value);
    }

    // If this is a child, update parent structure
    if (variable.parent) {
      this.updateParentFromChildValue(variable);
    }
  }

  /**
   * Get variable by name
   */
  getVariable(name: string): HierarchicalVariable | undefined {
    return this.variables.get(name);
  }

  /**
   * Get variable by nodeId
   */
  getVariableByNodeId(nodeId: string): HierarchicalVariable | undefined {
    const name = this.nodeIdToName.get(nodeId);
    return name ? this.variables.get(name) : undefined;
  }

  /**
   * Get all variables
   */
  getAllVariables(): Map<string, HierarchicalVariable> {
    return new Map(this.variables);
  }

  /**
   * Remove variable from hierarchy
   */
  removeVariable(name: string): boolean {
    const variable = this.variables.get(name);
    if (!variable) return false;

    // Remove from nodeId mapping
    this.nodeIdToName.delete(variable.nodeId);
    
    // Remove from parent's children
    if (variable.parent) {
      variable.parent.children?.delete(name);
    }
    
    // Remove children references
    if (variable.children) {
      for (const child of variable.children.values()) {
        child.parent = undefined;
      }
    }
    
    return this.variables.delete(name);
  }

  /**
   * Get all children of a variable (recursive)
   */
  getChildren(name: string, recursive = false): HierarchicalVariable[] {
    const variable = this.variables.get(name);
    if (!variable || !variable.children) return [];

    const children = Array.from(variable.children.values());
    
    if (recursive) {
      const allChildren = [...children];
      for (const child of children) {
        allChildren.push(...this.getChildren(child.name, true));
      }
      return allChildren;
    }
    
    return children;
  }

  /**
   * Get parent of a variable
   */
  getParent(name: string): HierarchicalVariable | undefined {
    const variable = this.variables.get(name);
    return variable?.parent;
  }

  /**
   * Check if there are any conflicts (same structure subscribed at different levels)
   */
  findConflicts(): Array<{ parent: string; children: string[] }> {
    const conflicts: Array<{ parent: string; children: string[] }> = [];
    
    for (const [name, variable] of this.variables) {
      if (variable.children && variable.children.size > 0) {
        const conflictingChildren = Array.from(variable.children.keys());
        if (conflictingChildren.length > 0) {
          conflicts.push({ parent: name, children: conflictingChildren });
        }
      }
    }
    
    return conflicts;
  }

  /**
   * Update hierarchical relationships for a variable
   */
  private updateHierarchicalRelationships(variable: HierarchicalVariable): void {
    for (const [otherName, otherVariable] of this.variables) {
      if (otherName === variable.name) continue;

      // Check if variable is a parent of otherVariable
      if (VariablePathParser.isParentOf(variable.parsedPath, otherVariable.parsedPath)) {
        variable.children!.set(otherName, otherVariable);
        otherVariable.parent = variable;
      }
      // Check if variable is a child of otherVariable
      else if (VariablePathParser.isChildOf(variable.parsedPath, otherVariable.parsedPath)) {
        otherVariable.children!.set(variable.name, variable);
        variable.parent = otherVariable;
      }
    }
  }

  /**
   * Update children values when parent structure changes
   */
  private updateChildrenFromStructureValue(parent: HierarchicalVariable, structureValue: any): void {
    if (!parent.children) return;

    for (const [childName, child] of parent.children) {
      try {
        const relativePath = VariablePathParser.getRelativePath(parent.parsedPath, child.parsedPath);
        const childValue = this.getValueAtPath(structureValue, relativePath);
        
        if (childValue !== undefined) {
          child.value = childValue;
          child.timestamp = parent.timestamp;
          child.quality = parent.quality;
        }
      } catch (error) {
        console.warn(`Failed to update child ${childName} from parent ${parent.name}:`, error);
      }
    }
  }

  /**
   * Update parent structure when child value changes
   */
  private updateParentFromChildValue(child: HierarchicalVariable): void {
    if (!child.parent) return;

    try {
      const relativePath = VariablePathParser.getRelativePath(child.parent.parsedPath, child.parsedPath);
      
      // Clone parent value and update the specific path
      const parentValue = this.cloneValue(child.parent.value);
      this.setValueAtPath(parentValue, relativePath, child.value);
      
      child.parent.value = parentValue;
      child.parent.timestamp = new Date(); // Use current time for derived update
    } catch (error) {
      console.warn(`Failed to update parent ${child.parent.name} from child ${child.name}:`, error);
    }
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
   * Set value at a specific path in an object
   */
  private setValueAtPath(obj: any, path: string[], value: any): void {
    if (path.length === 0) return;
    
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      if (current[segment] == null || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment];
    }
    
    current[path[path.length - 1]] = value;
  }

  /**
   * Deep clone a value
   */
  private cloneValue(value: any): any {
    if (value == null || typeof value !== 'object') {
      return value;
    }
    
    if (Array.isArray(value)) {
      return value.map(item => this.cloneValue(item));
    }
    
    const cloned: any = {};
    for (const [key, val] of Object.entries(value)) {
      cloned[key] = this.cloneValue(val);
    }
    return cloned;
  }

  /**
   * Check if a data type represents a structure
   */
  private isStructureType(dataType?: string): boolean {
    if (!dataType) return false;
    // This would need to be expanded based on actual OPC UA data types
    return dataType.includes('Struct') || dataType.includes('Object');
  }

  /**
   * Check if a data type represents an array
   */
  private isArrayType(dataType?: string): boolean {
    if (!dataType) return false;
    // This would need to be expanded based on actual OPC UA data types
    return dataType.includes('Array') || dataType.includes('[]');
  }
}
