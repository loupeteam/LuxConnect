import {
  ConnectionConfig,
  SessionInfo,
  ConnectionState,
  ConnectionStateHandler,
  ErrorHandler,
  SessionRequest,
  UserCredentials,
} from './types.js';
import { LuxConnectErrorCode, rejectWithError } from './errors.js';
import { type Logger, consoleLogger } from './logger.js';
import {
  type SessionStore,
  LocalStorageSessionStore,
} from './session-store.js';
import { WebSocketManager } from './websocket-manager.js';
import {
  DEFAULT_KEEP_ALIVE_INTERVAL_MS,
  DEFAULT_MAX_MESSAGE_SIZE,
  DEFAULT_SESSION_TIMEOUT_MS,
  KEEP_ALIVE_REQUEST_TIMEOUT_MAX_MS,
  KEEP_ALIVE_REQUEST_TIMEOUT_MIN_MS,
  RECONNECT_BACKOFF_MS,
  SESSION_DELETE_TIMEOUT_MS,
  WEBSOCKET_CONNECT_TIMEOUT_MS,
} from './constants.js';

const isBrowser = typeof window !== 'undefined';

/**
 * Core connection management for mapp Connect OPC UA server.
 *
 * Responsibilities:
 *  - HTTP session lifecycle (create / restore / delete) with cookie handling.
 *  - WebSocket push channel lifecycle.
 *  - Session keep-alive with bounded request timeout and reconnect-on-failure.
 *  - Single reconnection pipeline (`ensureConnected`) shared by initial
 *    connect, manual reconnect, and automatic background recovery.
 *
 * Works in both Node.js and browser environments.
 */
export class OpcuaConnection {
  // -------- Configuration --------
  private readonly config: ConnectionConfig;
  private readonly baseUrl: string;
  private readonly log: Logger;
  private readonly sessionStore: SessionStore | null;

  // -------- State --------
  private sessionInfo: SessionInfo | null = null;
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private readonly webSocketManager: WebSocketManager;
  /** Cookie jar for Node.js (browsers handle cookies automatically). */
  private readonly cookies = new Map<string, string>();

  // -------- Timers / async control --------
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveAbort: AbortController | null = null;
  private keepAliveInFlight = false;
  /** Tracks an in-progress disconnect so connect() can wait it out (React StrictMode safety). */
  private pendingDisconnect: Promise<void> | null = null;
  /** True between connect() and disconnect(); gates auto-reconnect. */
  private retryEnabled = false;

  // -------- Event handlers --------
  private readonly connectionStateHandlers: ConnectionStateHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly messageHandlers: Array<(data: any) => void> = [];
  private readonly userChangeHandlers: Array<(username: string | undefined) => void> = [];

  constructor(config: ConnectionConfig) {
    this.config = {
      protocol: 'http',
      enableWebSocket: true,
      keepAliveInterval: DEFAULT_KEEP_ALIVE_INTERVAL_MS,
      ...config,
    };

    this.log = (config.logger as Logger | undefined) ?? consoleLogger;
    this.webSocketManager = new WebSocketManager(this.log);

    // Session persistence: default-on with localStorage; opt out by passing `false`.
    if (config.sessionStore === false) {
      this.sessionStore = null;
    } else if (config.sessionStore) {
      this.sessionStore = config.sessionStore as SessionStore;
    } else {
      this.sessionStore = new LocalStorageSessionStore(undefined, undefined, this.log);
    }

    const protocol = this.config.protocol || 'http';
    const port = this.config.port || (protocol === 'https' ? 443 : 80);
    this.baseUrl = `${protocol}://${this.config.host}:${port}/api/1.0`;

    this.log.info(`mapp Connect: Base URL = ${this.baseUrl}`);
  }

  /** Returns the logger configured for this connection. */
  public getLogger(): Logger {
    return this.log;
  }

  // ============================================================
  // Public API
  // ============================================================

  /** Current connection state. */
  public get state(): ConnectionState { return this.connectionState; }
  public get isConnected(): boolean { return this.connectionState === ConnectionState.CONNECTED; }
  public getSessionInfo(): SessionInfo | null { return this.sessionInfo; }
  public getWebSocket(): WebSocketManager { return this.webSocketManager; }

  /** Connect to the OPC UA server. Enables auto-retry until `disconnect()` is called. */
  public async connect(): Promise<void> {
    // If a disconnect is in progress (StrictMode double-invoke), wait for it.
    if (this.pendingDisconnect) {
      await this.pendingDisconnect;
    }
    this.retryEnabled = true;
    try {
      await this.ensureConnected();
    } catch (error) {
      this.setState(ConnectionState.DISCONNECTED);
      this.handleError(error as Error);
      // Schedule background retry so the connection is re-attempted indefinitely.
      this.scheduleReconnect();
      throw error;
    }
  }

  /** Disconnect and stop all retries. Safe to call multiple times. */
  public async disconnect(): Promise<void> {
    this.pendingDisconnect = this.doDisconnect();
    return this.pendingDisconnect;
  }

  /** Force a reconnect using session recovery. */
  public async reconnect(): Promise<void> {
    if (this.connectionState === ConnectionState.DISCONNECTED) {
      return this.connect();
    }
    this.cancelReconnectTimer();
    this.stopSessionKeepAlive();
    this.webSocketManager.close();
    try {
      this.setState(ConnectionState.RECONNECTING);
      this.log.info('Manual reconnection initiated...');
      // Drop old session so ensureConnected creates a fresh one.
      await this.bestEffortDeleteSession();
      this.sessionInfo = null;
      await this.ensureConnected();
      this.log.info('Manual reconnection completed successfully');
    } catch (error) {
      this.setState(ConnectionState.DISCONNECTED);
      this.handleError(error as Error);
      throw error;
    }
  }

  /** Test connectivity to the server (does not create a session). */
  public async testConnection(): Promise<void> {
    return this.testServerReachable();
  }

  /**
   * Change the authenticated user for the current session.
   * @param username New username, or undefined for anonymous.
   * @param password New password (optional).
   */
  public async changeUser(username?: string, password?: string): Promise<void> {
    if (!this.sessionInfo) {
      return rejectWithError(
        LuxConnectErrorCode.NOT_CONNECTED,
        'Not connected to OPC UA server. Call connect() first.',
      );
    }

    const sessionUrl = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
    const userIdentityToken: UserCredentials = username
      ? { username, password: password || '' }
      : {};

    this.log.info(`Changing user for session ${this.sessionInfo.sessionId} to: ${username || 'anonymous'}`);

    try {
      const response = await this.fetchWithCookies(sessionUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIdentityToken }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return rejectWithError(
          LuxConnectErrorCode.AUTHENTICATION_FAILED,
          `Failed to change user: ${response.status} ${response.statusText} - ${errorText}`,
          { status: response.status, statusText: response.statusText },
        );
      }

      const data = await response.json();
      if (data.statusCode && data.statusCode !== 0) {
        return rejectWithError(
          LuxConnectErrorCode.AUTHENTICATION_FAILED,
          `User change failed: ${data.statusCode} - ${data.description || 'Unknown error'}`,
          data,
        );
      }

      this.sessionInfo.username = username || 'anonymous';
      // Determine roles for the new identity. Prefer roles from the PATCH
      // response when present; otherwise re-query `/auth` so we never carry
      // stale roles from the previous user. Fall back to `[]` if `/auth`
      // doesn't return role info (e.g. anonymous access on some servers).
      if (Array.isArray(data?.roles)) {
        this.sessionInfo.roles = data.roles as string[];
      } else {
        try {
          const authData = await this.authenticate(username, password);
          this.sessionInfo.roles = authData?.roles ?? [];
        } catch (e) {
          this.log.warn('Failed to refresh roles after changeUser; clearing roles:', e);
          this.sessionInfo.roles = [];
        }
      }
      this.persistSession();
      this.log.info(`Successfully changed user to: ${this.sessionInfo.username}`, {
        roles: this.sessionInfo.roles,
      });
      this.fireUserChanged(this.sessionInfo.username);
      // Re-emit current state so subscribers can refresh subscriptions if desired.
      this.setState(this.state);
    } catch (error) {
      return rejectWithError(
        LuxConnectErrorCode.AUTHENTICATION_FAILED,
        `Failed to change user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error,
      );
    }
  }

  /** Make an authenticated API request. */
  public async apiRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
    if (!this.sessionInfo) {
      return rejectWithError(
        LuxConnectErrorCode.NOT_CONNECTED,
        'Not connected to OPC UA server. Call connect() first.',
      );
    }
    const url = `${this.baseUrl}${endpoint}`;
    try {
      const response = await this.fetchWithCookies(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.sessionInfo.sessionId}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        let bodyText = '';
        try { bodyText = await response.text(); } catch (e) { bodyText = `<failed to read body: ${String(e)}>`; }
        this.log.error(`API request failed: ${response.status} ${response.statusText} - ${bodyText}`, { url, endpoint });
        return rejectWithError(
          LuxConnectErrorCode.SERVER_ERROR,
          `API request failed: ${response.status} ${response.statusText} - ${bodyText}`,
          { status: response.status, statusText: response.statusText, endpoint, body: bodyText },
        );
      }
      return response;
    } catch (error) {
      return rejectWithError(
        LuxConnectErrorCode.NETWORK_ERROR,
        `Network error during API request to ${endpoint}`,
        { endpoint },
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  // ---- Event subscription ----

  public onConnectionStateChanged(handler: ConnectionStateHandler): void {
    this.connectionStateHandlers.push(handler);
  }

  public onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public onMessage(handler: (data: any) => void): void {
    this.messageHandlers.push(handler);
  }

  public onUserChanged(handler: (username: string | undefined) => void): () => void {
    this.userChangeHandlers.push(handler);
    return () => {
      const idx = this.userChangeHandlers.indexOf(handler);
      if (idx !== -1) this.userChangeHandlers.splice(idx, 1);
    };
  }

  /**
   * Best-effort DELETE for a subscription this client doesn't own. Used by
   * SubscriptionManager to clean up orphans left over from a previous page load.
   */
  public async deleteServerSubscription(subscriptionId: number): Promise<void> {
    if (!this.sessionInfo) return;
    const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}/subscriptions/${subscriptionId}`;
    try {
      await this.fetchWithCookies(url, { method: 'DELETE', credentials: 'include' });
    } catch (error) {
      this.log.warn(`Failed to delete subscription ${subscriptionId}:`, error);
    }
  }

  // ============================================================
  // Internal — connection pipeline
  // ============================================================

  /**
   * Single source of truth for getting (and keeping) the connection healthy.
   *
   * Steps:
   *  1. Test server reachability (HTTP).
   *  2. Restore a persisted session if available; validate it. If invalid, drop it.
   *  3. If no session, create a new one.
   *  4. Start session keep-alive.
   *  5. Connect WebSocket if enabled.
   *
   * Used by `connect()`, `reconnect()`, and `scheduleReconnect()`.
   */
  private async ensureConnected(): Promise<void> {
    this.setState(ConnectionState.CONNECTING);

    await this.testServerReachable();

    // 1. Try to restore an existing session.
    let sessionRestored = false;
    if (!this.sessionInfo) {
      const persisted = this.sessionStore?.load() ?? null;
      if (persisted) {
        this.sessionInfo = persisted.sessionInfo;
        this.cookies.clear();
        for (const [k, v] of persisted.cookies) this.cookies.set(k, v);
        try {
          sessionRestored = await this.validateSession();
        } catch (e) {
          this.log.warn('Session validation threw, will create new session:', e);
          sessionRestored = false;
        }
        if (!sessionRestored) {
          this.sessionStore?.clear();
          this.sessionInfo = null;
          this.cookies.clear();
        }
      }
    } else {
      // Already have a session in memory (e.g. from a WS-only reconnect path).
      sessionRestored = await this.validateSession().catch(() => false);
      if (!sessionRestored) {
        this.sessionInfo = null;
      }
    }

    // 2. Create new session if needed.
    if (!this.sessionInfo) {
      await this.createSession();
      this.persistSession();
    }

    // 3. Keep-alive + WebSocket.
    this.startSessionKeepAlive();
    if (this.config.enableWebSocket) {
      await this.connectWebSocket();
    }

    this.fireUserChanged(this.sessionInfo?.username);
    this.setState(ConnectionState.CONNECTED);
  }

  private async doDisconnect(): Promise<void> {
    this.retryEnabled = false;
    this.setState(ConnectionState.DISCONNECTING);

    this.stopSessionKeepAlive();
    this.cancelReconnectTimer();
    this.webSocketManager.close();

    if (this.sessionInfo) {
      try { await this.deleteSession(); }
      catch (e) { this.log.warn('Session cleanup error (non-fatal):', e); }
    }

    this.sessionInfo = null;
    this.sessionStore?.clear();
    this.setState(ConnectionState.DISCONNECTED);
    this.pendingDisconnect = null;
  }

  /**
   * Schedule a background reconnection attempt. Idempotent: if a timer is
   * already pending, this is a no-op.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      this.log.debug('Reconnect already scheduled, skipping duplicate request');
      return;
    }
    if (!this.retryEnabled || this.connectionState === ConnectionState.DISCONNECTING) {
      this.log.debug(`Skipping reconnect (retryEnabled=${this.retryEnabled}, state=${this.connectionState})`);
      return;
    }

    this.log.info(`Scheduling reconnect in ${RECONNECT_BACKOFF_MS}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.retryEnabled) return;

      try {
        this.setState(ConnectionState.RECONNECTING);
        // Stop any keep-alive that might still be running from the prior session.
        this.stopSessionKeepAlive();
        this.webSocketManager.close();
        await this.ensureConnected();
        this.log.info('Reconnect succeeded');
      } catch (error) {
        this.log.error('Reconnect failed:', error);
        this.handleError(error as Error);
        if (this.retryEnabled) this.scheduleReconnect();
      }
    }, RECONNECT_BACKOFF_MS);
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ============================================================
  // Session lifecycle (HTTP)
  // ============================================================

  /**
   * Create an OPC UA session. Performs the optional auth handshake when
   * `username` is set, then POSTs `/opcua/sessions`. On a 403, retries once
   * without `userIdentityToken` (server-side anonymous mode).
   */
  private async createSession(): Promise<void> {
    const authData = await this.authenticate(this.config.username, this.config.password);
    const sessionRequest: SessionRequest = {
      url: this.config.endpointUrl || `opc.tcp://127.0.0.1:4840`,
      timeout: this.config.sessionTimeout || DEFAULT_SESSION_TIMEOUT_MS,
    };
    if (this.config.username) {
      sessionRequest.userIdentityToken = {
        username: this.config.username,
        password: this.config.password || '',
      };
    }

    const sessionUrl = `${this.baseUrl}/opcua/sessions`;
    this.log.info(`Creating OPC UA session: ${sessionUrl}`);

    let response = await this.fetchWithCookies(sessionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      mode: 'cors',
      body: JSON.stringify(sessionRequest),
    });

    let usedAnonymousFallback = false;
    if (!response.ok && response.status === 403 && sessionRequest.userIdentityToken) {
      // Some configurations only accept anonymous OPC UA sessions even when
      // the HTTP layer is authenticated. Retry without userIdentityToken.
      this.log.warn('Session POST returned 403; retrying as anonymous OPC UA session');
      const anonRequest = { url: sessionRequest.url, timeout: sessionRequest.timeout };
      response = await this.fetchWithCookies(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        mode: 'cors',
        body: JSON.stringify(anonRequest),
      });
      usedAnonymousFallback = true;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw this.categorizeConnectionError(
        new Error(`OPC UA session creation failed: ${response.status} ${response.statusText} - ${errorText}`),
        sessionUrl,
      );
    }

    const data = await response.json();
    this.sessionInfo = {
      sessionId: data.id,
      sessionTimeout: data.timeout || DEFAULT_SESSION_TIMEOUT_MS,
      maxRequestMessageSize: data.maxRequestMessageSize || DEFAULT_MAX_MESSAGE_SIZE,
      maxResponseMessageSize: data.maxResponseMessageSize || DEFAULT_MAX_MESSAGE_SIZE,
      endpointUrl: data.url || sessionRequest.url,
      username: usedAnonymousFallback ? (authData?.username ?? 'anonymous') : (authData?.username ?? this.config.username ?? 'anonymous'),
      roles: authData?.roles ?? [],
    };
    this.log.info('OPC UA session created', {
      sessionId: this.sessionInfo.sessionId,
      username: this.sessionInfo.username,
      anonymousFallback: usedAnonymousFallback,
    });
  }

  /**
   * Authenticate against `/auth`. Returns the auth response body or `null`
   * for anonymous access (when no username is configured and `/auth` is
   * skipped). Throws on auth failure.
   */
  private async authenticate(
    username?: string,
    password?: string,
  ): Promise<{ username?: string; roles?: string[] } | null> {
    const authUrl = `${this.baseUrl}/auth`;
    this.log.info(`mapp Connect authentication: ${authUrl}`);

    const options: RequestInit = {
      method: 'GET',
      credentials: 'include',
      mode: 'cors',
    };
    if (username) {
      const credentials = btoa(`${username}:${password || ''}`);
      options.headers = { 'Authorization': `Basic ${credentials}` };
    }

    try {
      const response = await this.fetchWithCookies(authUrl, options);
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        // For anonymous (no username) access, a non-OK /auth is not necessarily
        // fatal — some servers only accept direct session creation. Keep going
        // and let the session POST decide.
        if (!username) {
          this.log.debug(`/auth returned ${response.status} for anonymous access; continuing`);
          return null;
        }
        throw new Error(`auth failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const data = await response.json();
      this.log.debug('mapp Connect authentication successful', data);
      return data;
    } catch (error) {
      if (!username) {
        this.log.debug('/auth threw for anonymous access; continuing without auth data');
        return null;
      }
      throw this.categorizeConnectionError(error as Error, authUrl);
    }
  }

  /** Validate that the current `sessionInfo` is still usable on the server. */
  private async validateSession(): Promise<boolean> {
    if (!this.sessionInfo) return false;
    const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
    this.log.debug('Validating session:', this.sessionInfo.sessionId);
    const response = await this.fetchWithCookies(url, { method: 'GET', credentials: 'include' });
    if (!response.ok) {
      this.log.debug(`Session validation failed: HTTP ${response.status}`);
      return false;
    }
    return true;
  }

  /** Best-effort DELETE for the current session. */
  private async deleteSession(): Promise<void> {
    if (!this.sessionInfo) return;
    const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
    this.log.debug(`Deleting session at: ${url}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SESSION_DELETE_TIMEOUT_MS);
    try {
      const response = await this.fetchWithCookies(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.sessionInfo.sessionId}` },
        signal: controller.signal,
      });
      // 404 means the server already cleaned it up.
      if (!response.ok && response.status !== 404) {
        this.log.warn(`deleteSession returned ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Same as deleteSession, but never throws. */
  private async bestEffortDeleteSession(): Promise<void> {
    try { await this.deleteSession(); } catch (e) { this.log.debug('best-effort deleteSession ignored:', e); }
  }

  private persistSession(): void {
    if (!this.sessionStore || !this.sessionInfo) return;
    this.sessionStore.save({
      sessionInfo: this.sessionInfo,
      cookies: Array.from(this.cookies.entries()),
    });
  }

  // ============================================================
  // Keep-alive
  // ============================================================

  /**
   * Start the session keep-alive loop. Self-rescheduling `setTimeout`
   * (not `setInterval`) so only one request is ever in flight. Each request
   * is bounded by an abortable timeout. Any non-2xx or transport error
   * triggers `scheduleReconnect()`.
   */
  private startSessionKeepAlive(): void {
    this.stopSessionKeepAlive();
    const interval = this.config.keepAliveInterval ?? DEFAULT_KEEP_ALIVE_INTERVAL_MS;
    const requestTimeoutMs = Math.max(
      KEEP_ALIVE_REQUEST_TIMEOUT_MIN_MS,
      Math.min(interval - 1_000, KEEP_ALIVE_REQUEST_TIMEOUT_MAX_MS),
    );

    const tick = async (): Promise<void> => {
      if (!this.retryEnabled || !this.sessionInfo) return;
      if (this.keepAliveInFlight) {
        this.scheduleNextKeepAlive(interval, tick);
        return;
      }
      this.keepAliveInFlight = true;
      const abort = new AbortController();
      this.keepAliveAbort = abort;
      const timer = setTimeout(() => abort.abort(), requestTimeoutMs);

      let failureReason: string | null = null;
      try {
        const url = `${this.baseUrl}/opcua/sessions/${this.sessionInfo.sessionId}`;
        const response = await this.fetchWithCookies(url, {
          method: 'HEAD',
          headers: { 'Authorization': `Bearer ${this.sessionInfo.sessionId}` },
          signal: abort.signal,
        });
        if (!response.ok) {
          failureReason = `HTTP ${response.status} ${response.statusText}`;
        }
      } catch (error) {
        failureReason = (error as Error)?.name === 'AbortError'
          ? `request timed out after ${requestTimeoutMs}ms`
          : ((error as Error)?.message ?? String(error));
      } finally {
        clearTimeout(timer);
        this.keepAliveInFlight = false;
        if (this.keepAliveAbort === abort) this.keepAliveAbort = null;
      }

      if (!this.retryEnabled || !this.sessionInfo) return;

      if (failureReason) {
        this.log.warn(`Session keep-alive failed: ${failureReason} \u2014 triggering reconnect`);
        this.stopSessionKeepAlive();
        this.scheduleReconnect();
        return;
      }
      this.log.debug('Session keep-alive OK');
      this.scheduleNextKeepAlive(interval, tick);
    };

    this.scheduleNextKeepAlive(interval, tick);
  }

  private scheduleNextKeepAlive(interval: number, tick: () => Promise<void>): void {
    if (!this.retryEnabled) return;
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null;
      void tick();
    }, interval);
  }

  private stopSessionKeepAlive(): void {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    if (this.keepAliveAbort) {
      try { this.keepAliveAbort.abort(); } catch { /* ignore */ }
      this.keepAliveAbort = null;
    }
    this.keepAliveInFlight = false;
  }

  // ============================================================
  // WebSocket
  // ============================================================

  private async connectWebSocket(): Promise<void> {
    if (!this.sessionInfo) throw new Error('Cannot connect WebSocket without a session');

    const wsProtocol = this.config.wsProtocol
      ?? (this.config.protocol === 'https' ? 'wss' : 'ws');
    const port = this.config.port || (this.config.protocol === 'https' ? 443 : 80);
    const wsUrl = `${wsProtocol}://${this.config.host}:${port}/api/1.0/pushchannel?sessionid=${this.sessionInfo.sessionId}`;

    this.log.info(`Connecting WebSocket to: ${wsUrl}`);

    const headers: Record<string, string> = {};
    if (!isBrowser && this.cookies.size > 0) {
      headers['Cookie'] = this.getCookieHeader();
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => { if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; } };
      const safeResolve = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
      const safeReject = (e: unknown) => { if (!settled) { settled = true; cleanup(); reject(e); } };

      this.webSocketManager.create(wsUrl, Object.keys(headers).length ? headers : undefined)
        .then(() => {
          this.webSocketManager.setupEvents({
            onOpen: () => {
              this.log.info('WebSocket connected');
              safeResolve();
            },
            onError: (error) => {
              this.log.error('WebSocket connection error:', error);
              safeReject(error);
            },
            onClose: (event) => {
              const code = event?.code ?? 'unknown';
              const reason = event?.reason ?? 'No reason provided';
              this.log.info(`WebSocket disconnected — code: ${code}, reason: ${reason}`);
              // Any unexpected close while we should be connected triggers a reconnect.
              if (this.isConnected) this.scheduleReconnect();
            },
            onMessage: (data) => this.handleWebSocketMessage(data),
          });

          timeoutHandle = setTimeout(() => {
            if (this.webSocketManager.readyState !== 1) {
              safeReject(new Error('WebSocket connection timeout'));
            }
          }, WEBSOCKET_CONNECT_TIMEOUT_MS);
        })
        .catch(safeReject);
    });
  }

  private handleWebSocketMessage(data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch (error) {
      this.log.error('WebSocket message parse error:', error);
      return;
    }
    for (const handler of this.messageHandlers) {
      try { handler(message); } catch (e) { this.log.error('Message handler error:', e); }
    }
  }

  // ============================================================
  // HTTP / cookie helpers
  // ============================================================

  private async testServerReachable(): Promise<void> {
    const testUrl = `${this.baseUrl}/auth`;
    this.log.debug(`Testing endpoint: ${testUrl}`);
    try {
      const response = await this.fetchWithCookies(testUrl, {
        method: 'GET', mode: 'cors', cache: 'no-cache',
      });
      // 200 OK, 401 Unauthorized, and 405 Method Not Allowed all mean the
      // server is reachable.
      if (response.ok || response.status === 401 || response.status === 405) return;
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Server reachability test failed: ${message}`);
      if (this.config.protocol === 'https' && message.toLowerCase().includes('failed to fetch')) {
        throw new Error(
          `Certificate/SSL Error: Unable to connect to HTTPS server at ${this.baseUrl}. ` +
          `Likely an untrusted certificate. Please open ${this.baseUrl} in your browser and ` +
          `accept the security certificate, then try again.\nOriginal error: ${message}`,
        );
      }
      throw this.categorizeConnectionError(error as Error, testUrl);
    }
  }

  private categorizeConnectionError(error: Error, url: string): Error {
    const msg = error.message.toLowerCase();
    if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls') ||
        msg.includes('authority') || msg.includes('net::err_cert') ||
        msg.includes('sec_error') || msg.includes('insecure')) {
      return new Error(
        `Certificate/Authority Error: ${error.message}\n` +
        `Open ${this.baseUrl} in a browser, accept the certificate warning, then retry.`,
      );
    }
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network')) {
      return new Error(
        `Network Error: ${error.message}\n` +
        `Cannot reach the server at ${url}. Check that the server is running, the URL/port are correct, and firewalls allow the connection.`,
      );
    }
    if (msg.includes('cors')) {
      return new Error(
        `CORS Error: ${error.message}\n` +
        `The server needs to allow requests from this origin.`,
      );
    }
    return new Error(`Connection error for ${url}: ${error.message}`);
  }

  private extractCookies(response: Response): void {
    if (isBrowser) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const headers = response.headers as any;
      const setCookieHeaders: string[] = headers.getSetCookie
        ? headers.getSetCookie()
        : ([response.headers.get('set-cookie')].filter(Boolean) as string[]);
      for (const cookieString of setCookieHeaders) {
        const [nameValue] = cookieString.split(';');
        const [name, value] = nameValue.split('=');
        if (name && value) {
          this.cookies.set(name.trim(), value.trim());
          this.log.debug(`Cookie stored: ${name.trim()}=${value.trim()}`);
        }
      }
    } catch (error) {
      this.log.warn('Cookie extraction error:', error);
    }
  }

  private getCookieHeader(): string {
    if (isBrowser || this.cookies.size === 0) return '';
    const pairs: string[] = [];
    this.cookies.forEach((value, name) => pairs.push(`${name}=${value}`));
    return pairs.join('; ');
  }

  /** Cookie-aware fetch (Node only — browsers manage cookies themselves). */
  private async fetchWithCookies(url: string, options: RequestInit = {}): Promise<Response> {
    if (!isBrowser && this.cookies.size > 0) {
      options.headers = { ...options.headers, 'Cookie': this.getCookieHeader() };
    }
    const response = await fetch(url, options);
    if (!isBrowser) this.extractCookies(response);
    return response;
  }

  // ============================================================
  // State / event dispatch
  // ============================================================

  private setState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const handler of this.connectionStateHandlers) {
      try { handler(state); } catch (e) { this.log.error('Connection state handler error:', e); }
    }
  }

  private handleError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try { handler(error); } catch (e) { this.log.error('Error handler error:', e); }
    }
  }

  private fireUserChanged(username: string | undefined): void {
    for (const handler of this.userChangeHandlers) {
      try { handler(username); } catch (e) { this.log.error('User change handler error:', e); }
    }
  }
}
