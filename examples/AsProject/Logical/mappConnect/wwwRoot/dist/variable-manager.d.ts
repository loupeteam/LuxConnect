import { OpcuaConnection } from './connection.js';
import { OpcuaVariable, VariableChangeHandler, ErrorPolicy, OpcuaValue, OpcuaObject } from './types.js';
/**
 * Simplified variable manager using global state with deep copying
 * Much simpler and easier to understand than the complex hierarchical approach
 */
export declare class VariableManager {
    private connection;
    private hierarchy;
    private changeHandlers;
    private globalChangeHandlers;
    private errorPolicy;
    private defaultNamespace;
    private defaultApplication;
    private defaultTask;
    constructor(connection: OpcuaConnection);
    /**
     * Set default namespace for NodeId generation
     */
    setDefaultNamespace(namespace: string): void;
    /**
     * Set default application/module for variables without explicit application
     */
    setDefaultApplication(application: string): void;
    /**
     * Set default task for variables without explicit task
     */
    setDefaultTask(task: string): void;
    /**
     * Set error handling policy
     * @param policy 'default' - log errors and return cached values, 'strict' - throw unhandled rejections, 'silent' - return cached values without logging
     */
    setErrorPolicy(policy: ErrorPolicy): void;
    /**
     * Creates a smart promise that handles errors based on the error policy
     * - strict: Returns promise as-is (will crash if unhandled)
     * - default: Logs errors and returns cached/fallback values
     * - silent: Returns cached/fallback values without logging
     */
    private createSmartPromise;
    /**
     * Register a variable with format validation and optional array parameter detection
     * @param name Variable name
     * @param nodeId Node ID
     * @param readArrayParams Whether to read and store array parameters (ValueRank, ArrayDimensions)
     */
    registerVariable(name: string, nodeId: string, readArrayParams?: boolean): OpcuaVariable | Promise<OpcuaVariable>;
    /**
     * Synchronous variable registration (original implementation)
     */
    private registerVariableSync;
    /**
     * Asynchronous variable registration with array parameter reading
     */
    private registerVariableAsync;
    /**
     * Get a registered variable by name
     */
    getVariable(name: string): OpcuaVariable | undefined;
    /**
     * Get all registered variables
     */
    getAllVariables(): Map<string, OpcuaVariable>;
    /**
     * Unregister a variable
     */
    unregisterVariable(name: string): boolean;
    /**
     * Read a specific attribute from a node
     * @param nodeId The node ID to read from
     * @param attributeId The attribute ID to read (e.g., 'Value', 'ValueRank', 'ArrayDimensions', 'DataType')
     */
    readAttribute(nodeId: string, attributeId: string): Promise<any>;
    /**
     * Read array parameters for a variable (ValueRank and ArrayDimensions)
     * Returns information about array structure
     */
    readArrayParameters(name: string): Promise<{
        valueRank: number;
        arrayDimensions: number[] | null;
        isArray: boolean;
        dimensionCount: number;
    }>;
    /**
     * Read the current value of a variable by name
     * No registration required - builds NodeId dynamically
     */
    readValue(name: string): Promise<OpcuaValue>;
    /**
     * Internal method that performs the actual read operation
     */
    private performReadValue; /**
     * Write a value to a variable by name
     * For complex objects, decomposes them into individual simple values and uses batch write
     * For array elements with primitive values, uses read-modify-write approach
     */
    writeValue(name: string, value: OpcuaValue): Promise<void>;
    /**
     * Internal method that performs the actual write operation
     */
    private performWriteValue;
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
    private writeArrayElement;
    /**
     * Check if a value is complex (object or array) and needs decomposition
     * Arrays of primitives are now handled as simple values since array elements
     * use read-modify-write approach
     */
    private isComplexValue;
    /**
     * Write a complex value by decomposing it into individual simple values
     * Uses Microsoft Graph JSON batching for efficient multi-variable writes
     * No registration required - builds NodeIds dynamically
     */
    private writeComplexValue;
    /**
     * Flatten a complex value into simple path-value pairs
     */
    private flattenValue;
    /**
     * Execute batch write operations
     */
    private executeBatchWrite;
    /**
     * Write a single simple value
     * No registration required - builds NodeId dynamically
     */
    private writeSingleValue;
    /**
     * Write a single value by nodeId
     */
    private writeSingleValueByNodeId;
    /**
     * Add a change handler for a specific variable
     */
    onChange(name: string, handler: VariableChangeHandler): void;
    /**
     * Add a global change handler for all variables
     */
    onAnyChange(handler: VariableChangeHandler): void;
    /**
     * Remove a change handler for a specific variable
     */
    removeChangeHandler(name: string, handler: VariableChangeHandler): void;
    /**
     * Remove a global change handler
     */
    removeGlobalChangeHandler(handler: VariableChangeHandler): void;
    /**
     * Normalize variable name to ensure consistent key usage
     * This ensures that variable names like 'Temperature', '::AsGlobalPV:Temperature', 'gtest', '::gtest'
     * are all treated consistently when used as keys for change handlers
     */
    private normalizeVariableName;
    /**
     * Update a variable from external source (e.g., subscription notification)
     * This automatically handles hierarchical updates through the global state
     */
    updateVariableFromNotification(nodeId: string, value: OpcuaValue, timestamp: Date, quality: string): void;
    /**
     * Get variables that are related to the given variable
     */
    getRelatedVariables(name: string): Array<{
        type: 'parent' | 'child' | 'sibling';
        variable: OpcuaVariable;
    }>;
    /**
     * Get current global state (for debugging)
     */
    getGlobalState(): OpcuaObject;
    /**
     * Emit change event for a variable
     */
    private emitChangeEvent;
    /**
     * Map OPC UA status code to quality string
     */
    private mapQualityCode;
    /**
     * Build NodeId from variable name
     */
    private buildNodeId;
}
//# sourceMappingURL=variable-manager.d.ts.map