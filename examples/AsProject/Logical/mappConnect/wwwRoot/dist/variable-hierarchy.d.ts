import { OpcuaValue, OpcuaObject } from './types';
/**
 * Simplified variable hierarchy using a single state object with deep copying
 * Much simpler approach that's easier to understand and maintain
 */
export interface VariablePath {
    application: string;
    task: string;
    variable: string;
    path: string[];
}
export interface VariableMapping {
    name: string;
    nodeId: string;
    dataType?: string;
    valueRank?: number;
    arrayDimensions?: Array<[number, number]>;
    parsedPath: VariablePath;
    statePath: string[];
}
/**
 * Parse mapp Connect variable names according to the schema
 */
export declare class VariablePathParser {
    private static globalDefaults;
    /**
     * Configure global default namespace for nodeId generation
     */
    static setGlobalDefaultNamespace(namespace: string): void;
    /**
     * Configure global default application for nodeId generation
     */
    static setGlobalDefaultApplication(application: string): void;
    /**
     * Configure global default task for nodeId generation
     */
    static setGlobalDefaultTask(task: string): void;
    /**
     * Get current global defaults
     */
    static getGlobalDefaults(): {
        namespace: string;
        application: string;
        task: string;
    };
    /**
     * Parse a variable name into components
     * Supports multiple formats:
     * - 'VarName' → Global variable (AsGlobalPV scope)
     * - 'TaskName:VarName' → Task local variable
     * - '::TaskName:VarName' → Task local with empty module
     * - 'AppModule::TaskName:VarName' → Full format (module::task:variable)
     */
    static parse(variableName: string): VariablePath;
    /**
     * Parse module::task format: AppModule::TaskName:Variable, ::TaskName:Variable, or ::GlobalVariable
     */
    private static parseModuleTaskFormat;
    /**
     * Parse task local format: TaskName:Variable
     */
    private static parseTaskLocalFormat;
    /**
     * Parse global format: Variable (no colons)
     */
    private static parseGlobalFormat;
    /**
     * Parse variable with structure path and array indices
     */
    private static parseVariableWithPath;
    /**
     * Convert parsed path to state path for global object
     * Stores as: appModule.scope.variable.path... (clean hierarchy)
     */
    static toStatePath(parsedPath: VariablePath): string[];
    /**
     * Reconstruct the original variable name from parsed components
     * Always uses the full AppModule::Task:Variable format
     */
    static reconstruct(parsedPath: VariablePath): string;
    /**
     * Build OPC UA nodeId from variable name with optional configuration overrides
     * Falls back to global defaults when options are not provided
     */
    static buildNodeId(varName: string, options?: {
        namespace?: string;
        nodeId?: string;
        defaultApplication?: string;
        defaultTask?: string;
    }): string;
}
/**
 * Variable hierarchy using global state object
 */
export declare class VariableHierarchy {
    private globalState;
    private variables;
    private nodeIdToName;
    private stateMetadata;
    private arrayDimensionsCache;
    /**
     * Add a variable to the hierarchy
     */
    addVariable(name: string, nodeId: string, value: OpcuaValue, timestamp: Date, quality: string, dataType?: string, valueRank?: number, arrayDimensions?: Array<[number, number]>): VariableMapping;
    /**
     * Update a variable value with automatic propagation
     */
    updateVariable(name: string, value: OpcuaValue, timestamp: Date, quality: string): string[];
    /**
     * Get variable by name
     */
    getVariable(name: string): {
        mapping: VariableMapping;
        value: OpcuaValue;
        timestamp: Date;
        quality: string;
    } | undefined;
    /**
     * Get variable by nodeId
     */
    getVariableByNodeId(nodeId: string): {
        mapping: VariableMapping;
        value: OpcuaValue;
        timestamp: Date;
        quality: string;
    } | undefined;
    /**
     * Get all variables
     */
    getAllVariables(): Map<string, {
        mapping: VariableMapping;
        value: OpcuaValue;
        timestamp: Date;
        quality: string;
    }>;
    /**
     * Remove variable from hierarchy
     */
    removeVariable(name: string): boolean;
    /**
     * Find variables that share state paths (potential conflicts/relationships)
     */
    findRelatedVariables(name: string): Array<{
        type: 'parent' | 'child' | 'sibling';
        variable: string;
    }>;
    /**
     * Get a reference to the global state object
     * WARNING: The returned object should be treated as read-only.
     * Modifying it directly will bypass validation and notification systems.
     * Use updateVariable() or writeVariable() methods to make changes.
     */
    getGlobalState(): OpcuaObject;
    /**
     * Find all variables that might be affected by a change to the given variable
     */
    private findAffectedVariables;
    /**
     * Check if a variable path is affected by changes to another path
     */
    private isPathAffected;
    /**
     * Check if one path is a parent of another
     */
    private isParentPath;
    /**
     * Get relationship type between two paths
     */
    private getRelationshipType;
    /**
     * Get value at a specific path in an object
     */
    private getValueAtPath;
    /**
     * Set value at a specific path in an object (mutates the object directly for performance)
     */
    private setValueAtPath;
    /**
     * Ensure a path segment exists and return the next level
     */
    private ensurePathSegment;
    /**
     * Set a value on a path segment (final step)
     */
    private setPathSegmentValue;
    /**
     * Check if two values should be merged (both are mergeable objects or arrays)
     */
    private shouldMergeObjects;
    /**
     * Check if a value is mergeable (plain object or array)
     */
    private isMergeable;
    /**
     * Check if a value is a plain object (not array, date, or other special types)
     */
    private isPlainObject;
    /**
     * Deep merge two objects or arrays, with newObj properties overriding existing ones
     */
    private deepMerge;
    /**
     * Merge arrays by index, preserving existing elements not overridden by new array
     */
    private mergeArraysByIndex;
    /**
     * Merge plain objects, with new properties overriding existing ones
     */
    private mergeObjects;
    /**
     * Check if a segment represents an array index like [0] or [1,2]
     */
    private isArrayIndex;
    /**
     * Calculate flat array index from multi-dimensional indices using OPC UA array dimensions
     * @param indices The multi-dimensional indices (e.g., [3, 1] for Matrix[3,1])
     * @param arrayDimensions The OPC UA array dimensions (e.g., [[1, 4], [0, 2]])
     * @returns The flat index to access the value in a 1D array
     */
    /**
     * Extract the base array name from a variable name
     * Examples:
     * - 'Matrix[1,2,3]' → 'Matrix'
     * - 'DataArray[5].Value' → 'DataArray'
     * - 'Sensor[0].Readings[1,2]' → first occurrence would be 'Sensor'
     */
    private extractBaseArrayName;
    /**
     * Parse array indices from a segment like [0] or [1,2,3]
     */
    private parseArrayIndices;
    /**
     * Check if an object has array-like string keys (like "[0]", "[1]")
     */
    /**
     * Convert an object with array-like keys to a proper array
     */
    /**
     * Deep clone a value
     */
    private deepClone;
    /**
     * Check if two arrays are equal
     */
    private arraysEqual;
}
//# sourceMappingURL=variable-hierarchy.d.ts.map