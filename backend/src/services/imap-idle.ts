/**
 * IMAP IDLE connection manager
 * Maintains persistent connections to IMAP servers for real-time notifications
 */

import { ImapFlow } from "imapflow";
import { accountQueries, emailQueries } from "../db";
import { notifyNewMail } from "./realtime";
import { getProvider } from "./providers";
import { logger, errorTracking } from "./logger";

const imapLogger = logger.child({ service: "imap-idle" });

interface IdleConnection {
  client: ImapFlow;
  accountId: string;
  reconnectTimeout?: ReturnType<typeof setTimeout>;
}

const connections = new Map<string, IdleConnection>();

// Start IDLE for an IMAP account
export async function startIdle(accountId: string): Promise<boolean> {
  // Don't start if already connected
  if (connections.has(accountId)) {
    return true;
  }

  const account = accountQueries.getById.get(accountId) as any;
  if (!account || account.provider_type !== "imap") {
    return false;
  }

  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: !!account.imap_use_tls,
    auth: {
      user: account.username || account.email,
      pass: account.password,
    },
    logger: false,
  });

  try {
    await client.connect();

    // Select INBOX for IDLE
    await client.mailboxOpen("INBOX");

    const connection: IdleConnection = { client, accountId };
    connections.set(accountId, connection);

    // Listen for new mail
    client.on("exists", async (data: { count: number; prevCount: number }) => {
      if (data.count > data.prevCount) {
        imapLogger.info("New mail detected", { accountId, newCount: data.count, prevCount: data.prevCount });

        // Trigger a quick sync to get the new messages
        try {
          const provider = getProvider(accountId);
          await provider.sync({ maxMessages: 10 });

          // Get the latest email to include in notification
          const latestEmail = emailQueries.getLatest.get(accountId) as {
            from_name: string | null;
            from_email: string;
            subject: string | null;
            is_important: number;
          } | null;

          // Notify connected clients with email details
          notifyNewMail(
            accountId,
            latestEmail
              ? {
                  from: latestEmail.from_name || latestEmail.from_email,
                  subject: latestEmail.subject || "(no subject)",
                  isImportant: !!latestEmail.is_important,
                }
              : undefined
          );
        } catch (e) {
          imapLogger.error("Sync error after new mail detection", e as Error, { accountId });
          // Still notify even if sync fails
          notifyNewMail(accountId);
        }
      }
    });

    // Handle disconnection
    client.on("close", () => {
      imapLogger.info("Connection closed", { accountId });
      connections.delete(accountId);

      // Attempt to reconnect after 30 seconds
      connection.reconnectTimeout = setTimeout(() => {
        startIdle(accountId).catch((err) => errorTracking.captureException(err, { accountId, context: "idle-reconnect" }));
      }, 30000);
    });

    client.on("error", (err: Error) => {
      imapLogger.error("Connection error", err, { accountId });
    });

    // Start IDLE - this keeps the connection alive waiting for updates
    // ImapFlow handles IDLE automatically when mailbox is open
    imapLogger.info("IDLE started", { accountId });
    return true;

  } catch (error) {
    imapLogger.error("Failed to start IDLE", error as Error, { accountId });
    return false;
  }
}

// Stop IDLE for an account
export async function stopIdle(accountId: string): Promise<void> {
  const connection = connections.get(accountId);
  if (connection) {
    if (connection.reconnectTimeout) {
      clearTimeout(connection.reconnectTimeout);
    }
    try {
      await connection.client.logout();
    } catch (e) {
      // Ignore logout errors
    }
    connections.delete(accountId);
    imapLogger.info("IDLE stopped", { accountId });
  }
}

// Start IDLE for all IMAP accounts
export async function startAllIdle(): Promise<void> {
  const accounts = accountQueries.getAll.all() as any[];
  const imapAccounts = accounts.filter(a => a.provider_type === "imap");

  imapLogger.info("Starting IDLE for IMAP accounts", { count: imapAccounts.length });

  for (const account of imapAccounts) {
    await startIdle(account.id).catch((err) => errorTracking.captureException(err, { accountId: account.id, context: "startAllIdle" }));
  }
}

// Stop all IDLE connections
export async function stopAllIdle(): Promise<void> {
  for (const [accountId] of connections) {
    await stopIdle(accountId);
  }
}

// Get status of IDLE connections
export function getIdleStatus(): { accountId: string; connected: boolean }[] {
  const accounts = accountQueries.getAll.all() as any[];
  const imapAccounts = accounts.filter(a => a.provider_type === "imap");

  return imapAccounts.map(a => ({
    accountId: a.id,
    connected: connections.has(a.id),
  }));
}
