/**
 * Error handling policy for the library
 */
export type ErrorPolicy = 'default' | 'strict' | 'silent';

/**
 * OPC UA Variable interface for type-safe variable management
 */
export interface OpcuaVariable {
  readonly name: string;
  readonly nodeId: string;
  readonly dataType?: string;
  value?: any;
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

/**
 * Variable change event data
 */
export interface VariableChangeEvent {
  nodeId: string;
  name: string;
  value: any;
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
