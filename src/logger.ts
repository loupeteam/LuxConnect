/**
 * Minimal logger interface used by the connection layer.
 * Defaults to `console`. Callers can supply a custom logger to silence
 * verbose debug output or route logs to their own infrastructure.
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** No-op logger; useful for tests or when output should be silent. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Default logger that forwards to the global `console`. */
export const consoleLogger: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
