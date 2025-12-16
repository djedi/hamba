import { scheduledEmailQueries, emailQueries, accountQueries } from "../db";
import { getProvider } from "./providers";
import { addContactFromSend } from "../routes/contacts";

interface ScheduledEmail {
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

export interface ScheduleEmailParams {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyToId?: string;
  attachments?: Attachment[];
  sendAt: number; // Unix timestamp
}

export interface ScheduleEmailResult {
  success: boolean;
  scheduledId?: string;
  sendAt?: number;
  error?: string;
}

export interface CancelScheduledResult {
  success: boolean;
  error?: string;
}

export interface UpdateScheduledResult {
  success: boolean;
  error?: string;
}

// Schedule an email for sending at a specific time
export function scheduleEmail(params: ScheduleEmailParams): ScheduleEmailResult {
  const account = accountQueries.getById.get(params.accountId) as any;
  if (!account) {
    return { success: false, error: "Account not found" };
  }

  // Ensure send_at is in the future
  const now = Math.floor(Date.now() / 1000);
  if (params.sendAt <= now) {
    return { success: false, error: "Scheduled time must be in the future" };
  }

  const id = crypto.randomUUID();

  try {
    scheduledEmailQueries.insert.run(
      id,
      params.accountId,
      params.to,
      params.cc || null,
      params.bcc || null,
      params.subject,
      params.body,
      params.replyToId || null,
      params.attachments ? JSON.stringify(params.attachments) : null,
      params.sendAt
    );

    return { success: true, scheduledId: id, sendAt: params.sendAt };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Cancel a scheduled email
export function cancelScheduledEmail(scheduledId: string): CancelScheduledResult {
  const scheduled = scheduledEmailQueries.getById.get(scheduledId) as ScheduledEmail | undefined;
  if (!scheduled) {
    return { success: false, error: "Scheduled email not found" };
  }

  try {
    scheduledEmailQueries.delete.run(scheduledId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Update a scheduled email
export function updateScheduledEmail(
  scheduledId: string,
  params: Partial<ScheduleEmailParams>
): UpdateScheduledResult {
  const scheduled = scheduledEmailQueries.getById.get(scheduledId) as ScheduledEmail | undefined;
  if (!scheduled) {
    return { success: false, error: "Scheduled email not found" };
  }

  // If updating sendAt, ensure it's in the future
  if (params.sendAt) {
    const now = Math.floor(Date.now() / 1000);
    if (params.sendAt <= now) {
      return { success: false, error: "Scheduled time must be in the future" };
    }
  }

  try {
    scheduledEmailQueries.update.run(
      params.to || scheduled.to_addresses,
      params.cc !== undefined ? (params.cc || null) : scheduled.cc_addresses,
      params.bcc !== undefined ? (params.bcc || null) : scheduled.bcc_addresses,
      params.subject || scheduled.subject,
      params.body || scheduled.body,
      params.replyToId !== undefined ? (params.replyToId || null) : scheduled.reply_to_id,
      params.attachments ? JSON.stringify(params.attachments) : scheduled.attachments,
      params.sendAt || scheduled.send_at,
      scheduledId
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// Get all scheduled emails for an account
export function getScheduledEmails(accountId: string): ScheduledEmail[] {
  return scheduledEmailQueries.getByAccount.all(accountId) as ScheduledEmail[];
}

// Get a single scheduled email
export function getScheduledEmail(scheduledId: string): ScheduledEmail | null {
  return (scheduledEmailQueries.getById.get(scheduledId) as ScheduledEmail) || null;
}

// Process scheduled emails that are ready to send
export async function processScheduledEmails(): Promise<{ sent: number; errors: number }> {
  const readyToSend = scheduledEmailQueries.getReady.all() as ScheduledEmail[];
  let sent = 0;
  let errors = 0;

  for (const scheduled of readyToSend) {
    try {
      const provider = getProvider(scheduled.account_id);
      const account = accountQueries.getById.get(scheduled.account_id) as any;

      if (!account) {
        console.error(`[ScheduledSend] Account ${scheduled.account_id} not found, removing scheduled email ${scheduled.id}`);
        scheduledEmailQueries.delete.run(scheduled.id);
        errors++;
        continue;
      }

      // Parse attachments if present
      let attachments: Attachment[] | undefined;
      if (scheduled.attachments) {
        try {
          attachments = JSON.parse(scheduled.attachments);
        } catch (e) {
          console.error(`[ScheduledSend] Failed to parse attachments for ${scheduled.id}:`, e);
        }
      }

      // Get reply headers if this is a reply
      let inReplyTo: string | undefined;
      let references: string | undefined;
      let threadId: string | undefined;

      if (scheduled.reply_to_id) {
        const originalEmail = emailQueries.getById.get(scheduled.reply_to_id) as any;
        if (originalEmail) {
          inReplyTo = originalEmail.message_id;
          references = originalEmail.message_id;
          threadId = originalEmail.thread_id;
        }
      }

      const result = await provider.send({
        from: `${account.name || account.email} <${account.email}>`,
        to: scheduled.to_addresses,
        cc: scheduled.cc_addresses || undefined,
        bcc: scheduled.bcc_addresses || undefined,
        subject: scheduled.subject,
        body: scheduled.body,
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
        console.log(`[ScheduledSend] Successfully sent scheduled email ${scheduled.id} to ${scheduled.to_addresses}`);
        scheduledEmailQueries.delete.run(scheduled.id);

        // Add recipients to contacts
        addContactFromSend(
          scheduled.account_id,
          scheduled.to_addresses,
          scheduled.cc_addresses || undefined,
          scheduled.bcc_addresses || undefined
        );

        sent++;
      } else {
        console.error(`[ScheduledSend] Failed to send scheduled email ${scheduled.id}: ${result.error}`);
        // Keep in queue for retry? For now, remove to avoid spam
        scheduledEmailQueries.delete.run(scheduled.id);
        errors++;
      }
    } catch (error) {
      console.error(`[ScheduledSend] Error processing scheduled email ${scheduled.id}:`, error);
      scheduledEmailQueries.delete.run(scheduled.id);
      errors++;
    }
  }

  return { sent, errors };
}

// Start the background processor
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduledSendProcessor(): void {
  if (processorInterval) {
    return; // Already running
  }

  // Process every minute for scheduled sends
  processorInterval = setInterval(async () => {
    try {
      const result = await processScheduledEmails();
      if (result.sent > 0 || result.errors > 0) {
        console.log(`[ScheduledSend] Processed: ${result.sent} sent, ${result.errors} errors`);
      }
    } catch (error) {
      console.error("[ScheduledSend] Error in processor:", error);
    }
  }, 60 * 1000); // Check every minute

  console.log("[ScheduledSend] Background processor started");
}

export function stopScheduledSendProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    console.log("[ScheduledSend] Background processor stopped");
  }
}
