/**
 * WebSocket Connection Service
 * 
 * Manages a persistent WebSocket connection to the surveillance backend.
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - Event-based message handling
 *   - Connection status tracking
 *
 * Usage:
 *   import { wsService } from '../services/websocket';
 *
 *   // Subscribe to messages
 *   wsService.onMessage((data) => console.log(data));
 *
 *   // Subscribe to connection status changes
 *   wsService.onStatusChange((status) => console.log(status));
 *
 *   // Connect
 *   wsService.connect();
 *
 *   // Send a message
 *   wsService.send({ type: 'ping' });
 *
 *   // Disconnect
 *   wsService.disconnect();
 */

const WS_URL = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
const MAX_RECONNECT_DELAY = 30000;   // 30 seconds
const INITIAL_RECONNECT_DELAY = 1000; // 1 second

class WebSocketService {
  constructor() {
    this._ws = null;
    this._status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected'
    this._reconnectTimer = null;
    this._reconnectDelay = INITIAL_RECONNECT_DELAY;
    this._messageListeners = [];
    this._statusListeners = [];
    this._shouldReconnect = true;
  }

  /* ---- Public API ---- */

  /** Open the WebSocket connection. */
  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return; // already connected or connecting
    }

    this._shouldReconnect = true;
    this._setStatus('connecting');

    try {
      this._ws = new WebSocket(WS_URL);

      this._ws.onopen = () => {
        console.log('[WS] Connected to', WS_URL);
        this._reconnectDelay = INITIAL_RECONNECT_DELAY;
        this._setStatus('connected');
      };

      this._ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._messageListeners.forEach((cb) => cb(data));
        } catch {
          // Non-JSON message — pass raw
          this._messageListeners.forEach((cb) => cb(event.data));
        }
      };

      this._ws.onclose = (event) => {
        console.log(`[WS] Closed (code=${event.code}, reason=${event.reason})`);
        this._setStatus('disconnected');
        this._scheduleReconnect();
      };

      this._ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        // onclose will fire next — reconnect handled there
      };
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      this._setStatus('disconnected');
      this._scheduleReconnect();
    }
  }

  /** Close the WebSocket connection. */
  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectTimer);

    if (this._ws) {
      this._ws.close(1000, 'Client disconnect');
      this._ws = null;
    }

    this._setStatus('disconnected');
  }

  /** Send a JSON-serializable message. */
  send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
      return true;
    }
    console.warn('[WS] Cannot send — not connected');
    return false;
  }

  /** Register a callback for incoming messages. Returns unsubscribe fn. */
  onMessage(callback) {
    this._messageListeners.push(callback);
    return () => {
      this._messageListeners = this._messageListeners.filter((cb) => cb !== callback);
    };
  }

  /** Register a callback for connection status changes. Returns unsubscribe fn. */
  onStatusChange(callback) {
    this._statusListeners.push(callback);
    // Immediately notify current status
    callback(this._status);
    return () => {
      this._statusListeners = this._statusListeners.filter((cb) => cb !== callback);
    };
  }

  /** Get the current connection status. */
  get status() {
    return this._status;
  }

  /* ---- Internal ---- */

  _setStatus(status) {
    if (this._status !== status) {
      this._status = status;
      this._statusListeners.forEach((cb) => cb(status));
    }
  }

  _scheduleReconnect() {
    if (!this._shouldReconnect) return;

    clearTimeout(this._reconnectTimer);
    console.log(`[WS] Reconnecting in ${this._reconnectDelay / 1000}s...`);

    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, this._reconnectDelay);

    // Exponential backoff
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }
}

// Singleton instance
export const wsService = new WebSocketService();
export default wsService;
