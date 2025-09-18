import { ConnectionConfig, SessionInfo, ConnectionState, ConnectionStateHandler, ErrorHandler } from './types.js';
/**
 * Enhanced WebSocket manager with better error handling and reconnection logic
 */
declare class WebSocketManager {
    private ws;
    private isClosingProgrammatically;
    create(url: string, headers?: Record<string, string>): Promise<void>;
    setupEvents(onOpen: () => void, onError: (error: any) => void, onClose: (event?: any) => void, onMessage: (data: string) => void): void;
    send(data: string): void;
    close(): void;
    get readyState(): number;
}
/**
 * Core connection management for mapp Connect OPC UA server
 * Handles authentication, session management, and WebSocket connections
 * Works in both Node.js and browser environments
 */
export declare class OpcuaConnection {
    private config;
    private sessionInfo;
    private connectionState;
    private webSocketManager;
    private sessionTimer;
    private reconnectTimer;
    private connectionStateHandlers;
    private errorHandlers;
    private messageHandlers;
    private baseUrl;
    private cookies;
    constructor(config: ConnectionConfig);
    /**
     * Connect to the OPC UA server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from the OPC UA server
     */
    disconnect(): Promise<void>;
    /**
     * Force reconnection with session recovery
     * Useful when connection issues are detected externally
     */
    reconnect(): Promise<void>;
    /**
     * Check if connected
     */
    get isConnected(): boolean;
    /**
     * Get current connection state
     */
    get state(): ConnectionState;
    /**
     * Get session information
     */
    getSessionInfo(): SessionInfo | null;
    /**
     * Change user identity for the current session
     * @param username New username (or undefined for anonymous)
     * @param password New password (optional)
     */
    changeUser(username?: string, password?: string): Promise<void>;
    /**
     * Get the WebSocket manager for subscriptions
     */
    getWebSocket(): WebSocketManager;
    /**
     * Make an authenticated API request
     */
    apiRequest(endpoint: string, options?: RequestInit): Promise<Response>;
    /**
     * Add connection state change handler
     */
    onConnectionStateChanged(handler: ConnectionStateHandler): void;
    /**
     * Add error handler
     */
    onError(handler: ErrorHandler): void;
    /**
     * Extract and store cookies from response headers (for Node.js)
     */
    private extractCookies;
    /**
     * Get cookie header string for requests (for Node.js)
     */
    private getCookieHeader;
    /**
     * Enhanced fetch with cookie handling
     */
    private fetchWithCookies;
    /**
     * Add WebSocket message handler
     */
    onMessage(handler: (data: any) => void): void;
    /**
     * Test connection accessibility (public method for manual testing)
     */
    testConnection(): Promise<void>;
    private setState;
    private handleError;
    /**
     * Test connection to verify accessibility with detailed error handling
     */
    private testCertificate;
    /**
     * Categorize connection errors for better diagnostics
     */
    private categorizeConnectionError;
    /**
     * Create mapp Connect session with enhanced error handling
     */
    private createSession;
    /**
     * Create session directly (for anonymous access)
     */
    private createSessionDirect;
    /**
     * Create session with authentication flow
     */
    private createSessionWithAuth;
    /**
     * Delete mapp Connect session
     */
    private deleteSession;
    /**
     * Start mapp Connect session keep-alive timer
     */
    private startSessionKeepAlive;
    /**
     * Connect to mapp Connect WebSocket push channel
     */
    private connectWebSocket;
    /**
     * Handle incoming WebSocket message
     */
    private handleWebSocketMessage;
    /**
     * Schedule reconnection attempt with full session recovery
     */
    private scheduleReconnect;
    /**
     * Recover connection by creating new session and reconnecting WebSocket
     */
    private recoverConnection;
}
export {};
//# sourceMappingURL=connection.d.ts.map