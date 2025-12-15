import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { emailRoutes } from "./routes/emails";
import { draftRoutes } from "./routes/drafts";
import { labelRoutes } from "./routes/labels";
// Database is initialized on import
import "./db";
import { emailQueries } from "./db";
import { addClient, removeClient, subscribeToAccount, notifySyncComplete } from "./services/realtime";
import { startAllIdle, getIdleStatus } from "./services/imap-idle";
import { startPendingSendProcessor } from "./services/pending-send";

interface WebSocketData {
  accountIds: Set<string>;
}

const app = new Elysia()
  .use(cors({
    origin: "http://localhost:5173",
    credentials: true,
  }))
  .get("/health", () => ({ status: "ok" }))
  .use(authRoutes)
  .use(emailRoutes)
  .use(draftRoutes)
  .use(labelRoutes)
  // WebSocket for real-time updates
  .ws("/ws", {
    open(ws) {
      ws.data = { accountIds: new Set() };
      addClient(ws as any);
    },
    close(ws) {
      removeClient(ws as any);
    },
    message(ws, message) {
      // Handle subscription messages
      try {
        const data = typeof message === "string" ? JSON.parse(message) : message;
        if (data.type === "subscribe" && data.accountId) {
          subscribeToAccount(ws as any, data.accountId);
        }
      } catch (e) {
        // Ignore invalid messages
      }
    },
  })
  // IMAP IDLE status endpoint
  .get("/realtime/status", () => ({
    idle: getIdleStatus(),
  }))
  .listen(3001);

console.log(`🚀 Hamba API running at http://localhost:${app.server?.port}`);

// Start IMAP IDLE connections for all IMAP accounts
startAllIdle().catch(console.error);

// Start pending send processor for undo send feature
startPendingSendProcessor();

// Cleanup old trashed emails (30+ days old)
function cleanupOldTrashedEmails() {
  try {
    const result = emailQueries.deleteOldTrashed.run();
    const deleted = result.changes;
    if (deleted > 0) {
      console.log(`🗑️ Cleaned up ${deleted} emails from trash (30+ days old)`);
    }
  } catch (error) {
    console.error("Error cleaning up old trashed emails:", error);
  }
}

// Unsnooze emails when their snooze time expires
function unsnoozeDueEmails() {
  try {
    const dueEmails = emailQueries.getDueToUnsnooze.all() as any[];
    for (const email of dueEmails) {
      emailQueries.unsnooze.run(email.id);
      // Notify connected clients about the unsnoozed email
      notifySyncComplete(email.account_id, 1);
    }
    if (dueEmails.length > 0) {
      console.log(`⏰ Unsnoozed ${dueEmails.length} email(s)`);
    }
  } catch (error) {
    console.error("Error unsnoozing emails:", error);
  }
}

// Run cleanup immediately on startup and then every hour
cleanupOldTrashedEmails();
setInterval(cleanupOldTrashedEmails, 60 * 60 * 1000);

// Check for snoozed emails every minute
unsnoozeDueEmails();
setInterval(unsnoozeDueEmails, 60 * 1000);

export type App = typeof app;
