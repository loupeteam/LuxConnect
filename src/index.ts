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

// Build identification.
// Consumers can log the build timestamp themselves if they want a banner, e.g.:
//   import { BUILD_TIMESTAMP } from 'lux-opcua';
//   console.log(`[lux-opcua] build ${BUILD_TIMESTAMP}`);
// (Library code intentionally does not log on module load so it doesn't
// spam consumer output or break test runners.)
export { BUILD_TIMESTAMP, BUILD_TIMESTAMP_MS } from './build-info.js';

// Main Machine class (lux.js style)
export { OpcuaMachine } from './opcua-machine.js';

// Core functionality classes
export { OpcuaConnection } from './connection.js';

// Pluggable infrastructure
export { consoleLogger, silentLogger } from './logger.js';
export type { Logger } from './logger.js';
export {
  LocalStorageSessionStore,
  InMemorySessionStore,
} from './session-store.js';
export type { SessionStore, PersistedSession } from './session-store.js';

// Error handling
export {
  LuxConnectError,
  LuxConnectErrorCode,
  rejectWithError,
  safeOperation,
  isLuxConnectError,
} from './errors.js';

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
  ErrorHandler,
  ErrorPolicy,
} from './types.js';

export { ConnectionState } from './types.js';

// Convenience factory functions
import { OpcuaMachine } from './opcua-machine.js';
import type { ConnectionConfig } from './types.js';

export function createOpcuaMachine(config: ConnectionConfig): OpcuaMachine {
  return new OpcuaMachine(config);
}

// LUX Compatibility Layer
export { 
    initializeLuxCompatibility,
    registerMachine,
    createLuxCompatibleMachine,
    setupMinimalLux
} from './lux-compatibility.js';
export type { LuxCompatibleMachine } from './lux-compatibility.js';

// Version information
export const VERSION = '1.0.0';
