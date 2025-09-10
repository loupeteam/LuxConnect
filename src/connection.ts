import { 
  ConnectionConfig, 
  SessionInfo, 
  ConnectionState, 
  ConnectionStateHandler, 
  ErrorHandler 
} from './types.js';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

// Platform-specific WebSocket handling
class WebSocketManager {
  private ws: any = null;

  create(url: string): void {
    if (isBrowser) {
      this.ws = new WebSocket(url);
    } else {
      // Import dynamically for Node.js
      const { WebSocket } = require('ws');
      this.ws = new WebSocket(url);
    }
  }

  setupEvents(
    onOpen: () => void,
    onError: (error: any) => void, 
    onClose: () => void,
    onMessage: (data: string) => void
  ): void {
    if (!this.ws) return;

    if (isBrowser) {
      // Browser WebSocket API
      this.ws.onopen = onOpen;
      this.ws.onerror = onError;
      this.ws.onclose = onClose;
      this.ws.onmessage = (event: MessageEvent) => onMessage(event.data);
    } else {
      // Node.js ws package API
      this.ws.on('open', onOpen);
      this.ws.on('error', onError);
      this.ws.on('close', onClose);
      this.ws.on('message', (data: Buffer) => onMessage(data.toString()));
    }
  }

  send(data: string): void {
    if (this.ws && this.ws.readyState === (this.ws.OPEN || 1)) {
      this.ws.send(data);
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get readyState(): number {
    return this.ws ? this.ws.readyState : 3; // CLOSED
  }
}

/**
 * Core connection management for mapp Connect OPC UA server
 * Handles authentication, session management, and WebSocket connections
 * Works in both Node.js and browser environments
 */
export class OpcuaConnection {
  private config: ConnectionConfig;
  private sessionInfo: SessionInfo | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private webSocketManager = new WebSocketManager();
  private sessionTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private connectionStateHandlers: ConnectionStateHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private messageHandlers: Array<(data: any) => void> = [];

  private baseUrl: string;

  constructor(config: ConnectionConfig) {
    this.config = {
      enableWebSocket: true,
      keepAliveInterval: 20000, // 20 seconds (2/3 of typical 30s timeout)
      ...config
    };
    
    this.baseUrl = `http://${this.config.host}:${this.config.port || 80}`;
  }

  /**
   * Connect to the OPC UA server
   */
  public async connect(): Promise<void> {
    try {
      this.setState(ConnectionState.CONNECTING);

      // Test certificate (optional step)
      await this.testCertificate();

      // Create session
      await this.createSession();

      // Start session keep-alive
      this.startSessionKeepAlive();

      // Connect WebSocket if enabled
      if (this.config.enableWebSocket) {
        await this.connectWebSocket();
      }

      this.setState(ConnectionState.CONNECTED);
    } catch (error) {
      this.setState(ConnectionState.DISCONNECTED);
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect from the OPC UA server
   */
  public async disconnect(): Promise<void> {
    this.setState(ConnectionState.DISCONNECTING);

    // Stop timers
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close WebSocket
    this.webSocketManager.close();

    // Delete session
    if (this.sessionInfo) {
      try {
        await this.deleteSession();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    this.sessionInfo = null;
    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Check if connected
   */
  public get isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }

  /**
   * Get current connection state
   */
  public get state(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get session information
   */
  public getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Get the WebSocket manager for subscriptions
   */
  public getWebSocket(): WebSocketManager {
    return this.webSocketManager;
  }

  /**
   * Make an authenticated API request
   */
  public async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    if (!this.sessionInfo) {
      throw new Error('Not connected to OPC UA server');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.sessionInfo.sessionId}`,
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * Add connection state change handler
   */
  public onConnectionStateChanged(handler: ConnectionStateHandler): void {
    this.connectionStateHandlers.push(handler);
  }

  /**
   * Add error handler
   */
  public onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  /**
   * Add WebSocket message handler
   */
  public onMessage(handler: (data: any) => void): void {
    this.messageHandlers.push(handler);
  }

  // Private methods

  private setState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.connectionStateHandlers.forEach(handler => {
        try {
          handler(state);
        } catch (error) {
          console.error('Connection state handler error:', error);
        }
      });
    }
  }

  private handleError(error: Error): void {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (err) {
        console.error('Error handler error:', err);
      }
    });
  }

  /**
   * Test certificate (optional)
   */
  private async testCertificate(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/opcua/testCertificate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        certificate: this.config.certificate || ''
      })
    });

    if (!response.ok) {
      console.warn('Certificate test failed, continuing without certificate');
    }
  }

  /**
   * Create OPC UA session
   */
  private async createSession(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/opcua/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: this.config.username || '',
        password: this.config.password || '',
        sessionTimeout: this.config.sessionTimeout || 30000
      })
    });

    if (!response.ok) {
      throw new Error(`Session creation failed: ${response.status} ${response.statusText}`);
    }

    this.sessionInfo = await response.json();
  }

  /**
   * Delete OPC UA session
   */
  private async deleteSession(): Promise<void> {
    await fetch(`${this.baseUrl}/opcua/session`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.sessionInfo!.sessionId}`
      }
    });
  }

  /**
   * Start session keep-alive timer
   */
  private startSessionKeepAlive(): void {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
    }

    this.sessionTimer = setInterval(async () => {
      try {
        await fetch(`${this.baseUrl}/opcua/session`, {
          method: 'HEAD',
          headers: {
            'Authorization': `Bearer ${this.sessionInfo!.sessionId}`
          }
        });
      } catch (error) {
        console.warn('Session keep-alive failed:', error);
      }
    }, this.config.keepAliveInterval);
  }

  /**
   * Connect to WebSocket push channel
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `ws://${this.config.host}:${this.config.port || 80}/opcua/pushchannel?sessionid=${this.sessionInfo!.sessionId}`;
        
        this.webSocketManager.create(wsUrl);
        
        this.webSocketManager.setupEvents(
          () => {
            console.log('WebSocket connected');
            resolve();
          },
          (error: any) => {
            console.error('WebSocket error:', error);
            reject(error);
          },
          () => {
            console.log('WebSocket disconnected');
            if (this.isConnected) {
              // Attempt reconnection if we're supposed to be connected
              this.scheduleReconnect();
            }
          },
          (data: string) => {
            // Handle incoming messages (will be used by subscription manager)
            this.handleWebSocketMessage(data);
          }
        );

        // Timeout for connection
        setTimeout(() => {
          if (this.webSocketManager.readyState !== 1) { // OPEN
            reject(new Error('WebSocket connection timeout'));
          }
        }, 5000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleWebSocketMessage(data: string): void {
    try {
      const message = JSON.parse(data);
      
      // Notify all message handlers
      this.messageHandlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          console.error('Message handler error:', error);
        }
      });
    } catch (error) {
      console.error('WebSocket message handling error:', error);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.setState(ConnectionState.RECONNECTING);
        await this.connectWebSocket();
        this.setState(ConnectionState.CONNECTED);
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.scheduleReconnect(); // Try again
      }
    }, 5000); // Retry after 5 seconds
  }
}
