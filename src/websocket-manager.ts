import { type Logger, consoleLogger } from './logger.js';

const isBrowser = typeof window !== 'undefined';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CrossPlatformWebSocket = WebSocket | any; // 'any' for Node.js ws package

export type WebSocketEventHandlers = {
  onOpen: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError: (error: any) => void;
  onClose: (event: { code?: number; reason?: string } | undefined) => void;
  onMessage: (data: string) => void;
};

/**
 * Cross-platform WebSocket wrapper. Knows nothing about sessions or
 * reconnection — that lives in the connection layer.
 */
export class WebSocketManager {
  private ws: CrossPlatformWebSocket = null;
  private isClosingProgrammatically = false;

  constructor(private readonly log: Logger = consoleLogger) {}

  async create(url: string, headers?: Record<string, string>): Promise<void> {
    // Always close any existing socket so callers can safely re-create.
    this.close();

    if (isBrowser) {
      // Browsers handle cookies themselves.
      this.ws = new WebSocket(url);
      return;
    }

    // Dynamic import for Node.js so the browser bundle stays tree-shakeable.
    let WebSocketClass: unknown;
    try {
      const wsModule = await import('ws');
      // Handle both default and named exports.
      WebSocketClass = wsModule.default || wsModule.WebSocket || wsModule;
    } catch (error) {
      this.log.error('WebSocket import error:', error);
      throw new Error('ws package not found. Install with: npm install ws');
    }

    const options = headers ? { headers } : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.ws = new (WebSocketClass as any)(url, options);

    // Attach an immediate error sink so a connect-time error doesn't crash
    // the host process before setupEvents() runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.ws.on('error', (error: any) => {
      this.log.debug('WebSocket error during creation (handled):', error);
    });
  }

  setupEvents(handlers: WebSocketEventHandlers): void {
    if (!this.ws) return;
    const { onOpen, onError, onClose, onMessage } = handlers;

    if (isBrowser) {
      this.ws.onopen = onOpen;
      this.ws.onerror = onError;
      this.ws.onclose = (event: CloseEvent) => {
        if (!this.isClosingProgrammatically) {
          onClose({ code: event.code, reason: event.reason });
        }
      };
      this.ws.onmessage = (event: MessageEvent) => onMessage(event.data);
    } else {
      this.ws.removeAllListeners();
      this.ws.on('open', onOpen);
      this.ws.on('error', onError);
      this.ws.on('close', (code: number, reason: string) => {
        if (!this.isClosingProgrammatically) {
          onClose({ code, reason });
        }
      });
      this.ws.on('message', (data: Buffer) => onMessage(data.toString()));
    }
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === (this.ws.OPEN ?? 1)) {
      this.ws.send(data);
    }
  }

  close(): void {
    if (!this.ws) return;
    this.isClosingProgrammatically = true;
    try {
      if (isBrowser) {
        this.ws.onopen = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.onmessage = null;
      } else {
        this.ws.removeAllListeners();
      }

      const readyState = this.ws.readyState;
      const OPEN = this.ws.OPEN ?? 1;
      const CONNECTING = this.ws.CONNECTING ?? 0;
      if (readyState === OPEN || readyState === CONNECTING) {
        this.ws.close(1000, 'Connection closed programmatically');
      }
    } catch (error) {
      this.log.debug('WebSocket close error (ignored):', error);
    } finally {
      this.ws = null;
      this.isClosingProgrammatically = false;
    }
  }

  get readyState(): number {
    return this.ws ? this.ws.readyState : 3; // CLOSED
  }
}
