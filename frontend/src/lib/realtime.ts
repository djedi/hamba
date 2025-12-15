/**
 * Real-time WebSocket client for live email updates
 */

type MessageHandler = (data: any) => void;

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<MessageHandler>();

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001/ws";

export function connect(): void {
  if (ws?.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[Realtime] Connected");
      // Clear reconnect timeout on successful connection
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
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
      console.log("[Realtime] Disconnected, reconnecting in 5s...");
      ws = null;
      // Auto-reconnect after 5 seconds
      reconnectTimeout = setTimeout(connect, 5000);
    };

    ws.onerror = (error) => {
      console.error("[Realtime] WebSocket error:", error);
    };

  } catch (e) {
    console.error("[Realtime] Failed to connect:", e);
    // Retry connection after 5 seconds
    reconnectTimeout = setTimeout(connect, 5000);
  }
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
}

export function subscribe(accountId: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "subscribe", accountId }));
  }
}

export function onMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
