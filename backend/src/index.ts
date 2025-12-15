import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth";
import { emailRoutes } from "./routes/emails";
// Database is initialized on import
import "./db";
import { addClient, removeClient, subscribeToAccount } from "./services/realtime";
import { startAllIdle, getIdleStatus } from "./services/imap-idle";

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

export type App = typeof app;
