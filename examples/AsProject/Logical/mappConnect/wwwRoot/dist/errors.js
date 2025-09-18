/**
 * Structured error handling for LuxConnect library
 * Provides consistent error codes and messages for better error handling
 */
export var LuxConnectErrorCode;
(function (LuxConnectErrorCode) {
    // Connection related
    LuxConnectErrorCode["NOT_CONNECTED"] = "NOT_CONNECTED";
    LuxConnectErrorCode["CONNECTION_FAILED"] = "CONNECTION_FAILED";
    LuxConnectErrorCode["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    LuxConnectErrorCode["AUTHENTICATION_FAILED"] = "AUTHENTICATION_FAILED";
    // Variable related
    LuxConnectErrorCode["VARIABLE_NOT_FOUND"] = "VARIABLE_NOT_FOUND";
    LuxConnectErrorCode["VARIABLE_ALREADY_REGISTERED"] = "VARIABLE_ALREADY_REGISTERED";
    LuxConnectErrorCode["INVALID_VARIABLE_NAME"] = "INVALID_VARIABLE_NAME";
    LuxConnectErrorCode["INVALID_NODE_ID"] = "INVALID_NODE_ID";
    // Read/Write operations
    LuxConnectErrorCode["READ_FAILED"] = "READ_FAILED";
    LuxConnectErrorCode["WRITE_FAILED"] = "WRITE_FAILED";
    LuxConnectErrorCode["INVALID_DATA_TYPE"] = "INVALID_DATA_TYPE";
    LuxConnectErrorCode["ACCESS_DENIED"] = "ACCESS_DENIED";
    // Subscription related
    LuxConnectErrorCode["SUBSCRIPTION_NOT_FOUND"] = "SUBSCRIPTION_NOT_FOUND";
    LuxConnectErrorCode["SUBSCRIPTION_ALREADY_EXISTS"] = "SUBSCRIPTION_ALREADY_EXISTS";
    LuxConnectErrorCode["MONITORED_ITEM_FAILED"] = "MONITORED_ITEM_FAILED";
    // Array operations
    LuxConnectErrorCode["INVALID_ARRAY_INDEX"] = "INVALID_ARRAY_INDEX";
    LuxConnectErrorCode["NOT_AN_ARRAY"] = "NOT_AN_ARRAY";
    // General
    LuxConnectErrorCode["INVALID_PARAMETER"] = "INVALID_PARAMETER";
    LuxConnectErrorCode["OPERATION_FAILED"] = "OPERATION_FAILED";
    LuxConnectErrorCode["SERVER_ERROR"] = "SERVER_ERROR";
    LuxConnectErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    LuxConnectErrorCode["TIMEOUT"] = "TIMEOUT";
})(LuxConnectErrorCode || (LuxConnectErrorCode = {}));
export class LuxConnectError extends Error {
    code;
    details;
    originalError;
    constructor(code, message, details, originalError) {
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
    isConnectionError() {
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
    isRetryable() {
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
    toJSON() {
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
export function rejectWithError(code, message, details, originalError) {
    return Promise.reject(new LuxConnectError(code, message, details, originalError));
}
/**
 * Helper function to wrap operations that might throw into rejected promises
 */
export async function safeOperation(operation, errorCode, errorMessage) {
    try {
        return await operation();
    }
    catch (error) {
        return rejectWithError(errorCode, errorMessage, undefined, error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * Type guard to check if error is a LuxConnectError
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any     
export function isLuxConnectError(error) {
    return error instanceof LuxConnectError;
}
//# sourceMappingURL=errors.js.map