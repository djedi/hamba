import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { authRoutes } from "./routes/auth";
import { emailRoutes } from "./routes/emails";
import { draftRoutes } from "./routes/drafts";
import { labelRoutes } from "./routes/labels";
import { snippetRoutes } from "./routes/snippets";
import { contactRoutes } from "./routes/contacts";
import { aiRoutes } from "./routes/ai";
import { signatureRoutes } from "./routes/signatures";
// Database is initialized on import
import "./db";
import { emailQueries } from "./db";
import { addClient, removeClient, subscribeToAccount, notifySyncComplete } from "./services/realtime";
import { startAllIdle, getIdleStatus } from "./services/imap-idle";
import { startPendingSendProcessor } from "./services/pending-send";
import { startScheduledSendProcessor } from "./services/scheduled-send";
import { logger, errorTracking } from "./services/logger";
import { loggingMiddleware, metricsEndpoints } from "./services/logging-middleware";

interface WebSocketData {
  accountIds: Set<string>;
}

const app = new Elysia()
  .use(cors({
    origin: "http://localhost:8878",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }))
  .use(loggingMiddleware)
  .use(swagger({
    documentation: {
      info: {
        title: "Hamba Email API",
        version: "1.0.0",
        description: "API for Hamba - a keyboard-driven email client. Supports Gmail, Microsoft, Yahoo OAuth and IMAP/SMTP providers.",
        contact: {
          name: "Hamba",
        },
      },
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Auth", description: "Authentication and account management" },
        { name: "Emails", description: "Email operations (list, search, actions)" },
        { name: "Drafts", description: "Draft management" },
        { name: "Labels", description: "Label/folder management" },
        { name: "Snippets", description: "Text snippet templates" },
        { name: "Contacts", description: "Contact management" },
        { name: "AI", description: "AI-powered email features" },
        { name: "Signatures", description: "Email signature management" },
        { name: "Realtime", description: "Real-time update status" },
      ],
      components: {
        schemas: {
          Email: {
            type: "object",
            properties: {
              id: { type: "string", description: "Email UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              message_id: { type: "string", description: "Email message ID from provider" },
              thread_id: { type: "string", description: "Thread/conversation ID" },
              from_email: { type: "string", format: "email", description: "Sender email address" },
              from_name: { type: "string", nullable: true, description: "Sender display name" },
              to_addresses: { type: "string", description: "Recipient email addresses (JSON array)" },
              cc_addresses: { type: "string", nullable: true, description: "CC addresses (JSON array)" },
              bcc_addresses: { type: "string", nullable: true, description: "BCC addresses (JSON array)" },
              subject: { type: "string", description: "Email subject" },
              snippet: { type: "string", description: "Preview text snippet" },
              body_text: { type: "string", description: "Plain text body" },
              body_html: { type: "string", description: "HTML body" },
              labels: { type: "string", description: "Labels (JSON array)" },
              folder: { type: "string", description: "Email folder (INBOX, SENT, etc.)" },
              is_read: { type: "integer", enum: [0, 1], description: "Read status" },
              is_starred: { type: "integer", enum: [0, 1], description: "Starred status" },
              is_archived: { type: "integer", enum: [0, 1], description: "Archived status" },
              is_trashed: { type: "integer", enum: [0, 1], description: "Trashed status" },
              is_important: { type: "integer", enum: [0, 1], description: "Important status" },
              received_at: { type: "integer", description: "Unix timestamp (seconds)" },
              snoozed_until: { type: "integer", nullable: true, description: "Snooze expiry timestamp" },
              remind_at: { type: "integer", nullable: true, description: "Reminder timestamp" },
              summary: { type: "string", nullable: true, description: "AI-generated summary" },
              ai_importance_score: { type: "number", nullable: true, description: "AI importance score (0-1)" },
            },
          },
          Account: {
            type: "object",
            properties: {
              id: { type: "string", description: "Account UUID" },
              email: { type: "string", format: "email", description: "Account email address" },
              name: { type: "string", description: "Account display name" },
              display_name: { type: "string", nullable: true, description: "Custom display name" },
              provider_type: { type: "string", enum: ["gmail", "microsoft", "yahoo", "imap"], description: "Email provider type" },
              sync_frequency_seconds: { type: "integer", description: "Sync frequency in seconds" },
              unread_count: { type: "integer", description: "Number of unread emails" },
              tokenStatus: { type: "string", enum: ["valid", "expired", "unknown"], description: "OAuth token status" },
            },
          },
          Draft: {
            type: "object",
            properties: {
              id: { type: "string", description: "Draft UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              remote_id: { type: "string", nullable: true, description: "Remote draft ID from provider" },
              to: { type: "string", description: "Recipient addresses" },
              cc: { type: "string", description: "CC addresses" },
              bcc: { type: "string", description: "BCC addresses" },
              subject: { type: "string", description: "Email subject" },
              body: { type: "string", description: "Email body content" },
              reply_to_id: { type: "string", nullable: true, description: "ID of email being replied to" },
              reply_mode: { type: "string", nullable: true, description: "Reply mode (reply, reply-all, forward)" },
              created_at: { type: "integer", description: "Unix timestamp (seconds)" },
              updated_at: { type: "integer", description: "Unix timestamp (seconds)" },
            },
          },
          Label: {
            type: "object",
            properties: {
              id: { type: "string", description: "Label UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              name: { type: "string", description: "Label name" },
              color: { type: "string", description: "Hex color code (e.g., #6366f1)" },
              type: { type: "string", enum: ["user", "system"], description: "Label type" },
              gmail_label_id: { type: "string", nullable: true, description: "Gmail label ID if synced" },
            },
          },
          Contact: {
            type: "object",
            properties: {
              id: { type: "string", description: "Contact UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              email: { type: "string", format: "email", description: "Contact email" },
              name: { type: "string", nullable: true, description: "Contact name" },
              last_contacted: { type: "integer", description: "Last contact timestamp" },
              contact_count: { type: "integer", description: "Number of interactions" },
              created_at: { type: "integer", description: "Unix timestamp (seconds)" },
            },
          },
          Snippet: {
            type: "object",
            properties: {
              id: { type: "string", description: "Snippet UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              name: { type: "string", description: "Snippet name" },
              shortcut: { type: "string", description: "Trigger shortcut (e.g., ;thanks)" },
              content: { type: "string", description: "Snippet content" },
              created_at: { type: "integer", description: "Unix timestamp (seconds)" },
              updated_at: { type: "integer", description: "Unix timestamp (seconds)" },
            },
          },
          Signature: {
            type: "object",
            properties: {
              id: { type: "string", description: "Signature UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              name: { type: "string", description: "Signature name" },
              content: { type: "string", description: "Signature content" },
              is_html: { type: "integer", enum: [0, 1], description: "Whether content is HTML" },
              is_default: { type: "integer", enum: [0, 1], description: "Whether this is the default signature" },
              created_at: { type: "integer", description: "Unix timestamp (seconds)" },
              updated_at: { type: "integer", description: "Unix timestamp (seconds)" },
            },
          },
          ScheduledEmail: {
            type: "object",
            properties: {
              id: { type: "string", description: "Scheduled email UUID" },
              account_id: { type: "string", description: "Associated account UUID" },
              to: { type: "string", description: "Recipient addresses" },
              cc: { type: "string", nullable: true, description: "CC addresses" },
              bcc: { type: "string", nullable: true, description: "BCC addresses" },
              subject: { type: "string", description: "Email subject" },
              body: { type: "string", description: "Email body content" },
              reply_to_id: { type: "string", nullable: true, description: "ID of email being replied to" },
              attachments: { type: "string", nullable: true, description: "Attachments (JSON)" },
              send_at: { type: "integer", description: "Scheduled send timestamp" },
              created_at: { type: "integer", description: "Unix timestamp (seconds)" },
            },
          },
          Error: {
            type: "object",
            properties: {
              error: { type: "string", description: "Error message" },
            },
          },
          Success: {
            type: "object",
            properties: {
              success: { type: "boolean", description: "Operation success status" },
            },
          },
        },
      },
    },
    path: "/docs",
    exclude: ["/ws"],
  }))
  .get("/health", () => ({ status: "ok" }), {
    detail: {
      tags: ["Health"],
      summary: "Health check",
      description: "Returns the API health status",
      responses: {
        200: {
          description: "API is healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "ok" },
                },
              },
            },
          },
        },
      },
    },
  })
  .use(metricsEndpoints)
  .use(authRoutes)
  .use(emailRoutes)
  .use(draftRoutes)
  .use(labelRoutes)
  .use(snippetRoutes)
  .use(contactRoutes)
  .use(aiRoutes)
  .use(signatureRoutes)
  // WebSocket for real-time updates
  .ws("/ws", {
    open(ws) {
      // Elysia's WebSocket wrapper requires type casting for custom data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ws as any).data = { accountIds: new Set() };
      addClient(ws as unknown as import("bun").ServerWebSocket<WebSocketData>);
    },
    close(ws) {
      removeClient(ws as unknown as import("bun").ServerWebSocket<WebSocketData>);
    },
    message(ws, message) {
      // Handle subscription messages
      try {
        const data = typeof message === "string" ? JSON.parse(message) : message;
        if (data.type === "subscribe" && data.accountId) {
          subscribeToAccount(ws as unknown as import("bun").ServerWebSocket<WebSocketData>, data.accountId);
        }
      } catch (e) {
        // Ignore invalid messages
      }
    },
  })
  // IMAP IDLE status endpoint
  .get("/realtime/status", () => ({
    idle: getIdleStatus(),
  }), {
    detail: {
      tags: ["Realtime"],
      summary: "Get IMAP IDLE status",
      description: "Returns the status of IMAP IDLE connections for real-time email notifications",
      responses: {
        200: {
          description: "IMAP IDLE status",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  idle: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        connected: { type: "boolean" },
                        accountId: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  .listen(8877);

logger.info("Hamba API started", { port: app.server?.port, url: `http://localhost:${app.server?.port}` });

// Start IMAP IDLE connections for all IMAP accounts
startAllIdle().catch((err) => errorTracking.captureException(err, { context: "startAllIdle" }));

// Start pending send processor for undo send feature
startPendingSendProcessor();

// Start scheduled send processor for send later feature
startScheduledSendProcessor();

// Cleanup old trashed emails (30+ days old)
function cleanupOldTrashedEmails() {
  try {
    const result = emailQueries.deleteOldTrashed.run();
    const deleted = result.changes;
    if (deleted > 0) {
      logger.info("Cleaned up old trashed emails", { count: deleted, ageThresholdDays: 30 });
    }
  } catch (error) {
    logger.error("Failed to cleanup old trashed emails", error as Error);
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
      logger.info("Unsnoozed due emails", { count: dueEmails.length });
    }
  } catch (error) {
    logger.error("Failed to unsnooze emails", error as Error);
  }
}

// Run cleanup immediately on startup and then every hour
cleanupOldTrashedEmails();
setInterval(cleanupOldTrashedEmails, 60 * 60 * 1000);

// Check for snoozed emails every minute
unsnoozeDueEmails();
setInterval(unsnoozeDueEmails, 60 * 1000);

export type App = typeof app;
