/**
 * Centralized timing/sizing constants used by the connection layer.
 * Keep these here so behavior is easy to tune without hunting through code.
 */

/** Default OPC UA session timeout the server is asked for, in milliseconds. */
export const DEFAULT_SESSION_TIMEOUT_MS = 30_000;

/** Default keep-alive interval (~2/3 of typical 30s server-side session timeout). */
export const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 20_000;

/** Hard cap on a single keep-alive HTTP request before it is aborted. */
export const KEEP_ALIVE_REQUEST_TIMEOUT_MAX_MS = 10_000;
/** Floor for the per-request keep-alive timeout (so very small intervals still work). */
export const KEEP_ALIVE_REQUEST_TIMEOUT_MIN_MS = 2_000;

/** Backoff between automatic reconnect attempts, in milliseconds. */
export const RECONNECT_BACKOFF_MS = 5_000;

/** WebSocket connect attempt timeout, in milliseconds. */
export const WEBSOCKET_CONNECT_TIMEOUT_MS = 10_000;

/** How long a stored session is considered valid for restoration. */
export const SESSION_RESTORE_MAX_AGE_MS = 25 * 60_000;

/** Timeout for best-effort session DELETE on disconnect/recovery. */
export const SESSION_DELETE_TIMEOUT_MS = 5_000;

/** Default max OPC UA request/response message size, in bytes. */
export const DEFAULT_MAX_MESSAGE_SIZE = 65_536;

/** localStorage key used by the default SessionStore implementation. */
export const SESSION_STORAGE_KEY = 'opcua_session_info';
