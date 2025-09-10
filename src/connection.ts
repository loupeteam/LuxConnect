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

  async create(url: string): Promise<void> {
    if (isBrowser) {
      this.ws = new WebSocket(url);
    } else {
      // Dynamic import for Node.js
      try {
        const wsModule = await import('ws');
        const { WebSocket } = wsModule.default || wsModule;
        this.ws = new WebSocket(url);
      } catch (error) {
        throw new Error('ws package not found. Install with: npm install ws');
      }
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
      protocol: 'http',           // Default to HTTP
      wsProtocol: 'ws',          // Default to WS
      enableWebSocket: true,
      keepAliveInterval: 20000, // 20 seconds (2/3 of typical 30s timeout)
      ...config
    };
    
    const protocol = this.config.protocol || 'http';
    const port = this.config.port || (protocol === 'https' ? 443 : 80);
    this.baseUrl = `${protocol}://${this.config.host}:${port}`;
    
    console.log(`mapp Connect: Base URL = ${this.baseUrl}`);
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

    // Ensure endpoint starts with /api/1.0 for mapp Connect
    const normalizedEndpoint = endpoint.startsWith('/api/1.0') ? endpoint : `/api/1.0${endpoint}`;
    const url = `${this.baseUrl}${normalizedEndpoint}`;
    
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

  /**
   * Test connection accessibility (public method for manual testing)
   */
  public async testConnection(): Promise<void> {
    return this.testCertificate();
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
   * Test connection to verify accessibility with detailed error handling
   */
  private async testCertificate(): Promise<void> {
    console.log('Testing mapp Connect accessibility...');
    
    const testUrl = `${this.baseUrl}/api/1.0/auth`;
    
    try {
      console.log(`Testing endpoint: ${testUrl}`);
      
      const response = await fetch(testUrl, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache'
      });
      
      if (response.ok || response.status === 401 || response.status === 405) {
        // 200 = OK, 401 = Unauthorized (but server accessible), 405 = Method Not Allowed (but endpoint exists)
        console.log(`mapp Connect test successful: ${testUrl} (Status: ${response.status})`);
        return;
      } else {
        console.warn(`mapp Connect endpoint returned HTTP ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`mapp Connect endpoint failed: ${message}`);
      throw this.categorizeConnectionError(error as Error, testUrl);
    }
  }

  /**
   * Categorize connection errors for better diagnostics
   */
  private categorizeConnectionError(error: Error, url: string): Error {
    const errorMsg = error.message.toLowerCase();
    
    if (errorMsg.includes('certificate') || errorMsg.includes('ssl') || errorMsg.includes('tls') || 
        errorMsg.includes('authority') || errorMsg.includes('net::err_cert') || 
        errorMsg.includes('sec_error') || errorMsg.includes('insecure')) {
      return new Error(`Certificate/Authority Error for ${url}. 
Please accept the server certificate by opening ${this.baseUrl} in your browser and accepting the security warning.`);
    } else if (errorMsg.includes('failed to fetch') || errorMsg.includes('networkerror') || errorMsg.includes('network')) {
      return new Error(`Network Error for ${url}. Check if the server is running and the URL is correct.`);
    } else if (errorMsg.includes('cors')) {
      return new Error(`CORS Error for ${url}. The server may not allow cross-origin requests.`);
    } else {
      return new Error(`Connection error for ${url}: ${error.message}`);
    }
  }

  /**
   * Create mapp Connect session with enhanced error handling
   */
  private async createSession(): Promise<void> {
    // Try session creation approach based on whether we have credentials
    if (this.config.username) {
      // If we have credentials, do the full auth flow
      await this.createSessionWithAuth();
    } else {
      // For anonymous access, try direct session creation first
      try {
        await this.createSessionDirect();
      } catch (error) {
        console.log('Direct session creation failed, trying with anonymous auth:', error);
        // If direct fails, try with anonymous auth
        await this.createSessionWithAuth();
      }
    }
  }

  /**
   * Create session directly (for anonymous access)
   */
  private async createSessionDirect(): Promise<void> {
    const sessionUrl = `${this.baseUrl}/api/1.0/opcua/sessions`;
    console.log(`Creating OPC UA session directly: ${sessionUrl}`);

    const sessionRequest: any = {
      url: this.config.endpointUrl || `opc.tcp://127.0.0.1:4840`,
      timeout: this.config.sessionTimeout || 30000
    };

    const sessionResponse = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      mode: 'cors', // Explicit CORS handling
      body: JSON.stringify(sessionRequest)
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`Direct session creation failed: ${sessionResponse.status} ${sessionResponse.statusText} - ${errorText}`);
    }

    const sessionData = await sessionResponse.json();
    console.log('Direct OPC UA session created successfully');

    this.sessionInfo = {
      sessionId: sessionData.id,
      sessionTimeout: sessionData.timeout || 30000,
      maxRequestMessageSize: sessionData.maxRequestMessageSize || 65536,
      maxResponseMessageSize: sessionData.maxResponseMessageSize || 65536,
      endpointUrl: sessionData.url || sessionRequest.url,
      username: 'anonymous',
      roles: []
    };

    console.log('Direct session created:', {
      sessionId: this.sessionInfo.sessionId,
      timeout: this.sessionInfo.sessionTimeout,
      endpointUrl: this.sessionInfo.endpointUrl
    });
  }

  /**
   * Create session with authentication flow
   */
  private async createSessionWithAuth(): Promise<void> {
    // Step 1: Authenticate and create client session
    const authUrl = `${this.baseUrl}/api/1.0/auth`;
    
    console.log(`mapp Connect authentication: ${authUrl}`);
    
    try {
      // Use GET with Basic auth for mapp Connect
      let options: RequestInit;
      
      if (this.config.username) {
        const credentials = btoa(`${this.config.username}:${this.config.password || ''}`);
        options = {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${credentials}`
          },
          credentials: 'include', // Important for cookies
          mode: 'cors' // Explicit CORS handling
        };
      } else {
        // Anonymous access
        options = {
          method: 'GET',
          credentials: 'include', // Important for cookies
          mode: 'cors' // Explicit CORS handling
        };
      }

      const authResponse = await fetch(authUrl, options);

      if (!authResponse.ok) {
        const errorText = await authResponse.text();
        console.warn(`mapp Connect auth failed (${authResponse.status}): ${authResponse.statusText}`);
        console.warn('Auth response:', errorText);
        throw new Error(`${authResponse.status} ${authResponse.statusText} - ${errorText}`);
      }

      const authData = await authResponse.json();
      console.log('mapp Connect authentication successful:', authData);

      // Check if we have the necessary permissions
      if (authData.roles && authData.roles.length > 0) {
        console.log('User roles:', authData.roles);
      } else {
        console.log('No specific roles returned (may be anonymous or default access)');
      }

      // Step 2: Create OPC UA session
      const sessionUrl = `${this.baseUrl}/api/1.0/opcua/sessions`;
      console.log(`Creating OPC UA session: ${sessionUrl}`);

      const sessionRequest: any = {
        url: this.config.endpointUrl || `opc.tcp://127.0.0.1:4840`,
        timeout: this.config.sessionTimeout || 30000
      };

      // Add user credentials if provided
      if (this.config.username) {
        sessionRequest.userIdentityToken = {
          username: this.config.username,
          password: this.config.password || ''
        };
      }

      const sessionResponse = await fetch(sessionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Use the auth session cookies
        mode: 'cors', // Explicit CORS handling
        body: JSON.stringify(sessionRequest)
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        console.warn(`OPC UA session creation failed (${sessionResponse.status}): ${sessionResponse.statusText}`);
        console.warn('Session request was:', JSON.stringify(sessionRequest, null, 2));
        console.warn('Session response:', errorText);
        
        // If it's a 403, it might be a permissions issue or CORS issue - try alternative approaches
        if (sessionResponse.status === 403) {
          console.log('403 error - could be CORS or permissions. Trying different approaches...');
          
          // Check if this might be a CORS issue by examining response headers
          const corsHeaders = sessionResponse.headers.get('access-control-allow-origin');
          if (!corsHeaders) {
            console.warn('No CORS headers detected - this might be a CORS configuration issue');
          }
          
          console.log('Trying direct session creation without userIdentityToken...');
          
          // Try without userIdentityToken (server-side anonymous)
          const simpleRequest = {
            url: this.config.endpointUrl || `opc.tcp://127.0.0.1:4840`,
            timeout: sessionRequest.timeout
          };
          
          const retryResponse = await fetch(sessionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            mode: 'cors', // Explicit CORS handling
            body: JSON.stringify(simpleRequest)
          });
          
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            console.log('Session created successfully without userIdentityToken');
            
            this.sessionInfo = {
              sessionId: retryData.id,
              sessionTimeout: retryData.timeout || 30000,
              maxRequestMessageSize: retryData.maxRequestMessageSize || 65536,
              maxResponseMessageSize: retryData.maxResponseMessageSize || 65536,
              endpointUrl: retryData.url || simpleRequest.url,
              username: authData.username || 'anonymous',
              roles: authData.roles || []
            };
            
            console.log('mapp Connect session created (anonymous OPC UA):', {
              sessionId: this.sessionInfo.sessionId,
              timeout: this.sessionInfo.sessionTimeout,
              username: this.sessionInfo.username,
              endpointUrl: this.sessionInfo.endpointUrl
            });
            return; // Success!
          }
          
          throw new Error(`403 Forbidden - This could be a CORS issue or permission problem. 
If this is a CORS issue, ensure the mapp Connect server has proper CORS headers configured for cross-origin requests.
If this is a permission issue, the authenticated user may not have OPC UA access rights. 
Auth data: ${JSON.stringify(authData)}`);
        }
        
        throw new Error(`${sessionResponse.status} ${sessionResponse.statusText} - ${errorText}`);
      }

      const sessionData = await sessionResponse.json();
      console.log('OPC UA session created successfully');

      // Store the real session information
      this.sessionInfo = {
        sessionId: sessionData.id, // This is the numeric session ID from the server
        sessionTimeout: sessionData.timeout || 30000,
        maxRequestMessageSize: sessionData.maxRequestMessageSize || 65536,
        maxResponseMessageSize: sessionData.maxResponseMessageSize || 65536,
        endpointUrl: sessionData.url || sessionRequest.url,
        username: authData.username || 'anonymous',
        roles: authData.roles || []
      };
      
      console.log('mapp Connect session created:', {
        sessionId: this.sessionInfo.sessionId,
        timeout: this.sessionInfo.sessionTimeout,
        username: this.sessionInfo.username,
        endpointUrl: this.sessionInfo.endpointUrl
      });
      
    } catch (error) {
      console.warn(`mapp Connect session creation error:`, error);
      throw this.categorizeConnectionError(error as Error, authUrl);
    }
  }

  /**
   * Delete mapp Connect session
   */
  private async deleteSession(): Promise<void> {
    // Use the proper OPC UA session endpoint for deletion
    const url = `${this.baseUrl}/api/1.0/opcua/sessions/${this.sessionInfo!.sessionId}`;
    console.log(`Deleting mapp Connect session at: ${url}`);
    
    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.sessionInfo!.sessionId}`
      }
    });
  }

  /**
   * Start mapp Connect session keep-alive timer
   */
  private startSessionKeepAlive(): void {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
    }

    this.sessionTimer = setInterval(async () => {
      try {
        // Use the proper session endpoint for timeout reset
        const url = `${this.baseUrl}/api/1.0/opcua/sessions/${this.sessionInfo!.sessionId}`;
        await fetch(url, {
          method: 'HEAD',
          headers: {
            'Authorization': `Bearer ${this.sessionInfo!.sessionId}`
          }
        });
        console.log('mapp Connect session timeout reset successful');
      } catch (error) {
        console.warn('mapp Connect session keep-alive failed:', error);
      }
    }, this.config.keepAliveInterval);
  }

  /**
   * Connect to mapp Connect WebSocket push channel
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        const wsProtocol = this.config.wsProtocol || 'ws';
        const port = this.config.port || (this.config.protocol === 'https' ? 443 : 80);
        const wsUrl = `${wsProtocol}://${this.config.host}:${port}/api/1.0/pushchannel?sessionid=${this.sessionInfo!.sessionId}`;
        
        console.log(`Connecting mapp Connect WebSocket to: ${wsUrl}`);
        await this.webSocketManager.create(wsUrl);
        
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
