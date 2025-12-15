/**
 * IMAP IDLE connection manager
 * Maintains persistent connections to IMAP servers for real-time notifications
 */

import { ImapFlow } from "imapflow";
import { accountQueries } from "../db";
import { notifyNewMail } from "./realtime";
import { getProvider } from "./providers";

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
        console.log(`[IMAP IDLE] New mail for account ${accountId}`);

        // Notify connected clients
        notifyNewMail(accountId);

        // Trigger a quick sync to get the new messages
        try {
          const provider = getProvider(accountId);
          await provider.sync({ maxMessages: 10 });
        } catch (e) {
          console.error(`[IMAP IDLE] Sync error for ${accountId}:`, e);
        }
      }
    });

    // Handle disconnection
    client.on("close", () => {
      console.log(`[IMAP IDLE] Connection closed for ${accountId}`);
      connections.delete(accountId);

      // Attempt to reconnect after 30 seconds
      connection.reconnectTimeout = setTimeout(() => {
        startIdle(accountId).catch(console.error);
      }, 30000);
    });

    client.on("error", (err: Error) => {
      console.error(`[IMAP IDLE] Error for ${accountId}:`, err.message);
    });

    // Start IDLE - this keeps the connection alive waiting for updates
    // ImapFlow handles IDLE automatically when mailbox is open
    console.log(`[IMAP IDLE] Started for account ${accountId}`);
    return true;

  } catch (error) {
    console.error(`[IMAP IDLE] Failed to start for ${accountId}:`, error);
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
    console.log(`[IMAP IDLE] Stopped for account ${accountId}`);
  }
}

// Start IDLE for all IMAP accounts
export async function startAllIdle(): Promise<void> {
  const accounts = accountQueries.getAll.all() as any[];
  const imapAccounts = accounts.filter(a => a.provider_type === "imap");

  console.log(`[IMAP IDLE] Starting IDLE for ${imapAccounts.length} IMAP accounts`);

  for (const account of imapAccounts) {
    await startIdle(account.id).catch(console.error);
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
