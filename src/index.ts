/**
 * lux-opcua - TypeScript OPC UA Client Library
 * 
 * A modern TypeScript library for OPC UA client operations with lux.js-style patterns.
 * Provides high-level abstractions for variable management, subscriptions, and real-time monitoring.
 * 
 * @example
 * ```typescript
 * import { OpcuaMachine } from 'lux-opcua';
 * 
 * const machine = new OpcuaMachine({
 *   host: 'localhost',
 *   port: 80,
 *   username: 'user',
 *   password: 'pass'
 * });
 * 
 * // Connect and setup cyclic reading (lux.js style)
 * await machine.connect();
 * machine.initCyclicRead('Temperature');
 * 
 * // Direct property access (lux.js style)
 * console.log(machine.Temperature); // Read value
 * machine.Temperature = 25.5;       // Write value
 * 
 * // Change callbacks
 * machine.onChange('Temperature', (value) => {
 *   console.log(`Temperature changed to ${value}`);
 * });
 * 
 * // Explicit read/write with await
 * const temp = await machine.readVariable('Temperature');
 * await machine.writeVariable('Temperature', 30.0);
 * ```
 */

// Main Machine class (lux.js style)
export { OpcuaMachine } from './opcua-machine.js';

// Core functionality classes
export { OpcuaConnection } from './connection.js';

// Type definitions
export type {
  ConnectionConfig,
  SessionInfo,
  OpcuaVariable,
  SubscriptionOptions,
  MonitoredItemOptions,
  VariableChangeEvent,
  VariableChangeHandler,
  ConnectionStateHandler,
  ErrorHandler
} from './types.js';

export { ConnectionState } from './types.js';

// Convenience factory functions
import { OpcuaMachine } from './opcua-machine.js';
import type { ConnectionConfig } from './types.js';

export function createOpcuaMachine(config: ConnectionConfig): OpcuaMachine {
  return new OpcuaMachine(config);
}

// Version information
export const VERSION = '1.0.0';
