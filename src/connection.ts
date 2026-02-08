import { 
  ConnectionConfig, 
  SessionInfo, 
  ConnectionState, 
  ConnectionStateHandler, 
  ErrorHandler,
  SessionRequest,
  UserCredentials
} from './types.js';
import { LuxConnectErrorCode, rejectWithError } from './errors.js';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

// Add global error handling for unhandled WebSocket errors in Node.js
if (!isBrowser) {
  // Catch unhandled error events that might crash the process
  process.on('uncaughtException', (error) => {
    if (error.message && error.message.includes('WebSocket was closed before the connection was established')) {
      console.debug('Caught and handled WebSocket establishment error:', error.message);
      // Don't crash the process for this specific error
      return;
    }
    // Re-throw other uncaught exceptions
    throw error;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CrossPlatformWebSocket = WebSocket | any; // 'any' for Node.js ws package

/**
 * Enhanced WebSocket manager with better error handling and reconnection logic
 */
class WebSocketManager {
  private ws: CrossPlatformWebSocket = null;
  private isClosingProgrammatically = false;

  async create(url: string, headers?: Record<string, string>): Promise<void> {
    // Always close existing WebSocket first to prevent old connections from reconnecting
    try {
      this.close();
    } catch (error) {
      // Ignore close errors when creating new connection
      console.debug('Error closing existing WebSocket during create (ignored):', error);
    }
    
    if (isBrowser) {
      // Browser WebSocket - cookies are handled automatically by the browser
      this.ws = new WebSocket(url);
    } else {
      // Dynamic import for Node.js
      try {
        const wsModule = await import('ws');
        // Handle both default and named exports
        const WebSocketClass = wsModule.default || wsModule.WebSocket || wsModule;
        
        // Node.js WebSocket - need to explicitly pass headers including cookies
        const options = headers ? { headers } : undefined;
        this.ws = new WebSocketClass(url, options);
        
        // Add critical error event handler immediately to prevent crashes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws.on('error', (error: any) => {
          console.debug('WebSocket error during creation (handled):', error);
          // Don't let this crash the process - the setupEvents will handle it properly
        });
        
      } catch (error) {
        console.error('WebSocket import error:', error);
        throw new Error('ws package not found. Install with: npm install ws');
      }
    }
  }

  setupEvents(
    onOpen: () => void,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => void, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClose: (event?: any) => void,
    onMessage: (data: string) => void
  ): void {
    if (!this.ws) return;

    if (isBrowser) {
      // Browser WebSocket API
      this.ws.onopen = onOpen;
      this.ws.onerror = onError;
      this.ws.onclose = (event: CloseEvent) => {
        // Don't trigger reconnection if this was a programmatic close
        if (!this.isClosingProgrammatically) {
          onClose(event);
        }
      };
      this.ws.onmessage = (event: MessageEvent) => onMessage(event.data);
    } else {
      // Node.js ws package API - remove any existing listeners first
      this.ws.removeAllListeners();
      
      this.ws.on('open', onOpen);
      this.ws.on('error', onError);
      this.ws.on('close', (code: number, reason: string) => {
        // Don't trigger reconnection if this was a programmatic close
        if (!this.isClosingProgrammatically) {
          onClose({ code, reason });
        }
      });
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
      this.isClosingProgrammatically = true;
      
      try {
        // Remove event listeners first to prevent unwanted reconnection attempts
        if (isBrowser) {
          this.ws.onopen = null;
          this.ws.onerror = null;
          this.ws.onclose = null;
          this.ws.onmessage = null;
        } else {
          this.ws.removeAllListeners();
        }
        
        // Close the connection only if it's in a state that allows closing
        const readyState = this.ws.readyState;
        if (readyState === (this.ws.OPEN || 1) || 
            readyState === (this.ws.CONNECTING || 0)) {
          this.ws.close(1000, 'Connection closed programmatically'); // Normal closure
        }
        
        // For Node.js, wait a brief moment for the close to process
        if (!isBrowser) {
          // Give it a moment to close cleanly before nullifying
          setTimeout(() => {
            this.ws = null;
          }, 50);
        } else {
          this.ws = null;
        }
        
      } catch (error) {
        // Ignore close errors - we're trying to clean up anyway
        console.debug('WebSocket close error (ignored):', error);
        this.ws = null;
      }
      
      this.isClosingProgrammatically = false;
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageHandlers: Array<(data: any) => void> = [];

  private baseUrl: string;
  
  // Cookie jar for Node.js (browsers handle cookies automatically)
  private cookies: Map<string, string> = new Map();
  
  // Session persistence keys
  private static readonly SESSION_STORAGE_KEY = 'opcua_session_info';
  
  // Subscription tracking for orphaned cleanup
  private knownSubscriptionIds = new Set<number>();

  constructor(config: ConnectionConfig) {
    this.config = {
      protocol: 'http',           // Default to HTTP
      enableWebSocket: true,
      keepAliveInterval: 20000, // 20 seconds (2/3 of typical 30s timeout)
      ...config
    };
    
    const protocol = this.config.protocol || 'http';
    const port = this.config.port || (protocol === 'https' ? 443 : 80);
    this.baseUrl = `${protocol}://${this.config.host}:${port}/api/1.0`;
    
    console.log(`mapp Connect: Base URL = ${this.baseUrl}`);
  }

  /**
   * Save session info to localStorage for persistence across page refreshes
   */
  private saveSessionToStorage(): void {
    if (typeof localStorage === 'undefined' || !this.sessionInfo) return;
    
    try {
      const sessionData = {
        sessionInfo: this.sessionInfo,
        cookies: Array.from(this.cookies.entries()),
        timestamp: Date.now()
      };
      
      localStorage.setItem(OpcuaConnection.SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      console.log('💾 Session saved to localStorage:', { 
        sessionId: this.sessionInfo?.sessionId, 
        cookieCount: this.cookies.size 
      });
    } catch (error) {
      console.warn('Failed to save session to localStorage:', error);
    }
  }

  /**
   * Try to restore session from localStorage
   */
  private tryRestoreSession(): boolean {
    if (typeof localStorage === 'undefined') return false;
    
    try {
      const stored = localStorage.getItem(OpcuaConnection.SESSION_STORAGE_KEY);
      if (!stored) return false;
      
      const sessionData = JSON.parse(stored);
      const age = Date.now() - (sessionData.timestamp || 0);
      
      // Don't use sessions older than 25 minutes (sessions typically timeout at 30min)
      if (age > 25 * 60 * 1000) {
        console.log('🗑️ Stored session too old, discarding');
        localStorage.removeItem(OpcuaConnection.SESSION_STORAGE_KEY);
        return false;
      }
      
      this.sessionInfo = sessionData.sessionInfo;
      this.cookies.clear();
      if (sessionData.cookies) {
        for (const [key, value] of sessionData.cookies) {
          this.cookies.set(key, value);
        }
      }
      
      console.log('🔄 Restored session from localStorage:', { 
        sessionId: this.sessionInfo?.sessionId, 
        age: Math.round(age / 1000) + 's',
        cookieCount: this.cookies.size
      });
      return true;
    } catch (error) {
      console.warn('Failed to restore session from localStorage:', error);
      localStorage.removeItem(OpcuaConnection.SESSION_STORAGE_KEY);
      return false;
    }
  }

  /**
   * Clear stored session from localStorage
   */
  private clearStoredSession(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(OpcuaConnection.SESSION_STORAGE_KEY);
    }
  }

  /**
   * Validate restored session and clean up any existing subscriptions
   */
  private async validateAndCleanSession(): Promise<boolean> {
    if (!this.sessionInfo) return false;
    
    try {
      // Test if session is still valid by making a simple API call
      const sessionUrl = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
      
      console.log('🔍 Validating restored session:', this.sessionInfo.sessionId);
      
      const response = await this.fetchWithCookies(sessionUrl, {
        method: 'GET',
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Session validation failed: ${response.status}`);
      }
      
      const sessionData = await response.json();
      console.log('✅ Session is valid, cleaning up subscriptions...');
      
      // Clean up any existing subscriptions from previous page load
      await this.cleanupExistingSubscriptions();
      
      console.log('✅ Session restored and cleaned:', {
        sessionId: this.sessionInfo.sessionId,
        username: sessionData.username || this.sessionInfo.username
      });
      
      return true;
    } catch (error) {
      console.log('❌ Session validation failed:', error);
      return false;
    }
  }

  /**
   * Clean up any existing subscriptions for this session
   */
  private async cleanupExistingSubscriptions(): Promise<void> {
    if (!this.sessionInfo) return;
    
    console.log('🧹 Setting up subscription cleanup on WebSocket messages...');
    
    // Instead of trying to list subscriptions (which may not be supported),
    // we'll track orphaned subscription IDs from WebSocket messages and clean them up
    this.setupOrphanedSubscriptionCleanup();
  }

  /**
   * Set up cleanup for orphaned subscriptions detected via WebSocket messages
   */
  private setupOrphanedSubscriptionCleanup(): void {
    const orphanedSubscriptions = new Set<number>();
    
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.onMessage((message: any) => {
      // Check if this message has subscription data from our current session
      // Convert both to strings for comparison since sessionId can be number or string
      if (message && 
          String(message.sessionId) === String(this.sessionInfo?.sessionId) && 
          message.subscriptionId && 
          message.DataNotifications) {
        
        const subscriptionId = Number(message.subscriptionId);
        
        // Check if this subscription ID is known to our SubscriptionManager
        // If not, it's probably orphaned from a previous page load
        if (!this.isKnownSubscription(subscriptionId)) {
          orphanedSubscriptions.add(subscriptionId);
          
          // Clean up this orphaned subscription
          this.cleanupOrphanedSubscription(subscriptionId)
            .catch(error => {
              console.warn(`Failed to clean up orphaned subscription ${subscriptionId}:`, error);
            });
        }
      }
    });
  }

  /**
   * Check if a subscription ID is known to our current SubscriptionManager
   */
  private isKnownSubscription(subscriptionId: number): boolean {
    return this.knownSubscriptionIds.has(subscriptionId);
  }

  /**
   * Method for SubscriptionManager to register new subscriptions
   */
  registerSubscription(subscriptionId: number): void {
    this.knownSubscriptionIds.add(subscriptionId);
  }

  /**
   * Method for SubscriptionManager to unregister removed subscriptions
   */
  unregisterSubscription(subscriptionId: number): void {
    this.knownSubscriptionIds.delete(subscriptionId);
  }

  /**
   * Clean up a specific orphaned subscription
   */
  private async cleanupOrphanedSubscription(subscriptionId: number): Promise<void> {
    if (!this.sessionInfo) return;
    
    try {
      const deleteUrl = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}/subscriptions/${subscriptionId}`;
      
      console.log(`🗑️ Cleaning up orphaned subscription ${subscriptionId}`);
      
      await this.fetchWithCookies(deleteUrl, {
        method: 'DELETE',
        credentials: 'include'
      });
      
      console.log(`✅ Successfully cleaned up orphaned subscription ${subscriptionId}`);
    } catch (error) {
      console.warn(`Failed to clean up subscription ${subscriptionId}:`, error);
      // Don't throw - this is cleanup, not critical for operation
    }
  }

  /**
   * Connect to the OPC UA server
   */
  public async connect(): Promise<void> {
    try {
      this.setState(ConnectionState.CONNECTING);

      // Test certificate (optional step)
      await this.testCertificate();

      // Try to restore existing session first
      let sessionRestored = false;
      if (this.tryRestoreSession()) {
        try {
          sessionRestored = await this.validateAndCleanSession();
        } catch (error) {
          console.log('🚫 Session validation failed, creating new session:', error);
          this.clearStoredSession();
          sessionRestored = false;
        }
      }
      
      // Create new session if restoration failed
      if (!sessionRestored) {
        await this.createSession();
        this.saveSessionToStorage();
      }

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

    // TODO: Add graceful shutdown timeout to prevent hanging
    // TODO: Clean up any pending API requests
    // Delete session
    if (this.sessionInfo) {
      try {
        await this.deleteSession();
      } catch (error) {
        // Ignore errors during cleanup
        // TODO: Log cleanup errors for debugging
      }
    }

    this.sessionInfo = null;
    this.clearStoredSession(); // Clear localStorage when disconnecting
    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Force reconnection with session recovery
   * Useful when connection issues are detected externally
   */
  public async reconnect(): Promise<void> {
    if (this.connectionState === ConnectionState.DISCONNECTED) {
      // If completely disconnected, just do a normal connect
      return this.connect();
    }
    
    try {
      this.setState(ConnectionState.RECONNECTING);
      console.log('Manual reconnection initiated...');
      
      // Close existing WebSocket
      this.webSocketManager.close();
      
      // Perform full connection recovery
      await this.recoverConnection();
      
      this.setState(ConnectionState.CONNECTED);
      console.log('Manual reconnection completed successfully');
      
    } catch (error) {
      this.setState(ConnectionState.DISCONNECTED);
      this.handleError(error as Error);
      throw error;
    }
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
   * Change user identity for the current session
   * @param username New username (or undefined for anonymous)
   * @param password New password (optional)
   */
  public async changeUser(username?: string, password?: string): Promise<void> {
    if (!this.sessionInfo) {
      return rejectWithError(
        LuxConnectErrorCode.NOT_CONNECTED,
        'Not connected to OPC UA server. Call connect() first.'
      );
    }

    const sessionUrl = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
    
    // Prepare user identity token
    let userIdentityToken: UserCredentials;
    if (username) {
      userIdentityToken = {
        username,
        password: password || ''
      };
    } else {
      // Anonymous user
      userIdentityToken = {};
    }

    console.log(`Changing user for session ${this.sessionInfo.sessionId} to: ${username || 'anonymous'}`);

    try {
      const response = await this.fetchWithCookies(sessionUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userIdentityToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return rejectWithError(
          LuxConnectErrorCode.AUTHENTICATION_FAILED,
          `Failed to change user: ${response.status} ${response.statusText} - ${errorText}`,
          { status: response.status, statusText: response.statusText }
        );
      }

      const responseData = await response.json();
      
      // Check if the change was successful
      if (responseData.statusCode && responseData.statusCode !== 0) {
        return rejectWithError(
          LuxConnectErrorCode.AUTHENTICATION_FAILED,
          `User change failed: ${responseData.statusCode} - ${responseData.description || 'Unknown error'}`,
          responseData
        );
      }

      // Update session info with new user details
      this.sessionInfo.username = username || 'anonymous';
      
      // Note: We don't update roles here as they're not returned in the PATCH response
      // The roles would be updated on the next authenticated request or could be fetched separately
      
      console.log(`✅ Successfully changed user to: ${this.sessionInfo.username}`);

      // Emit connection state change to notify subscriptions may need to be re-established
      // (as mentioned in the API docs, changing user may cause subscription discontinuities)
      this.setState(this.state);

    } catch (error) {
      return rejectWithError(
        LuxConnectErrorCode.AUTHENTICATION_FAILED,
        `Failed to change user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
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
      return rejectWithError(
        LuxConnectErrorCode.NOT_CONNECTED,
        'Not connected to OPC UA server. Call connect() first.'
      );
    }

    // Construct full URL from base and endpoint
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await this.fetchWithCookies(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionInfo.sessionId}`,
          ...options.headers
        }
      });

      if (!response.ok) {
        return rejectWithError(
          LuxConnectErrorCode.SERVER_ERROR,
          `API request failed: ${response.status} ${response.statusText}`,
          { status: response.status, statusText: response.statusText, endpoint }
        );
      }

      return response;
    } catch (error) {
      return rejectWithError(
        LuxConnectErrorCode.NETWORK_ERROR,
        `Network error during API request to ${endpoint}`,
        { endpoint },
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
   * Extract and store cookies from response headers (for Node.js)
   */
  private extractCookies(response: Response): void {
    if (isBrowser) return; // Browsers handle cookies automatically
    
    // In Node.js, response.headers.getSetCookie() returns an array of cookie strings
    try {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setCookieHeaders = (response.headers as any).getSetCookie ? 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        (response.headers as any).getSetCookie() : 
        [response.headers.get('set-cookie')].filter(Boolean);
      
      for (const cookieString of setCookieHeaders) {
        if (cookieString) {
          // Parse each cookie: "name=value; Path=/; HttpOnly"
          const [nameValue] = cookieString.split(';');
          const [name, value] = nameValue.split('=');
          if (name && value) {
            this.cookies.set(name.trim(), value.trim());
            console.log(`Cookie stored: ${name.trim()}=${value.trim()}`);
          }
        }
      }
    } catch (error) {
      console.warn('Cookie extraction error:', error);
    }
  }

  /**
   * Get cookie header string for requests (for Node.js)
   */
  private getCookieHeader(): string {
    if (isBrowser || this.cookies.size === 0) return '';
    
    const cookiePairs: string[] = [];
    this.cookies.forEach((value, name) => {
      cookiePairs.push(`${name}=${value}`);
    });
    return cookiePairs.join('; ');
  }

  /**
   * Enhanced fetch with cookie handling
   */
  private async fetchWithCookies(url: string, options: RequestInit = {}): Promise<Response> {
    // Add cookies to headers for Node.js
    if (!isBrowser && this.cookies.size > 0) {
      options.headers = {
        ...options.headers,
        'Cookie': this.getCookieHeader()
      };
    }
    
    const response = await fetch(url, options);
    
    // Extract cookies from response for Node.js
    if (!isBrowser) {
      this.extractCookies(response);
    }
    
    return response;
  }

  /**
   * Add WebSocket message handler
   */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    
    const testUrl = `${this.baseUrl}/auth`;
    
    try {
      console.log(`Testing endpoint: ${testUrl}`);
      
      const response = await this.fetchWithCookies(testUrl, {
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
      
      // Enhanced error categorization for HTTPS certificate issues
      if (this.config.protocol === 'https' && message.toLowerCase().includes('failed to fetch')) {
        // For HTTPS connections, "Failed to fetch" is often a certificate issue
        throw new Error(`Certificate/SSL Error: Unable to connect to HTTPS server at ${this.baseUrl}. 
This is likely due to an untrusted certificate. Please open ${this.baseUrl} in your browser and accept the security certificate, then try again.
Original error: ${message}`);
      }
      
      throw this.categorizeConnectionError(error as Error, testUrl);
    }
  }

  /**
   * Categorize connection errors for better diagnostics
   */
  private categorizeConnectionError(error: Error, url: string): Error {
    const errorMsg = error.message.toLowerCase();
    const originalMessage = error.message;
    
    // TODO: Add more specific error detection patterns
    // TODO: Consider adding error codes for programmatic handling
    // TODO: Add support for different error messages in multiple languages
    if (errorMsg.includes('certificate') || errorMsg.includes('ssl') || errorMsg.includes('tls') || 
        errorMsg.includes('authority') || errorMsg.includes('net::err_cert') || 
        errorMsg.includes('sec_error') || errorMsg.includes('insecure')) {
      return new Error(`Certificate/Authority Error: ${originalMessage}
        
🔐 Certificate Issue Detected:
This appears to be an SSL/TLS certificate problem. To resolve this:
1. Open ${this.baseUrl} in your browser
2. Accept the security warning (click "Advanced" then "Proceed")
3. Return here and try connecting again

Original error: ${originalMessage}`);
    } else if (errorMsg.includes('failed to fetch') || errorMsg.includes('networkerror') || errorMsg.includes('network')) {
      return new Error(`Network Error: ${originalMessage}

🌐 Connection Issue:
Cannot reach the server at ${url}. Please check:
1. Server is running and accessible
2. URL and port are correct  
3. Firewall settings allow the connection

Original error: ${originalMessage}`);
    } else if (errorMsg.includes('cors')) {
      return new Error(`CORS Error: ${originalMessage}

🚫 Cross-Origin Request Blocked:
The server needs to allow requests from this origin.
Server configuration may need CORS headers.

Original error: ${originalMessage}`);
    } else {
      // Preserve the original error message for unknown errors
      return new Error(`Connection error for ${url}: ${originalMessage}`);
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
    const sessionUrl = `${this.baseUrl}/opcua/sessions`;
    console.log(`Creating OPC UA session directly: ${sessionUrl}`);

    const sessionRequest: SessionRequest = {
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
    
    // Save session to localStorage for persistence
    this.saveSessionToStorage();
  }

  /**
   * Create session with authentication flow
   */
  private async createSessionWithAuth(): Promise<void> {
    // Step 1: Authenticate and create client session
    const authUrl = `${this.baseUrl}/auth`;
    
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

      const authResponse = await this.fetchWithCookies(authUrl, options);

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
      const sessionUrl = `${this.baseUrl}/opcua/sessions`;
      console.log(`Creating OPC UA session: ${sessionUrl}`);

      const sessionRequest: SessionRequest = {
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

      const sessionResponse = await this.fetchWithCookies(sessionUrl, {
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
            
            // Save session to localStorage for persistence
            this.saveSessionToStorage();
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
      
      // Save session to localStorage for persistence
      this.saveSessionToStorage();
      
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
    const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo!.sessionId}`;
    console.log(`Deleting mapp Connect session at: ${url}`);
    
    // TODO: Add timeout for delete request to prevent hanging
    // TODO: Handle specific HTTP error codes (404 if already deleted, etc.)
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
        const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo!.sessionId}`;
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
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let isSettled = false; // Track if promise is already resolved/rejected

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const safeResolve = () => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          resolve();
        }
      };

// eslint-disable-next-line @typescript-eslint/no-explicit-any     
      const safeReject = (error: any) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(error);
        }
      };

      try {
        // Automatically determine WebSocket protocol based on HTTP protocol
        let wsProtocol: string;
        if (this.config.wsProtocol) {
          // Use explicitly specified WebSocket protocol
          wsProtocol = this.config.wsProtocol;
        } else {
          // Auto-select: wss for https, ws for http
          wsProtocol = this.config.protocol === 'https' ? 'wss' : 'ws';
        }
        
        const port = this.config.port || (this.config.protocol === 'https' ? 443 : 80);
        const wsUrl = `${wsProtocol}://${this.config.host}:${port}/api/1.0/pushchannel?sessionid=${this.sessionInfo!.sessionId}`;
        
        console.log(`Connecting mapp Connect WebSocket to: ${wsUrl} (protocol: ${this.config.protocol} -> ${wsProtocol})`);
        
        // Prepare headers including cookies for Node.js WebSocket connections
        const headers: Record<string, string> = {};
        
        // Add cookies for Node.js (browsers handle cookies automatically)
        if (!isBrowser && this.cookies.size > 0) {
          headers['Cookie'] = this.getCookieHeader();
          console.log('WebSocket using cookies:', headers['Cookie']);
        }
        
        await this.webSocketManager.create(wsUrl, Object.keys(headers).length > 0 ? headers : undefined);
        
        this.webSocketManager.setupEvents(
          () => {
            console.log('WebSocket connected successfully');
            safeResolve();
          },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (error: any) => {
            console.error('WebSocket connection error:', error);
            safeReject(error);
          },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          (event: any) => {
            const code = event?.code || 'unknown';
            const reason = event?.reason || 'No reason provided';
            console.log(`WebSocket disconnected - Code: ${code}, Reason: ${reason}`);
            
            // Only attempt reconnection if we're supposed to be connected
            // and this isn't a normal close (1000) or going away (1001)
            if (this.isConnected && code !== 1000 && code !== 1001) {
              console.log('Unexpected WebSocket disconnection, attempting recovery...');
              this.scheduleReconnect();
            } else if (this.isConnected) {
              console.log('WebSocket closed normally, but connection should still be active - scheduling reconnect...');
              this.scheduleReconnect();
            } else {
              console.log('WebSocket closed during expected disconnection');
            }
          },
          (data: string) => {
            // Handle incoming messages (will be used by subscription manager)
            this.handleWebSocketMessage(data);
          }
        );

        // Timeout for connection with proper cleanup
        timeoutHandle = setTimeout(() => {
          if (this.webSocketManager.readyState !== 1) { // OPEN
            safeReject(new Error('WebSocket connection timeout'));
          }
        }, 10000); // Increased timeout to 10 seconds

      } catch (error) {
        safeReject(error);
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
   * Schedule reconnection attempt with full session recovery
   */
  private scheduleReconnect(): void {
    // Prevent multiple concurrent reconnection attempts
    if (this.reconnectTimer) {
      console.log('Reconnection already scheduled, skipping duplicate request');
      return;
    }
    
    // Don't schedule reconnection if we're already reconnecting or disconnecting
    if (this.connectionState === ConnectionState.RECONNECTING || 
        this.connectionState === ConnectionState.DISCONNECTING ||
        this.connectionState === ConnectionState.DISCONNECTED) {
      console.log(`Skipping reconnection - current state: ${this.connectionState}`);
      return;
    }

    console.log('Scheduling reconnection in 5 seconds...');
    this.reconnectTimer = setTimeout(async () => {
      // Clear the timer reference immediately to allow future reconnection scheduling
      this.reconnectTimer = null;
      
      try {
        console.log('Starting reconnection with session recovery...');
        this.setState(ConnectionState.RECONNECTING);
        
        // First, try to reconnect WebSocket with existing session
        try {
          await this.connectWebSocket();
          console.log('WebSocket reconnected with existing session');
          this.setState(ConnectionState.CONNECTED);
          return;
        } catch (wsError) {
          console.log('WebSocket reconnection with existing session failed, creating new session...', wsError);
        }
        
        // If WebSocket reconnection fails, the session is likely invalid
        // Create a new session and then connect WebSocket
        await this.recoverConnection();
        
        this.setState(ConnectionState.CONNECTED);
        console.log('Connection recovery completed successfully');
        
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.handleError(error as Error);
        
        // Only schedule another reconnect if we're still supposed to be connected
        if (this.connectionState !== ConnectionState.DISCONNECTED && 
            this.connectionState !== ConnectionState.DISCONNECTING) {
          this.scheduleReconnect(); // Try again
        }
      }
    }, 5000); // Retry after 5 seconds
  }

  /**
   * Recover connection by creating new session and reconnecting WebSocket
   */
  private async recoverConnection(): Promise<void> {
    console.log('Recovering connection with new session...');
    
    // Clear old session info
    const oldSessionId = this.sessionInfo?.sessionId;
    this.sessionInfo = null;
    
    try {
      // Attempt to delete the old session (best effort, may fail if server is down)
      if (oldSessionId) {
        try {
          const deleteUrl = `${this.baseUrl}/opcua/sessions/${oldSessionId}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${oldSessionId}` }
          });
          console.log('Old session deleted successfully');
        } catch (deleteError) {
          console.warn('Could not delete old session (server may be unreachable):', deleteError);
        }
      }
      
      // Test server accessibility
      await this.testCertificate();
      
      // Create new session
      await this.createSession();
      if (this.sessionInfo) {
        console.log('New session created:', (this.sessionInfo as SessionInfo).sessionId);
      } else {
        console.log('New session creation completed but sessionInfo is null');
      }
      
      // Restart session keep-alive
      this.startSessionKeepAlive();
      
      // Connect WebSocket with new session
      if (this.config.enableWebSocket) {
        await this.connectWebSocket();
        console.log('WebSocket connected with new session');
      }
      
    } catch (error) {
      console.error('Connection recovery failed:', error);
      throw error;
    }
  }
}
