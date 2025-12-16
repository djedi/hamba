import { Elysia } from "elysia";
import { emailQueries, accountQueries, attachmentQueries, scheduledEmailQueries, contactQueries, db } from "../db";
import { getProvider } from "../services/providers";
import { notifySyncComplete } from "../services/realtime";
import { queueSend, cancelSend, UNDO_WINDOW_SECONDS } from "../services/pending-send";
import {
  scheduleEmail,
  cancelScheduledEmail,
  updateScheduledEmail,
  getScheduledEmails,
  getScheduledEmail,
} from "../services/scheduled-send";
import { addContactFromReceive } from "./contacts";

export const emailRoutes = new Elysia({ prefix: "/emails", detail: { tags: ["Emails"] } })
  .get("/", async ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    const emails = emailQueries.getByAccount.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );

    return emails;
  })

  .get("/:id", ({ params }) => {
    return emailQueries.getById.get(params.id);
  })

  .get("/thread/:threadId", ({ params }) => {
    return emailQueries.getByThread.all(params.threadId);
  })

  .get("/search", ({ query }) => {
    const { q, limit = "50", accountId } = query;

    if (!q) {
      return { error: "Search query required" };
    }

    // Parse search operators from query string
    // Supported: from:, to:, subject:, has:attachment, is:unread, is:starred, before:, after:
    const operators: {
      query?: string;
      from?: string;
      to?: string;
      subject?: string;
      hasAttachment?: boolean;
      isUnread?: boolean;
      isStarred?: boolean;
      before?: number;
      after?: number;
      accountId?: string;
      limit?: number;
    } = {
      limit: parseInt(limit as string),
      accountId: accountId as string | undefined,
    };

    let remainingQuery = q as string;

    // Extract from: operator
    const fromMatch = remainingQuery.match(/from:(\S+)/i);
    if (fromMatch) {
      operators.from = fromMatch[1];
      remainingQuery = remainingQuery.replace(fromMatch[0], "").trim();
    }

    // Extract to: operator
    const toMatch = remainingQuery.match(/to:(\S+)/i);
    if (toMatch) {
      operators.to = toMatch[1];
      remainingQuery = remainingQuery.replace(toMatch[0], "").trim();
    }

    // Extract subject: operator (supports quotes for multi-word)
    const subjectMatch = remainingQuery.match(/subject:(?:"([^"]+)"|(\S+))/i);
    if (subjectMatch) {
      operators.subject = subjectMatch[1] || subjectMatch[2];
      remainingQuery = remainingQuery.replace(subjectMatch[0], "").trim();
    }

    // Extract has:attachment operator
    const hasAttachmentMatch = remainingQuery.match(/has:attachment/i);
    if (hasAttachmentMatch) {
      operators.hasAttachment = true;
      remainingQuery = remainingQuery.replace(hasAttachmentMatch[0], "").trim();
    }

    // Extract is:unread operator
    const isUnreadMatch = remainingQuery.match(/is:unread/i);
    if (isUnreadMatch) {
      operators.isUnread = true;
      remainingQuery = remainingQuery.replace(isUnreadMatch[0], "").trim();
    }

    // Extract is:read operator
    const isReadMatch = remainingQuery.match(/is:read/i);
    if (isReadMatch) {
      operators.isUnread = false;
      remainingQuery = remainingQuery.replace(isReadMatch[0], "").trim();
    }

    // Extract is:starred operator
    const isStarredMatch = remainingQuery.match(/is:starred/i);
    if (isStarredMatch) {
      operators.isStarred = true;
      remainingQuery = remainingQuery.replace(isStarredMatch[0], "").trim();
    }

    // Extract before: operator (YYYY-MM-DD)
    const beforeMatch = remainingQuery.match(/before:(\d{4}-\d{2}-\d{2})/i);
    if (beforeMatch && beforeMatch[1]) {
      const date = new Date(beforeMatch[1]);
      date.setHours(23, 59, 59, 999); // End of day
      operators.before = Math.floor(date.getTime() / 1000);
      remainingQuery = remainingQuery.replace(beforeMatch[0], "").trim();
    }

    // Extract after: operator (YYYY-MM-DD)
    const afterMatch = remainingQuery.match(/after:(\d{4}-\d{2}-\d{2})/i);
    if (afterMatch && afterMatch[1]) {
      const date = new Date(afterMatch[1]);
      date.setHours(0, 0, 0, 0); // Start of day
      operators.after = Math.floor(date.getTime() / 1000);
      remainingQuery = remainingQuery.replace(afterMatch[0], "").trim();
    }

    // If there's remaining text, use it as FTS query
    if (remainingQuery.trim()) {
      operators.query = remainingQuery.trim();
    }

    // If we have any operators, use advanced search
    const hasOperators = operators.from || operators.to || operators.subject ||
      operators.hasAttachment || operators.isUnread !== undefined ||
      operators.isStarred !== undefined || operators.before || operators.after;

    if (hasOperators || !operators.query) {
      return emailQueries.advancedSearch(operators);
    }

    // Fall back to simple FTS search for plain queries
    return emailQueries.search.all(operators.query, parseInt(limit as string));
  })

  .get("/starred", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getStarred.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .get("/sent", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getSent.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .get("/trashed", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getTrashed.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .get("/archived", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getArchived.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .post("/sync/:accountId", async ({ params }) => {
    try {
      const provider = getProvider(params.accountId);
      const result = await provider.sync({ maxMessages: 100 });

      // If auth error, return immediately with needsReauth flag
      if (result.needsReauth) {
        return result;
      }

      // Extract contacts from newly synced emails
      if (result.synced > 0) {
        // Get recent emails and add senders to contacts
        const recentEmails = db
          .prepare(`
            SELECT from_email, from_name, received_at FROM emails
            WHERE account_id = ? AND folder = 'inbox'
            ORDER BY received_at DESC
            LIMIT ?
          `)
          .all(params.accountId, result.synced) as any[];

        for (const email of recentEmails) {
          if (email.from_email) {
            addContactFromReceive(
              params.accountId,
              email.from_email,
              email.from_name,
              email.received_at
            );
          }
        }
      }

      // Notify connected clients of sync completion
      if (result.synced > 0) {
        notifySyncComplete(params.accountId, result.synced);
      }

      return result;
    } catch (error) {
      return { error: String(error), synced: 0, total: 0 };
    }
  })

  .post("/sync-sent/:accountId", async ({ params }) => {
    try {
      const provider = getProvider(params.accountId);
      const result = await provider.syncSent({ maxMessages: 100 });
      return result;
    } catch (error) {
      return { error: String(error), synced: 0, total: 0 };
    }
  })

  .post("/:id/read", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.markRead(params.id);
      emailQueries.markRead.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error marking email as read:", e);
      // Still update local DB for better UX, but return error
      emailQueries.markRead.run(params.id);
      return { success: true, warning: e.message || String(e) };
    }
  })

  .post("/:id/unread", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.markUnread(params.id);
      emailQueries.markUnread.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error marking email as unread:", e);
      emailQueries.markUnread.run(params.id);
      return { success: true, warning: e.message || String(e) };
    }
  })

  .post("/:id/star", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.star(params.id);
      emailQueries.star.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error starring email:", e);
      emailQueries.star.run(params.id);
      return { success: true, warning: e.message || String(e) };
    }
  })

  .post("/:id/unstar", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.unstar(params.id);
      emailQueries.unstar.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error unstarring email:", e);
      emailQueries.unstar.run(params.id);
      return { success: true, warning: e.message || String(e) };
    }
  })

  .post("/:id/archive", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.archive(params.id);
      // Only update local DB after server succeeds
      emailQueries.archive.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error archiving email:", e);
      return { success: false, error: e.message || String(e) };
    }
  })

  .post("/:id/unarchive", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.unarchive(params.id);
      // Only update local DB after server succeeds
      emailQueries.unarchive.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error unarchiving email:", e);
      return { success: false, error: e.message || String(e) };
    }
  })

  .post("/:id/trash", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.trash(params.id);
      // Only update local DB after server succeeds
      emailQueries.trash.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error trashing email:", e);
      return { success: false, error: e.message || String(e) };
    }
  })

  .post("/:id/untrash", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.untrash(params.id);
      // Only update local DB after server succeeds
      emailQueries.untrash.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error untrashing email:", e);
      return { success: false, error: e.message || String(e) };
    }
  })

  .delete("/:id/permanent", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    try {
      const provider = getProvider(email.account_id);
      await provider.permanentDelete(params.id);
      // Only delete from local DB after server succeeds
      emailQueries.delete.run(params.id);
      return { success: true };
    } catch (e: any) {
      console.error("Error permanently deleting email:", e);
      return { success: false, error: e.message || String(e) };
    }
  })

  .get("/:id/attachment/:contentId", ({ params, set }) => {
    const { id, contentId } = params;

    const attachment = attachmentQueries.getByContentId.get(id, contentId) as any;

    if (!attachment) {
      set.status = 404;
      return { error: "Attachment not found" };
    }

    // Return binary data with correct content type
    set.headers["Content-Type"] = attachment.mime_type;
    set.headers["Content-Disposition"] = `inline; filename="${attachment.filename}"`;
    set.headers["Cache-Control"] = "public, max-age=31536000"; // Cache for 1 year

    return new Response(attachment.data, {
      headers: {
        "Content-Type": attachment.mime_type,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  })

  .post("/send", async ({ body }) => {
    const { accountId, to, cc, bcc, subject, body: emailBody, replyToId, attachments } = body as {
      accountId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
      attachments?: Array<{
        filename: string;
        mimeType: string;
        content: string; // base64 encoded
      }>;
    };

    if (!accountId || !to || !subject) {
      return { error: "accountId, to, and subject are required" };
    }

    const account = accountQueries.getById.get(accountId) as any;
    if (!account) {
      return { error: "Account not found" };
    }

    try {
      const provider = getProvider(accountId);

      // Get reply headers if this is a reply
      let inReplyTo: string | undefined;
      let references: string | undefined;
      let threadId: string | undefined;

      if (replyToId) {
        const originalEmail = emailQueries.getById.get(replyToId) as any;
        if (originalEmail) {
          inReplyTo = originalEmail.message_id;
          references = originalEmail.message_id;
          threadId = originalEmail.thread_id;
        }
      }

      const result = await provider.send({
        from: `${account.name || account.email} <${account.email}>`,
        to,
        cc,
        bcc,
        subject,
        body: emailBody,
        inReplyTo,
        references,
        threadId,
        attachments: attachments?.map((att) => ({
          filename: att.filename,
          mimeType: att.mimeType,
          content: att.content, // base64 string, will be converted to Buffer in providers
        })),
      });

      return result;
    } catch (error) {
      return { error: String(error), success: false };
    }
  })

  .get("/snoozed", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getSnoozed.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .post("/:id/snooze", async ({ params, body }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    const { snoozedUntil } = body as { snoozedUntil: number };
    if (!snoozedUntil || typeof snoozedUntil !== "number") {
      return { success: false, error: "snoozedUntil timestamp required" };
    }

    emailQueries.snooze.run(snoozedUntil, params.id);
    return { success: true };
  })

  .post("/:id/unsnooze", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    emailQueries.unsnooze.run(params.id);
    return { success: true };
  })

  .get("/reminders", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getReminders.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .post("/:id/reminder", async ({ params, body }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    const { remindAt } = body as { remindAt: number };
    if (!remindAt || typeof remindAt !== "number") {
      return { success: false, error: "remindAt timestamp required" };
    }

    emailQueries.setReminder.run(remindAt, params.id);
    return { success: true };
  })

  .delete("/:id/reminder", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    emailQueries.clearReminder.run(params.id);
    return { success: true };
  })

  // Queue send with undo support
  .post("/queue-send", async ({ body }) => {
    const { accountId, to, cc, bcc, subject, body: emailBody, replyToId, attachments } = body as {
      accountId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
      attachments?: Array<{
        filename: string;
        mimeType: string;
        content: string;
      }>;
    };

    if (!accountId || !to || !subject) {
      return { error: "accountId, to, and subject are required", success: false };
    }

    const result = queueSend({
      accountId,
      to,
      cc,
      bcc,
      subject,
      body: emailBody,
      replyToId,
      attachments,
    });

    if (result.success) {
      return {
        success: true,
        pendingId: result.pendingId,
        sendAt: result.sendAt,
        undoWindowSeconds: UNDO_WINDOW_SECONDS,
      };
    } else {
      return { success: false, error: result.error };
    }
  })

  // Cancel a pending send (undo)
  .delete("/pending/:pendingId", async ({ params }) => {
    const result = cancelSend(params.pendingId);
    return result;
  })

  // Scheduled emails (send later)
  .get("/scheduled", ({ query }) => {
    const { accountId } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return getScheduledEmails(accountId as string);
  })

  .get("/scheduled/:id", ({ params }) => {
    const scheduled = getScheduledEmail(params.id);
    if (!scheduled) {
      return { error: "Scheduled email not found" };
    }
    return scheduled;
  })

  .post("/schedule", async ({ body }) => {
    const { accountId, to, cc, bcc, subject, body: emailBody, replyToId, attachments, sendAt } = body as {
      accountId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
      attachments?: Array<{
        filename: string;
        mimeType: string;
        content: string;
      }>;
      sendAt: number;
    };

    if (!accountId || !to || !subject) {
      return { error: "accountId, to, and subject are required", success: false };
    }

    if (!sendAt || typeof sendAt !== "number") {
      return { error: "sendAt timestamp required", success: false };
    }

    const result = scheduleEmail({
      accountId,
      to,
      cc,
      bcc,
      subject,
      body: emailBody,
      replyToId,
      attachments,
      sendAt,
    });

    return result;
  })

  .put("/scheduled/:id", async ({ params, body }) => {
    const { to, cc, bcc, subject, body: emailBody, replyToId, attachments, sendAt } = body as {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body?: string;
      replyToId?: string;
      attachments?: Array<{
        filename: string;
        mimeType: string;
        content: string;
      }>;
      sendAt?: number;
    };

    const result = updateScheduledEmail(params.id, {
      to,
      cc,
      bcc,
      subject,
      body: emailBody,
      replyToId,
      attachments,
      sendAt,
    });

    return result;
  })

  .delete("/scheduled/:id", async ({ params }) => {
    const result = cancelScheduledEmail(params.id);
    return result;
  })

  // Batch operations for multi-select
  .post("/batch/archive", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    // Group emails by account_id for efficient provider calls
    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    // Process each account's emails
    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.archive(id);
            emailQueries.archive.run(id);
            results.count++;
          } catch (e: any) {
            results.failed.push(id);
            results.errors.push(e.message || String(e));
          }
        }
      } catch (e: any) {
        results.failed.push(...ids);
        results.errors.push(e.message || String(e));
      }
    }

    results.success = results.failed.length === 0;
    return results;
  })

  .post("/batch/trash", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.trash(id);
            emailQueries.trash.run(id);
            results.count++;
          } catch (e: any) {
            results.failed.push(id);
            results.errors.push(e.message || String(e));
          }
        }
      } catch (e: any) {
        results.failed.push(...ids);
        results.errors.push(e.message || String(e));
      }
    }

    results.success = results.failed.length === 0;
    return results;
  })

  .post("/batch/star", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.star(id);
            emailQueries.star.run(id);
            results.count++;
          } catch (e: any) {
            results.failed.push(id);
            results.errors.push(e.message || String(e));
          }
        }
      } catch (e: any) {
        results.failed.push(...ids);
        results.errors.push(e.message || String(e));
      }
    }

    results.success = results.failed.length === 0;
    return results;
  })

  .post("/batch/unstar", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.unstar(id);
            emailQueries.unstar.run(id);
            results.count++;
          } catch (e: any) {
            results.failed.push(id);
            results.errors.push(e.message || String(e));
          }
        }
      } catch (e: any) {
        results.failed.push(...ids);
        results.errors.push(e.message || String(e));
      }
    }

    results.success = results.failed.length === 0;
    return results;
  })

  .post("/batch/read", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.markRead(id);
            emailQueries.markRead.run(id);
            results.count++;
          } catch (e: any) {
            // Still update local DB for better UX
            emailQueries.markRead.run(id);
            results.count++;
          }
        }
      } catch (e: any) {
        // For read status, we still update locally even if provider fails
        for (const id of ids) {
          emailQueries.markRead.run(id);
          results.count++;
        }
      }
    }

    results.success = true;
    return results;
  })

  .post("/batch/unread", async ({ body }) => {
    const { emailIds } = body as { emailIds: string[] };

    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return { success: false, error: "emailIds array required" };
    }

    if (emailIds.length > 100) {
      return { success: false, error: "Maximum 100 emails per batch" };
    }

    const results = { success: true, count: 0, failed: [] as string[], errors: [] as string[] };

    const emailsByAccount = new Map<string, string[]>();
    for (const emailId of emailIds) {
      const email = emailQueries.getById.get(emailId) as any;
      if (email) {
        const list = emailsByAccount.get(email.account_id) || [];
        list.push(emailId);
        emailsByAccount.set(email.account_id, list);
      }
    }

    for (const [accountId, ids] of emailsByAccount) {
      try {
        const provider = getProvider(accountId);
        for (const id of ids) {
          try {
            await provider.markUnread(id);
            emailQueries.markUnread.run(id);
            results.count++;
          } catch (e: any) {
            // Still update local DB for better UX
            emailQueries.markUnread.run(id);
            results.count++;
          }
        }
      } catch (e: any) {
        // For read status, we still update locally even if provider fails
        for (const id of ids) {
          emailQueries.markUnread.run(id);
          results.count++;
        }
      }
    }

    results.success = true;
    return results;
  });
