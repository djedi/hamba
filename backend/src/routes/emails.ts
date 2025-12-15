import { Elysia } from "elysia";
import { emailQueries, accountQueries, attachmentQueries } from "../db";
import { getProvider } from "../services/providers";
import { notifySyncComplete } from "../services/realtime";
import { classifyAndUpdateEmail, classifyAllEmails } from "../services/importance";

export const emailRoutes = new Elysia({ prefix: "/emails" })
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
    const { q, limit = "50" } = query;

    if (!q) {
      return { error: "Search query required" };
    }

    return emailQueries.search.all(q, parseInt(limit as string));
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

  .get("/important", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getImportant.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .get("/other", ({ query }) => {
    const { accountId, limit = "50", offset = "0" } = query;

    if (!accountId) {
      return { error: "accountId required" };
    }

    return emailQueries.getOther.all(
      accountId,
      parseInt(limit as string),
      parseInt(offset as string)
    );
  })

  .post("/sync/:accountId", async ({ params }) => {
    try {
      const provider = getProvider(params.accountId);
      const result = await provider.sync({ maxMessages: 100 });

      // Classify emails for importance after sync
      if (result.synced > 0) {
        classifyAllEmails(params.accountId);
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
    const { accountId, to, cc, bcc, subject, body: emailBody, replyToId } = body as {
      accountId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      replyToId?: string;
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
      });

      return result;
    } catch (error) {
      return { error: String(error), success: false };
    }
  })

  .post("/classify/:accountId", async ({ params }) => {
    try {
      const classified = classifyAllEmails(params.accountId);
      return { success: true, classified };
    } catch (error) {
      return { success: false, error: String(error), classified: 0 };
    }
  })

  .post("/:id/important", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    emailQueries.markImportant.run(params.id);
    return { success: true };
  })

  .post("/:id/not-important", async ({ params }) => {
    const email = emailQueries.getById.get(params.id) as any;
    if (!email) {
      return { success: false, error: "Email not found" };
    }

    emailQueries.markNotImportant.run(params.id);
    return { success: true };
  });
