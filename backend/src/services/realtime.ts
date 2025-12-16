/**
 * Real-time notification service
 * Manages WebSocket connections and pushes updates to connected clients
 */

import { ServerWebSocket } from "bun";

interface WebSocketData {
  accountIds: Set<string>;
}

// Connected WebSocket clients
const clients = new Set<ServerWebSocket<WebSocketData>>();

// Register a new WebSocket client
export function addClient(ws: ServerWebSocket<WebSocketData>) {
  clients.add(ws);
  console.log(`WebSocket client connected. Total: ${clients.size}`);
}

// Remove a WebSocket client
export function removeClient(ws: ServerWebSocket<WebSocketData>) {
  clients.delete(ws);
  console.log(`WebSocket client disconnected. Total: ${clients.size}`);
}

// Subscribe a client to account updates
export function subscribeToAccount(ws: ServerWebSocket<WebSocketData>, accountId: string) {
  ws.data.accountIds.add(accountId);
}

// Notify all clients watching an account that new mail arrived
export function notifyNewMail(
  accountId: string,
  emailInfo?: { from: string; subject: string; isImportant: boolean }
) {
  const message = JSON.stringify({
    type: "new_mail",
    accountId,
    email: emailInfo,
  });

  for (const client of clients) {
    if (client.data.accountIds.has(accountId) || client.data.accountIds.size === 0) {
      try {
        client.send(message);
      } catch (e) {
        // Client disconnected, remove it
        clients.delete(client);
      }
    }
  }
}

// Notify clients of sync completion
export function notifySyncComplete(accountId: string, count: number) {
  const message = JSON.stringify({ type: "sync_complete", accountId, count });

  for (const client of clients) {
    if (client.data.accountIds.has(accountId) || client.data.accountIds.size === 0) {
      try {
        client.send(message);
      } catch (e) {
        clients.delete(client);
      }
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
