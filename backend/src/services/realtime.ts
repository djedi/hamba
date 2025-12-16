/**
 * Real-time notification service
 * Manages WebSocket connections and pushes updates to connected clients
 */

import type { ServerWebSocket } from "bun";
import { logger } from "./logger";

interface WebSocketData {
  accountIds: Set<string>;
}

// Connected WebSocket clients
const clients = new Set<ServerWebSocket<WebSocketData>>();

// Register a new WebSocket client
export function addClient(ws: ServerWebSocket<WebSocketData>) {
  clients.add(ws);
  logger.debug("WebSocket client connected", { totalClients: clients.size });
}

// Remove a WebSocket client
export function removeClient(ws: ServerWebSocket<WebSocketData>) {
  clients.delete(ws);
  logger.debug("WebSocket client disconnected", { totalClients: clients.size });
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

// Notify clients of background sync progress
export function notifyBackgroundSyncProgress(accountId: string, synced: number, total: number) {
  const message = JSON.stringify({
    type: "background_sync_progress",
    accountId,
    synced,
    total,
    percentage: total > 0 ? Math.round((synced / total) * 100) : 0,
  });

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
