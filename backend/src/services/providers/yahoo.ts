import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { EmailProvider, SendParams, SendResult, SyncOptions, SyncResult } from "./types";
import { accountQueries, emailQueries, attachmentQueries, draftQueries, labelQueries, emailLabelQueries } from "../../db";
import { simpleParser, type Attachment } from "mailparser";
import { getYahooAccessToken } from "../token";

// Default colors for Yahoo folders
const FOLDER_COLORS: Record<string, string> = {
  "INBOX": "#4285f4",
  "Sent": "#34a853",
  "Drafts": "#fbbc05",
  "Trash": "#ea4335",
  "Archive": "#6366f1",
};

// Helper to detect if an error is an authentication error
function isYahooAuthError(error: any): boolean {
  const errorStr = String(error).toLowerCase();
  return errorStr.includes("authentication") ||
    errorStr.includes("auth") ||
    errorStr.includes("login") ||
    errorStr.includes("credentials") ||
    errorStr.includes("invalid_grant") ||
    errorStr.includes("token") ||
    error.authenticationFailed ||
    error.code === "AUTHENTICATIONFAILED";
}

export class YahooProvider implements EmailProvider {
  private accountId: string;
  private account: any;

  constructor(accountId: string) {
    this.accountId = accountId;
    this.account = accountQueries.getById.get(accountId);
  }

  private async getToken(): Promise<string | null> {
    const result = await getYahooAccessToken(this.accountId);
    return result.accessToken;
  }

  private async getTokenWithError() {
    return getYahooAccessToken(this.accountId);
  }

  // Sync Yahoo folders as labels
  async syncFolders(): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) return;

    const client = await this.createImapClient(accessToken);
    if (!client) return;

    try {
      await client.connect();
      const mailboxes = await client.list();

      for (const mailbox of mailboxes) {
        // Skip special/system folders
        const specialFolders = ["INBOX", "Sent", "Sent Items", "Sent Mail", "Drafts", "Draft", "Trash", "Deleted", "Deleted Items", "Spam", "Junk", "Bulk Mail"];
        const isSpecial = specialFolders.some(f =>
          mailbox.path === f || mailbox.name === f ||
          mailbox.path.endsWith(`/${f}`)
        );

        if (isSpecial) continue;

        const localId = `yahoo:${this.accountId}:${mailbox.path}`;
        const color = FOLDER_COLORS[mailbox.name] || "#6366f1";

        labelQueries.upsert.run(
          localId,
          this.accountId,
          mailbox.name,
          color,
          "folder",
          mailbox.path
        );
      }

      await client.logout();
    } catch (e) {
      console.error("[Yahoo] Error syncing folders:", e);
    }
  }

  private async createImapClient(accessToken: string): Promise<ImapFlow | null> {
    if (!accessToken) return null;

    // Yahoo IMAP with XOAUTH2 authentication
    return new ImapFlow({
      host: "imap.mail.yahoo.com",
      port: 993,
      secure: true,
      auth: {
        user: this.account.email,
        accessToken: accessToken,
      },
      logger: false,
    });
  }

  private async createSmtpTransport(accessToken: string): Promise<nodemailer.Transporter | null> {
    if (!accessToken) return null;

    // Yahoo SMTP with XOAUTH2 authentication
    return nodemailer.createTransport({
      host: "smtp.mail.yahoo.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: this.account.email,
        accessToken: accessToken,
      },
    });
  }

  async sync(options?: SyncOptions): Promise<SyncResult> {
    const tokenResult = await this.getTokenWithError();

    if (!tokenResult.accessToken) {
      return {
        synced: 0,
        total: 0,
        error: tokenResult.error || "Not authenticated",
        needsReauth: tokenResult.needsReauth,
      };
    }

    const accessToken = tokenResult.accessToken;

    // Sync folders first
    await this.syncFolders();

    const client = await this.createImapClient(accessToken);
    if (!client) {
      return { synced: 0, total: 0, error: "Failed to create IMAP client" };
    }

    let synced = 0;
    const seenEmailIds = new Set<string>();

    try {
      await client.connect();

      const folder = options?.folder || "INBOX";
      const lock = await client.getMailboxLock(folder);

      try {
        const maxMessages = options?.maxMessages || 100;

        // Get total message count
        const mailbox = client.mailbox;
        const total = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;

        if (total === 0) {
          // Empty INBOX - mark all local emails as archived
          this.reconcileArchivedEmails(seenEmailIds);
          return { synced: 0, total: 0 };
        }

        // Fetch last N messages (most recent)
        const start = Math.max(1, total - maxMessages + 1);
        const range = `${start}:*`;

        for await (const msg of client.fetch(range, {
          envelope: true,
          source: true,
          flags: true,
          uid: true,
        })) {
          try {
            const parsed = await this.parseImapMessage(msg);

            // Generate composite ID for uniqueness
            const emailId = `yahoo:${this.accountId}:${msg.uid}`;
            seenEmailIds.add(emailId);

            emailQueries.upsert.run(
              emailId,
              this.accountId,
              parsed.threadId,
              parsed.messageId,
              parsed.subject,
              parsed.snippet,
              parsed.fromName,
              parsed.fromEmail,
              parsed.toAddresses,
              parsed.ccAddresses,
              "",
              parsed.bodyText,
              parsed.bodyHtml,
              "[]",
              parsed.isRead ? 1 : 0,
              parsed.isStarred ? 1 : 0,
              parsed.receivedAt,
              "inbox"
            );

            // Ensure this email is not marked as archived (in case it was un-archived elsewhere)
            emailQueries.unarchive.run(emailId);

            // Store inline attachments (those with cid for embedded images)
            for (const att of parsed.attachments) {
              const contentId = att.cid || null;
              if (contentId && att.contentType?.startsWith("image/")) {
                try {
                  attachmentQueries.insert.run(
                    `${emailId}:${contentId}`,
                    emailId,
                    contentId,
                    att.filename || "attachment",
                    att.contentType,
                    att.size || att.content.length,
                    att.content
                  );
                } catch (e) {
                  // Ignore duplicate attachment errors
                }
              }
            }

            synced++;
          } catch (e) {
            console.error("[Yahoo] Error parsing message:", e);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      // Reconcile: mark emails not in INBOX as archived
      const archived = this.reconcileArchivedEmails(seenEmailIds);
      if (archived > 0) {
        console.log(`[Yahoo] Reconciled ${archived} archived emails for account ${this.accountId}`);
      }

      return { synced, total: synced };
    } catch (error: any) {
      console.error("[Yahoo] IMAP sync error:", error);
      return {
        synced: 0,
        total: 0,
        error: String(error),
        needsReauth: isYahooAuthError(error),
      };
    }
  }

  private reconcileArchivedEmails(seenEmailIds: Set<string>): number {
    // Get all local active (non-archived) emails for this account
    const localEmails = emailQueries.getActiveIdsByAccount.all(this.accountId) as { id: string }[];
    let archived = 0;

    for (const email of localEmails) {
      if (!seenEmailIds.has(email.id)) {
        // Email is no longer in INBOX - mark as archived
        emailQueries.archive.run(email.id);
        archived++;
      }
    }

    return archived;
  }

  async syncSent(options?: SyncOptions): Promise<SyncResult> {
    const tokenResult = await this.getTokenWithError();

    if (!tokenResult.accessToken) {
      return {
        synced: 0,
        total: 0,
        error: tokenResult.error || "Not authenticated",
        needsReauth: tokenResult.needsReauth,
      };
    }

    const accessToken = tokenResult.accessToken;
    const client = await this.createImapClient(accessToken);
    if (!client) {
      return { synced: 0, total: 0, error: "Failed to create IMAP client" };
    }

    let synced = 0;

    try {
      await client.connect();

      // List mailboxes to find the sent folder
      const mailboxes = await client.list();
      const sentNames = ["Sent", "Sent Items", "Sent Mail"];
      let sentFolder: string | null = null;

      // Find existing sent folder
      for (const name of sentNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          sentFolder = name;
          break;
        }
      }

      if (!sentFolder) {
        await client.logout();
        return { synced: 0, total: 0, error: "Sent folder not found" };
      }

      const lock = await client.getMailboxLock(sentFolder);

      try {
        const maxMessages = options?.maxMessages || 100;

        // Get total message count
        const mailbox = client.mailbox;
        const total = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;

        if (total === 0) {
          return { synced: 0, total: 0 };
        }

        // Fetch last N messages (most recent)
        const start = Math.max(1, total - maxMessages + 1);
        const range = `${start}:*`;

        for await (const msg of client.fetch(range, {
          envelope: true,
          source: true,
          flags: true,
          uid: true,
        })) {
          try {
            const parsed = await this.parseImapMessage(msg);

            // Generate composite ID for uniqueness (prefix with 'sent:' to avoid collision with inbox)
            const emailId = `yahoo:${this.accountId}:sent:${msg.uid}`;

            emailQueries.upsert.run(
              emailId,
              this.accountId,
              parsed.threadId,
              parsed.messageId,
              parsed.subject,
              parsed.snippet,
              parsed.fromName,
              parsed.fromEmail,
              parsed.toAddresses,
              parsed.ccAddresses,
              "",
              parsed.bodyText,
              parsed.bodyHtml,
              "[]",
              parsed.isRead ? 1 : 0,
              parsed.isStarred ? 1 : 0,
              parsed.receivedAt,
              "sent"
            );

            // Store inline attachments (those with cid for embedded images)
            for (const att of parsed.attachments) {
              const contentId = att.cid || null;
              if (contentId && att.contentType?.startsWith("image/")) {
                try {
                  attachmentQueries.insert.run(
                    `${emailId}:${contentId}`,
                    emailId,
                    contentId,
                    att.filename || "attachment",
                    att.contentType,
                    att.size || att.content.length,
                    att.content
                  );
                } catch (e) {
                  // Ignore duplicate attachment errors
                }
              }
            }

            synced++;
          } catch (e) {
            console.error("[Yahoo] Error parsing sent message:", e);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
      return { synced, total: synced };
    } catch (error: any) {
      console.error("[Yahoo] IMAP syncSent error:", error);
      return {
        synced: 0,
        total: 0,
        error: String(error),
        needsReauth: isYahooAuthError(error),
      };
    }
  }

  async syncDrafts(options?: SyncOptions): Promise<SyncResult> {
    const tokenResult = await this.getTokenWithError();

    if (!tokenResult.accessToken) {
      return {
        synced: 0,
        total: 0,
        error: tokenResult.error || "Not authenticated",
        needsReauth: tokenResult.needsReauth,
      };
    }

    const accessToken = tokenResult.accessToken;
    const client = await this.createImapClient(accessToken);
    if (!client) {
      return { synced: 0, total: 0, error: "Failed to create IMAP client" };
    }

    let synced = 0;

    try {
      await client.connect();

      // List mailboxes to find the drafts folder
      const mailboxes = await client.list();
      const draftNames = ["Drafts", "Draft"];
      let draftsFolder: string | null = null;

      // Find existing drafts folder
      for (const name of draftNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          draftsFolder = name;
          break;
        }
      }

      if (!draftsFolder) {
        await client.logout();
        return { synced: 0, total: 0, error: "Drafts folder not found" };
      }

      const lock = await client.getMailboxLock(draftsFolder);

      try {
        const maxMessages = options?.maxMessages || 50;

        // Get total message count
        const mailbox = client.mailbox;
        const total = mailbox && typeof mailbox === "object" ? mailbox.exists : 0;

        if (total === 0) {
          return { synced: 0, total: 0 };
        }

        // Fetch last N messages (most recent)
        const start = Math.max(1, total - maxMessages + 1);
        const range = `${start}:*`;

        for await (const msg of client.fetch(range, {
          envelope: true,
          source: true,
          flags: true,
          uid: true,
        })) {
          try {
            const parsed = await this.parseImapMessage(msg);

            // Generate composite ID for drafts
            const localId = `yahoo-draft:${this.accountId}:${msg.uid}`;

            draftQueries.upsert.run(
              localId,
              this.accountId,
              `${msg.uid}`, // remote_id - just the UID for IMAP
              parsed.toAddresses,
              parsed.ccAddresses,
              "", // bcc not typically stored in drafts
              parsed.subject,
              parsed.bodyHtml || parsed.bodyText,
              null, // reply_to_id
              null // reply_mode
            );

            synced++;
          } catch (e) {
            console.error("[Yahoo] Error parsing draft:", e);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
      return { synced, total: synced };
    } catch (error: any) {
      console.error("[Yahoo] IMAP syncDrafts error:", error);
      return {
        synced: 0,
        total: 0,
        error: String(error),
        needsReauth: isYahooAuthError(error),
      };
    }
  }

  async deleteDraft(draftUid: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const client = await this.createImapClient(accessToken);
    if (!client) {
      throw new Error("Failed to create IMAP client");
    }

    try {
      await client.connect();

      // List mailboxes to find the drafts folder
      const mailboxes = await client.list();
      const draftNames = ["Drafts", "Draft"];
      let draftsFolder: string | null = null;

      for (const name of draftNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          draftsFolder = name;
          break;
        }
      }

      if (!draftsFolder) {
        await client.logout();
        throw new Error("Drafts folder not found");
      }

      const uid = parseInt(draftUid, 10);
      const lock = await client.getMailboxLock(draftsFolder);

      try {
        await client.messageFlagsAdd({ uid }, ["\\Deleted"], { uid: true });
        await client.messageDelete({ uid }, { uid: true });
      } finally {
        lock.release();
      }

      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP deleteDraft error:", error);
      throw error;
    }
  }

  private async parseImapMessage(msg: any): Promise<any> {
    const envelope = msg.envelope;

    // Parse the raw source for body content
    let bodyText = "";
    let bodyHtml = "";
    let snippet = "";
    let attachments: Attachment[] = [];

    if (msg.source) {
      try {
        const parsed = await simpleParser(msg.source);
        bodyText = parsed.text || "";
        bodyHtml = parsed.html || "";
        snippet = bodyText.substring(0, 200).replace(/\s+/g, " ").trim();
        attachments = parsed.attachments || [];
      } catch (e) {
        console.error("[Yahoo] Error parsing email body:", e);
      }
    }

    const fromAddr = envelope.from?.[0];
    const fromName = fromAddr?.name || "";
    const fromEmail = fromAddr?.address || "";

    // Use In-Reply-To or References header for threading
    const messageId = envelope.messageId || "";
    const inReplyTo = envelope.inReplyTo || "";
    const threadId = inReplyTo || messageId;

    return {
      messageId,
      threadId,
      subject: envelope.subject || "(No subject)",
      snippet,
      fromName,
      fromEmail,
      toAddresses: envelope.to?.map((t: any) => t.address).join(", ") || "",
      ccAddresses: envelope.cc?.map((t: any) => t.address).join(", ") || "",
      bodyText,
      bodyHtml,
      attachments,
      isRead: msg.flags?.has("\\Seen") || false,
      isStarred: msg.flags?.has("\\Flagged") || false,
      receivedAt: envelope.date ? Math.floor(new Date(envelope.date).getTime() / 1000) : Math.floor(Date.now() / 1000),
    };
  }

  private extractUid(emailId: string): number {
    // emailId format: "yahoo:{accountId}:{uid}" or "yahoo:{accountId}:sent:{uid}"
    const parts = emailId.split(":");
    return parseInt(parts[parts.length - 1] || "0", 10);
  }

  async markRead(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP markRead error:", error);
      throw error;
    }
  }

  async markUnread(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsRemove({ uid }, ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP markUnread error:", error);
      throw error;
    }
  }

  async star(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsAdd({ uid }, ["\\Flagged"], { uid: true });
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP star error:", error);
      throw error;
    }
  }

  async unstar(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsRemove({ uid }, ["\\Flagged"], { uid: true });
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP unstar error:", error);
      throw error;
    }
  }

  async archive(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();

      // List mailboxes to find the archive folder
      const mailboxes = await client.list();
      const archiveNames = ["Archive", "Archives"];
      let archiveFolder: string | null = null;

      // Find existing archive folder
      for (const name of archiveNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          archiveFolder = name;
          break;
        }
      }

      const lock = await client.getMailboxLock("INBOX");
      try {
        if (archiveFolder) {
          await client.messageMove({ uid }, archiveFolder, { uid: true });
          console.log(`[Yahoo] Archived message ${uid} to ${archiveFolder}`);
        } else {
          // No archive folder found, create one
          try {
            await client.mailboxCreate("Archive");
            await client.messageMove({ uid }, "Archive", { uid: true });
            console.log(`[Yahoo] Created Archive folder and archived message ${uid}`);
          } catch (e) {
            console.error("[Yahoo] Could not archive message, no archive folder available:", e);
            throw new Error("No archive folder available on this server");
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP archive error:", error);
      throw error;
    }
  }

  async unarchive(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();

      // List mailboxes to find the archive folder
      const mailboxes = await client.list();
      const archiveNames = ["Archive", "Archives"];
      let archiveFolder: string | null = null;

      // Find existing archive folder
      for (const name of archiveNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          archiveFolder = name;
          break;
        }
      }

      if (!archiveFolder) {
        throw new Error("Archive folder not found");
      }

      const lock = await client.getMailboxLock(archiveFolder);
      try {
        // Move message back to INBOX
        await client.messageMove({ uid }, "INBOX", { uid: true });
        console.log(`[Yahoo] Unarchived message ${uid} from ${archiveFolder} to INBOX`);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP unarchive error:", error);
      throw error;
    }
  }

  async trash(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();

      // List mailboxes to find the trash folder
      const mailboxes = await client.list();
      const trashNames = ["Trash", "Deleted", "Deleted Items"];
      let trashFolder: string | null = null;

      // Find existing trash folder
      for (const name of trashNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          trashFolder = name;
          break;
        }
      }

      const lock = await client.getMailboxLock("INBOX");
      try {
        if (trashFolder) {
          await client.messageMove({ uid }, trashFolder, { uid: true });
          console.log(`[Yahoo] Trashed message ${uid} to ${trashFolder}`);
        } else {
          // If no trash folder found, mark as deleted and expunge
          await client.messageFlagsAdd({ uid }, ["\\Deleted"], { uid: true });
          await client.messageDelete({ uid }, { uid: true });
          console.log(`[Yahoo] Deleted message ${uid} (no trash folder)`);
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP trash error:", error);
      throw error;
    }
  }

  async untrash(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();

      // List mailboxes to find the trash folder
      const mailboxes = await client.list();
      const trashNames = ["Trash", "Deleted", "Deleted Items"];
      let trashFolder: string | null = null;

      // Find existing trash folder
      for (const name of trashNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          trashFolder = name;
          break;
        }
      }

      if (!trashFolder) {
        throw new Error("Trash folder not found");
      }

      const lock = await client.getMailboxLock(trashFolder);
      try {
        // Move message back to INBOX
        await client.messageMove({ uid }, "INBOX", { uid: true });
        console.log(`[Yahoo] Restored message ${uid} from trash to INBOX`);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP untrash error:", error);
      throw error;
    }
  }

  async permanentDelete(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) throw new Error("Not authenticated");

    const uid = this.extractUid(emailId);
    const client = await this.createImapClient(accessToken);
    if (!client) throw new Error("Failed to create IMAP client");

    try {
      await client.connect();

      // List mailboxes to find the trash folder
      const mailboxes = await client.list();
      const trashNames = ["Trash", "Deleted", "Deleted Items"];
      let trashFolder: string | null = null;

      // Find existing trash folder
      for (const name of trashNames) {
        if (mailboxes.some(m => m.path === name || m.name === name)) {
          trashFolder = name;
          break;
        }
      }

      // Try to delete from trash folder first, then INBOX as fallback
      const folderToTry = trashFolder || "INBOX";
      const lock = await client.getMailboxLock(folderToTry);
      try {
        await client.messageFlagsAdd({ uid }, ["\\Deleted"], { uid: true });
        await client.messageDelete({ uid }, { uid: true });
        console.log(`[Yahoo] Permanently deleted message ${uid} from ${folderToTry}`);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("[Yahoo] IMAP permanentDelete error:", error);
      throw error;
    }
  }

  async send(params: SendParams): Promise<SendResult> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      return { success: false, error: "Not authenticated" };
    }

    const transporter = await this.createSmtpTransport(accessToken);
    if (!transporter) {
      return { success: false, error: "Failed to create SMTP transport" };
    }

    try {
      // Convert our attachment format to nodemailer format
      const nodemailerAttachments = params.attachments?.map((att) => ({
        filename: att.filename,
        content: Buffer.isBuffer(att.content)
          ? att.content
          : Buffer.from(att.content, "base64"),
        contentType: att.mimeType,
      }));

      const info = await transporter.sendMail({
        from: params.from,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
        html: params.body,
        inReplyTo: params.inReplyTo,
        references: params.references,
        attachments: nodemailerAttachments,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  async validateCredentials(): Promise<boolean> {
    const accessToken = await this.getToken();
    if (!accessToken) return false;

    const client = await this.createImapClient(accessToken);
    if (!client) return false;

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch (error) {
      console.error("[Yahoo] IMAP validation error:", error);
      return false;
    }
  }
}
