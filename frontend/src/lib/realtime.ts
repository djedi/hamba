/**
 * Real-time WebSocket client for live email updates
 */

import { writable, get } from "svelte/store";

type MessageHandler = (data: any) => void;

export type ConnectionState = "connected" | "connecting" | "disconnected" | "reconnecting";

// Connection state store
export const connectionState = writable<ConnectionState>("disconnected");
export const reconnectAttempt = writable<number>(0);

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<MessageHandler>();

// Exponential backoff configuration
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const BACKOFF_MULTIPLIER = 2;
let currentReconnectDelay = INITIAL_RECONNECT_DELAY;

// Subscriptions to re-subscribe after reconnect
const activeSubscriptions = new Set<string>();

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8877/ws";

export function connect(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    return;
  }

  // Update state based on whether this is a fresh connect or reconnect
  const currentState = get(connectionState);
  if (currentState === "disconnected") {
    connectionState.set("connecting");
  } else {
    connectionState.set("reconnecting");
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[Realtime] Connected");
      connectionState.set("connected");
      reconnectAttempt.set(0);
      currentReconnectDelay = INITIAL_RECONNECT_DELAY;

      // Clear reconnect timeout on successful connection
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }

      // Re-subscribe to all active accounts
      activeSubscriptions.forEach(accountId => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "subscribe", accountId }));
        }
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handlers.forEach(handler => handler(data));
      } catch (e) {
        console.error("[Realtime] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      ws = null;
      connectionState.set("disconnected");
      scheduleReconnect();
    };

    ws.onerror = (error) => {
      console.error("[Realtime] WebSocket error:", error);
      // onclose will be called after onerror, so we don't need to handle reconnect here
    };

  } catch (e) {
    console.error("[Realtime] Failed to connect:", e);
    connectionState.set("disconnected");
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  const attempt = get(reconnectAttempt) + 1;
  reconnectAttempt.set(attempt);

  console.log(`[Realtime] Reconnecting in ${currentReconnectDelay / 1000}s... (attempt ${attempt})`);

  reconnectTimeout = setTimeout(() => {
    connect();
  }, currentReconnectDelay);

  // Increase delay for next attempt (exponential backoff)
  currentReconnectDelay = Math.min(currentReconnectDelay * BACKOFF_MULTIPLIER, MAX_RECONNECT_DELAY);
}

export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  connectionState.set("disconnected");
  reconnectAttempt.set(0);
  currentReconnectDelay = INITIAL_RECONNECT_DELAY;
}

export function subscribe(accountId: string): void {
  // Track subscription so we can re-subscribe after reconnect
  activeSubscriptions.add(accountId);

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "subscribe", accountId }));
  }
}

export function unsubscribe(accountId: string): void {
  activeSubscriptions.delete(accountId);
}

/**
 * Manually trigger a reconnection attempt (resets backoff)
 */
export function reconnectNow(): void {
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Reset backoff
  currentReconnectDelay = INITIAL_RECONNECT_DELAY;
  reconnectAttempt.set(0);

  // Close existing connection if any
  if (ws) {
    ws.close();
    ws = null;
  }

  // Connect immediately
  connect();
}

export function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
