/**
 * Error handling policy for the library
 */
export type ErrorPolicy = 'default' | 'strict' | 'silent';

/**
 * Semantic OPC UA Types - Usage Guide:
 * 
 * OpcuaValue (most general):
 *   - Use for: Any OPC UA data (primitives, objects, arrays)
 *   - Examples: variable values, read/write operations, callbacks
 * 
 * OpcuaObject (structured data):
 *   - Use for: Objects with key-value pairs, structures, global state
 *   - Examples: config objects, UDTs, hierarchical data
 * 
 * OpcuaArray (array data):
 *   - Use for: Array-specific operations and storage
 *   - Examples: OPC UA arrays, indexed collections
 */

/**
 * Dynamic value type for OPC UA variables that can hold any type
 * Used for runtime values from OPC UA server that can be primitives, objects, or arrays
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpcuaValue = any;

/**
 * Generic object type for dynamic structures from OPC UA
 * Used for complex data types, structs, and nested objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpcuaObject = Record<string, any>;

/**
 * Dynamic array type for OPC UA arrays
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpcuaArray = any[];

/**
 * OPC UA Variable interface for type-safe variable management
 */
export interface OpcuaVariable {
  readonly name: string;
  readonly nodeId: string;
  readonly dataType?: string;
  value?: OpcuaValue;
  timestamp?: Date;
  quality?: string;
}

/**
 * Subscription configuration options
 */
export interface SubscriptionOptions {
  name?: string;
  publishingInterval?: number;
  maxNotificationsPerPublish?: number;
  priority?: number;
  lifetimeCount?: number;
  maxKeepAliveCount?: number;
}

/**
 * Monitored item configuration
 */
export interface MonitoredItemOptions {
  samplingInterval?: number;
  discardOldest?: boolean;
  queueSize?: number;
}

/**
 * OPC UA Data Notification structure from WebSocket messages
 * Represents a single data change notification from the server
 */
export interface DataNotification {
  clientHandle: number;
  value: OpcuaValue;
  serverTimestamp?: string;
  sourceTimestamp?: string;
  status?: {
    code: number;
    symbol?: string;
  };
}

/**
 * Connection configuration for mapp Connect
 */
export interface ConnectionConfig {
  host: string;
  port?: number;
  protocol?: 'http' | 'https';         // HTTP protocol selection
  wsProtocol?: 'ws' | 'wss';           // WebSocket protocol selection
  endpointUrl?: string;                // OPC UA endpoint URL (optional, defaults to opc.tcp://host:4840)
  username?: string;
  password?: string;
  certificate?: string;
  sessionTimeout?: number;
  enableWebSocket?: boolean;
  keepAliveInterval?: number;
  /**
   * Maximum length for task/scope names in local variable nodeIds.
   * When set, task names longer than this limit are truncated before building the OPC UA nodeId.
   * Only applies to local (task-scoped) variables — global (AsGlobalPV) variables are unaffected.
   * Example: taskNameMaxLength=10 maps "PurgeControl:IO.do.x" → "PurgeContr:IO.do.x"
   */
  taskNameMaxLength?: number;
  /**
   * Optional logger. Defaults to `console`. Pass `silentLogger` from
   * `./logger.js` (or any compatible object) to silence diagnostics.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: any;
  /**
   * Optional session persistence store. Defaults to a `sessionStorage`-backed
   * store so SPA navigations can reuse the existing connection session.
   * Pass `false` to disable persistence (each `connect()` creates a fresh
   * session) or a custom `SessionStore` implementation to plug in your own.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionStore?: any | false;
}

/**
 * Session information
 */
export interface SessionInfo {
  sessionId: string;
  sessionTimeout: number;
  maxRequestMessageSize: number;
  maxResponseMessageSize: number;
  endpointUrl: string;
  username?: string;                   // Optional username from authentication
  roles?: string[];                    // Optional user roles from mapp Connect
}

export interface UserCredentials {
  username?: string;
  password?: string;
}
/**
 * Session request interface for mapp Connect API
 */
export interface SessionRequest {
  url: string;
  timeout: number;
  userIdentityToken?: UserCredentials;
}

/**
 * Variable change event data
 */
export interface VariableChangeEvent {
  nodeId: string;
  name: string;
  value: OpcuaValue;
  timestamp: Date;
  quality: string;
}

/**
 * Connection state enumeration
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

/**
 * Event handler types
 */
export type VariableChangeHandler = (event: VariableChangeEvent) => void;
export type ConnectionStateHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: Error) => void;
