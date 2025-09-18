/**
 * Structured error handling for LuxConnect library
 * Provides consistent error codes and messages for better error handling
 */
export declare enum LuxConnectErrorCode {
    NOT_CONNECTED = "NOT_CONNECTED",
    CONNECTION_FAILED = "CONNECTION_FAILED",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
    VARIABLE_NOT_FOUND = "VARIABLE_NOT_FOUND",
    VARIABLE_ALREADY_REGISTERED = "VARIABLE_ALREADY_REGISTERED",
    INVALID_VARIABLE_NAME = "INVALID_VARIABLE_NAME",
    INVALID_NODE_ID = "INVALID_NODE_ID",
    READ_FAILED = "READ_FAILED",
    WRITE_FAILED = "WRITE_FAILED",
    INVALID_DATA_TYPE = "INVALID_DATA_TYPE",
    ACCESS_DENIED = "ACCESS_DENIED",
    SUBSCRIPTION_NOT_FOUND = "SUBSCRIPTION_NOT_FOUND",
    SUBSCRIPTION_ALREADY_EXISTS = "SUBSCRIPTION_ALREADY_EXISTS",
    MONITORED_ITEM_FAILED = "MONITORED_ITEM_FAILED",
    INVALID_ARRAY_INDEX = "INVALID_ARRAY_INDEX",
    NOT_AN_ARRAY = "NOT_AN_ARRAY",
    INVALID_PARAMETER = "INVALID_PARAMETER",
    OPERATION_FAILED = "OPERATION_FAILED",
    SERVER_ERROR = "SERVER_ERROR",
    NETWORK_ERROR = "NETWORK_ERROR",
    TIMEOUT = "TIMEOUT"
}
export type LuxErrorDetails = any;
export declare class LuxConnectError extends Error {
    readonly code: LuxConnectErrorCode;
    readonly details?: LuxErrorDetails | undefined;
    readonly originalError?: Error | undefined;
    constructor(code: LuxConnectErrorCode, message: string, details?: LuxErrorDetails, originalError?: Error);
    /**
     * Check if error is related to connectivity
     */
    isConnectionError(): boolean;
    /**
     * Check if error is retryable
     */
    isRetryable(): boolean;
    /**
     * Convert to JSON for logging
     */
    toJSON(): {
        name: string;
        code: LuxConnectErrorCode;
        message: string;
        details: any;
        stack: string | undefined;
        originalError: string | undefined;
    };
}
/**
 * Helper function to create rejected promises with structured errors
 * This replaces throwing exceptions in async operations
 */
export declare function rejectWithError(code: LuxConnectErrorCode, message: string, details?: LuxErrorDetails, originalError?: Error): Promise<never>;
/**
 * Helper function to wrap operations that might throw into rejected promises
 */
export declare function safeOperation<T>(operation: () => Promise<T>, errorCode: LuxConnectErrorCode, errorMessage: string): Promise<T>;
/**
 * Type guard to check if error is a LuxConnectError
 */
export declare function isLuxConnectError(error: any): error is LuxConnectError;
//# sourceMappingURL=errors.d.ts.map