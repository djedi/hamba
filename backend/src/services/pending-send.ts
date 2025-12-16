import { pendingSendQueries, emailQueries, accountQueries } from "../db";
import { getProvider } from "./providers";
import { addContactFromSend } from "../routes/contacts";

// Default undo window in seconds
export const UNDO_WINDOW_SECONDS = 5;

interface PendingSend {
  id: string;
  account_id: string;
  to_addresses: string;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  subject: string;
  body: string;
  reply_to_id: string | null;
  attachments: string | null;
  send_at: number;
  created_at: number;
}

interface Attachment {
  filename: string;
  mimeType: string;
  content: string; // base64 encoded
}

export interface QueueSendParams {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyToId?: string;
  attachments?: Attachment[];
}

export interface QueueSendResult {
  success: boolean;
  pendingId?: string;
  sendAt?: number;
  error?: string;
}

export interface CancelSendResult {
  success: boolean;
  error?: string;
}

// Queue an email for sending after the undo window
export function queueSend(params: QueueSendParams): QueueSendResult {
  const account = accountQueries.getById.get(params.accountId) as any;
  if (!account) {
    return { success: false, error: "Account not found" };
  }

  const id = crypto.randomUUID();
  const sendAt = Math.floor(Date.now() / 1000) + UNDO_WINDOW_SECONDS;

  try {
    pendingSendQueries.insert.run(
      id,
      params.accountId,
      params.to,
      params.cc || null,
      params.bcc || null,
      params.subject,
      params.body,
      params.replyToId || null,
      params.attachments ? JSON.stringify(params.attachments) : null,
      sendAt
    );

    return { success: true, pendingId: id, sendAt };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Cancel a pending send (undo)
export function cancelSend(pendingId: string): CancelSendResult {
  const pending = pendingSendQueries.getById.get(pendingId) as PendingSend | undefined;
  if (!pending) {
    return { success: false, error: "Pending send not found" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (pending.send_at <= now) {
    return { success: false, error: "Email already sent" };
  }

  try {
    pendingSendQueries.delete.run(pendingId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Process pending sends that are ready to go
export async function processPendingSends(): Promise<{ sent: number; errors: number }> {
  const readyToSend = pendingSendQueries.getReady.all() as PendingSend[];
  let sent = 0;
  let errors = 0;

  for (const pending of readyToSend) {
    try {
      const provider = getProvider(pending.account_id);
      const account = accountQueries.getById.get(pending.account_id) as any;

      if (!account) {
        console.error(`[PendingSend] Account ${pending.account_id} not found, removing pending send ${pending.id}`);
        pendingSendQueries.delete.run(pending.id);
        errors++;
        continue;
      }

      // Parse attachments if present
      let attachments: Attachment[] | undefined;
      if (pending.attachments) {
        try {
          attachments = JSON.parse(pending.attachments);
        } catch (e) {
          console.error(`[PendingSend] Failed to parse attachments for ${pending.id}:`, e);
        }
      }

      // Get reply headers if this is a reply
      let inReplyTo: string | undefined;
      let references: string | undefined;
      let threadId: string | undefined;

      if (pending.reply_to_id) {
        const originalEmail = emailQueries.getById.get(pending.reply_to_id) as any;
        if (originalEmail) {
          inReplyTo = originalEmail.message_id;
          references = originalEmail.message_id;
          threadId = originalEmail.thread_id;
        }
      }

      const result = await provider.send({
        from: `${account.name || account.email} <${account.email}>`,
        to: pending.to_addresses,
        cc: pending.cc_addresses || undefined,
        bcc: pending.bcc_addresses || undefined,
        subject: pending.subject,
        body: pending.body,
        inReplyTo,
        references,
        threadId,
        attachments: attachments?.map((att) => ({
          filename: att.filename,
          mimeType: att.mimeType,
          content: att.content,
        })),
      });

      if (result.success) {
        console.log(`[PendingSend] Successfully sent email ${pending.id} to ${pending.to_addresses}`);
        pendingSendQueries.delete.run(pending.id);

        // Add recipients to contacts
        addContactFromSend(
          pending.account_id,
          pending.to_addresses,
          pending.cc_addresses || undefined,
          pending.bcc_addresses || undefined
        );

        sent++;
      } else {
        console.error(`[PendingSend] Failed to send email ${pending.id}: ${result.error}`);
        // Keep in queue for retry? For now, remove to avoid spam
        pendingSendQueries.delete.run(pending.id);
        errors++;
      }
    } catch (error) {
      console.error(`[PendingSend] Error processing pending send ${pending.id}:`, error);
      pendingSendQueries.delete.run(pending.id);
      errors++;
    }
  }

  return { sent, errors };
}

// Start the background processor
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startPendingSendProcessor(): void {
  if (processorInterval) {
    return; // Already running
  }

  // Process every second for responsive sending
  processorInterval = setInterval(async () => {
    try {
      const result = await processPendingSends();
      if (result.sent > 0 || result.errors > 0) {
        console.log(`[PendingSend] Processed: ${result.sent} sent, ${result.errors} errors`);
      }
    } catch (error) {
      console.error("[PendingSend] Error in processor:", error);
    }
  }, 1000);

  console.log("[PendingSend] Background processor started");
}

export function stopPendingSendProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log("[PendingSend] Background processor stopped");
  }
}
