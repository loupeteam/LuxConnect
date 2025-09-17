/**
 * Structured error handling for LuxConnect library
 * Provides consistent error codes and messages for better error handling
 */

export enum LuxConnectErrorCode {
  // Connection related
  NOT_CONNECTED = 'NOT_CONNECTED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  
  // Variable related
  VARIABLE_NOT_FOUND = 'VARIABLE_NOT_FOUND',
  VARIABLE_ALREADY_REGISTERED = 'VARIABLE_ALREADY_REGISTERED',
  INVALID_VARIABLE_NAME = 'INVALID_VARIABLE_NAME',
  INVALID_NODE_ID = 'INVALID_NODE_ID',
  
  // Read/Write operations
  READ_FAILED = 'READ_FAILED',
  WRITE_FAILED = 'WRITE_FAILED',
  INVALID_DATA_TYPE = 'INVALID_DATA_TYPE',
  ACCESS_DENIED = 'ACCESS_DENIED',
  
  // Subscription related
  SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND',
  SUBSCRIPTION_ALREADY_EXISTS = 'SUBSCRIPTION_ALREADY_EXISTS',
  MONITORED_ITEM_FAILED = 'MONITORED_ITEM_FAILED',
  
  // Array operations
  INVALID_ARRAY_INDEX = 'INVALID_ARRAY_INDEX',
  NOT_AN_ARRAY = 'NOT_AN_ARRAY',
  
  // General
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  OPERATION_FAILED = 'OPERATION_FAILED',
  SERVER_ERROR = 'SERVER_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT'
}

export class LuxConnectError extends Error {
  public readonly code: LuxConnectErrorCode;
  public readonly details?: any;
  public readonly originalError?: Error | undefined;

  constructor(
    code: LuxConnectErrorCode, 
    message: string, 
    details?: any, 
    originalError?: Error
  ) {
    super(message);
    this.name = 'LuxConnectError';
    this.code = code;
    this.details = details;
    this.originalError = originalError;
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, LuxConnectError.prototype);
  }

  /**
   * Check if error is related to connectivity
   */
  public isConnectionError(): boolean {
    return [
      LuxConnectErrorCode.NOT_CONNECTED,
      LuxConnectErrorCode.CONNECTION_FAILED,
      LuxConnectErrorCode.SESSION_EXPIRED,
      LuxConnectErrorCode.AUTHENTICATION_FAILED,
      LuxConnectErrorCode.NETWORK_ERROR
    ].includes(this.code);
  }

  /**
   * Check if error is retryable
   */
  public isRetryable(): boolean {
    return [
      LuxConnectErrorCode.NOT_CONNECTED,
      LuxConnectErrorCode.SESSION_EXPIRED,
      LuxConnectErrorCode.NETWORK_ERROR,
      LuxConnectErrorCode.TIMEOUT,
      LuxConnectErrorCode.SERVER_ERROR
    ].includes(this.code);
  }

  /**
   * Convert to JSON for logging
   */
  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      stack: this.stack,
      originalError: this.originalError?.message
    };
  }
}

/**
 * Helper function to create rejected promises with structured errors
 * This replaces throwing exceptions in async operations
 */
export function rejectWithError(
  code: LuxConnectErrorCode, 
  message: string, 
  details?: any, 
  originalError?: Error
): Promise<never> {
  return Promise.reject(new LuxConnectError(code, message, details, originalError));
}

/**
 * Helper function to wrap operations that might throw into rejected promises
 */
export async function safeOperation<T>(
  operation: () => Promise<T>,
  errorCode: LuxConnectErrorCode,
  errorMessage: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return rejectWithError(
      errorCode, 
      errorMessage, 
      undefined, 
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Type guard to check if error is a LuxConnectError
 */
export function isLuxConnectError(error: any): error is LuxConnectError {
  return error instanceof LuxConnectError;
}