import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { EmailProvider, SendParams, SendResult, SyncOptions, SyncResult } from "./types";
import { accountQueries, emailQueries, attachmentQueries } from "../../db";
import { simpleParser, type Attachment } from "mailparser";

export class ImapSmtpProvider implements EmailProvider {
  private accountId: string;
  private account: any;

  constructor(accountId: string) {
    this.accountId = accountId;
    this.account = accountQueries.getById.get(accountId);
  }

  private createImapClient(): ImapFlow {
    return new ImapFlow({
      host: this.account.imap_host,
      port: this.account.imap_port || 993,
      secure: !!this.account.imap_use_tls,
      auth: {
        user: this.account.username || this.account.email,
        pass: this.account.password,
      },
      logger: false,
    });
  }

  private createSmtpTransport(): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: this.account.smtp_host,
      port: this.account.smtp_port || 587,
      secure: this.account.smtp_port === 465,
      auth: {
        user: this.account.username || this.account.email,
        pass: this.account.password,
      },
    });
  }

  async sync(options?: SyncOptions): Promise<SyncResult> {
    const client = this.createImapClient();
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
            const emailId = `${this.accountId}:${msg.uid}`;
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
              parsed.receivedAt
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
            console.error("Error parsing message:", e);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      // Reconcile: mark emails not in INBOX as archived
      const archived = this.reconcileArchivedEmails(seenEmailIds);
      if (archived > 0) {
        console.log(`[IMAP] Reconciled ${archived} archived emails for account ${this.accountId}`);
      }

      return { synced, total: synced };
    } catch (error) {
      console.error("IMAP sync error:", error);
      return { synced: 0, total: 0, error: String(error) };
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
        console.error("Error parsing email body:", e);
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
    // emailId format: "{accountId}:{uid}"
    const parts = emailId.split(":");
    return parseInt(parts[parts.length - 1] || "0", 10);
  }

  async markRead(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

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
      console.error("IMAP markRead error:", error);
      throw error;
    }
  }

  async markUnread(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

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
      console.error("IMAP markUnread error:", error);
      throw error;
    }
  }

  async star(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

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
      console.error("IMAP star error:", error);
      throw error;
    }
  }

  async unstar(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

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
      console.error("IMAP unstar error:", error);
      throw error;
    }
  }

  async archive(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

    try {
      await client.connect();

      // List mailboxes to find the archive folder
      const mailboxes = await client.list();
      const archiveNames = ["Archive", "Archives", "[Gmail]/All Mail", "All Mail", "INBOX.Archive"];
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
          console.log(`[IMAP] Archived message ${uid} to ${archiveFolder}`);
        } else {
          // No archive folder found, create one
          try {
            await client.mailboxCreate("Archive");
            await client.messageMove({ uid }, "Archive", { uid: true });
            console.log(`[IMAP] Created Archive folder and archived message ${uid}`);
          } catch (e) {
            // If we can't create/move to archive, just remove from INBOX (some servers don't support archive)
            console.error("[IMAP] Could not archive message, no archive folder available:", e);
            throw new Error("No archive folder available on this server");
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("IMAP archive error:", error);
      throw error;
    }
  }

  async trash(emailId: string): Promise<void> {
    const uid = this.extractUid(emailId);
    const client = this.createImapClient();

    try {
      await client.connect();

      // List mailboxes to find the trash folder
      const mailboxes = await client.list();
      const trashNames = ["Trash", "Deleted", "Deleted Items", "[Gmail]/Trash", "INBOX.Trash"];
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
          console.log(`[IMAP] Trashed message ${uid} to ${trashFolder}`);
        } else {
          // If no trash folder found, mark as deleted and expunge
          await client.messageFlagsAdd({ uid }, ["\\Deleted"], { uid: true });
          await client.messageDelete({ uid }, { uid: true });
          console.log(`[IMAP] Deleted message ${uid} (no trash folder)`);
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (error) {
      console.error("IMAP trash error:", error);
      throw error;
    }
  }

  async send(params: SendParams): Promise<SendResult> {
    const transporter = this.createSmtpTransport();

    try {
      const info = await transporter.sendMail({
        from: params.from,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
        html: params.body,
        inReplyTo: params.inReplyTo,
        references: params.references,
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
    const client = this.createImapClient();

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch (error) {
      console.error("IMAP validation error:", error);
      return false;
    }
  }
}
