/**
 * OPC UA Variable interface for type-safe variable management
 */
export interface OpcuaVariable {
  readonly nodeId: string;
  readonly name: string;
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
