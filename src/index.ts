/**
 * @loupeteam/lux-connect — TypeScript OPC UA client for B&R mapp Connect.
 *
 * Provides {@link OpcuaMachine} for subscription-based value mirroring,
 * one-shot reads/writes, and connection lifecycle management.
 *
 * @example
 * ```typescript
 * import { OpcuaMachine } from '@loupeteam/lux-connect';
 *
 * const machine = new OpcuaMachine({
 *   host: 'localhost',
 *   port: 443,
 *   protocol: 'https',
 *   username: 'user',
 *   password: 'pass',
 * });
 *
 * await machine.connect();
 *
 * // Subscribe to a variable; the callback fires on each change.
 * machine.initCyclicRead('Temperature', (value) => {
 *   console.log(`Temperature changed to ${value}`);
 * });
 *
 * // Read the last cached value (populated by the subscription above).
 * console.log(machine.Temperature);
 *
 * // One-shot async read/write.
 * const temp = await machine.readVariable('Temperature');
 * await machine.writeVariable('Temperature', 30.0);
 * ```
 */

// Build identification.
// Consumers can log the build timestamp themselves if they want a banner, e.g.:
//   import { BUILD_TIMESTAMP } from '@loupeteam/lux-connect';
//   console.log(`[lux-connect] build ${BUILD_TIMESTAMP}`);
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
