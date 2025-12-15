import type { EmailProvider, SendParams, SendResult, SyncOptions, SyncResult } from "./types";
import { getValidAccessToken } from "../token";
import { emailQueries, accountQueries, attachmentQueries, draftQueries, labelQueries, emailLabelQueries } from "../../db";

interface AttachmentInfo {
  attachmentId: string;
  contentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
}

// Build RFC 2822 email format for Gmail API
function buildRawEmail(options: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];

  lines.push(`From: ${options.from}`);
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${options.subject}`);
  if (options.inReplyTo) lines.push(`In-Reply-To: ${options.inReplyTo}`);
  if (options.references) lines.push(`References: ${options.references}`);
  lines.push(`MIME-Version: 1.0`);
  lines.push(`Content-Type: text/html; charset="UTF-8"`);
  lines.push(``);
  lines.push(options.body);

  const raw = lines.join("\r\n");
  // Gmail API requires base64url encoding
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Parse Gmail message to our format
function parseGmailMessage(msg: any, accountId: string) {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const fromHeader = getHeader("From");
  const fromMatch = fromHeader.match(/^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$/);

  return {
    id: msg.id,
    accountId,
    threadId: msg.threadId,
    messageId: getHeader("Message-ID"),
    subject: getHeader("Subject"),
    snippet: msg.snippet,
    fromName: fromMatch?.[1]?.trim() || "",
    fromEmail: fromMatch?.[2]?.trim() || fromHeader,
    toAddresses: getHeader("To"),
    ccAddresses: getHeader("Cc"),
    bccAddresses: getHeader("Bcc"),
    bodyText: "",
    bodyHtml: "",
    labels: JSON.stringify(msg.labelIds || []),
    isRead: !msg.labelIds?.includes("UNREAD"),
    isStarred: msg.labelIds?.includes("STARRED"),
    receivedAt: Math.floor(parseInt(msg.internalDate) / 1000),
  };
}

// Extract body and attachments from Gmail message payload
function extractBodyAndAttachments(payload: any): { text: string; html: string; attachments: AttachmentInfo[] } {
  let text = "";
  let html = "";
  const attachments: AttachmentInfo[] = [];

  function processPart(part: any) {
    const headers = part.headers || [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

    if (part.mimeType === "text/plain" && part.body?.data) {
      text = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.body?.attachmentId) {
      // This is an attachment
      const contentId = getHeader("Content-ID")?.replace(/^<|>$/g, "") || null;
      attachments.push({
        attachmentId: part.body.attachmentId,
        contentId,
        filename: part.filename || "attachment",
        mimeType: part.mimeType,
        size: part.body.size || 0,
      });
    }

    if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  processPart(payload);
  return { text, html, attachments };
}

// System labels that should not be synced
const SYSTEM_LABELS = new Set([
  "INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "UNREAD",
  "IMPORTANT", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES", "CATEGORY_FORUMS"
]);

// Default colors for Gmail labels
const LABEL_COLORS: Record<string, string> = {
  "INBOX": "#4285f4",
  "SENT": "#34a853",
  "STARRED": "#fbbc05",
  "IMPORTANT": "#ea4335",
};

export class GmailProvider implements EmailProvider {
  private accountId: string;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async getToken(): Promise<string | null> {
    const result = await getValidAccessToken(this.accountId);
    return result.accessToken;
  }

  private async getTokenWithError() {
    return getValidAccessToken(this.accountId);
  }

  // Sync Gmail labels to local database
  async syncLabels(): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) return;

    try {
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return;

      const data = await response.json() as { labels?: Array<{ id: string; name: string; type: string }> };
      const labels = data.labels || [];

      for (const label of labels) {
        // Skip system labels
        if (SYSTEM_LABELS.has(label.id) || label.type === "system") {
          continue;
        }

        const localId = `gmail:${this.accountId}:${label.id}`;
        const color = LABEL_COLORS[label.id] || "#6366f1";

        labelQueries.upsert.run(
          localId,
          this.accountId,
          label.name,
          color,
          label.type === "user" ? "user" : "system",
          label.id
        );
      }
    } catch (e) {
      console.error("[Gmail] Error syncing labels:", e);
    }
  }

  // Associate email with its labels
  private associateEmailLabels(emailId: string, labelIds: string[]): void {
    // First remove all existing label associations
    emailLabelQueries.removeAllLabelsFromEmail.run(emailId);

    // Add new associations for user labels
    for (const labelId of labelIds) {
      if (SYSTEM_LABELS.has(labelId)) continue;

      const localLabelId = `gmail:${this.accountId}:${labelId}`;
      const label = labelQueries.getById.get(localLabelId) as any;

      if (label) {
        emailLabelQueries.addLabelToEmail.run(emailId, localLabelId);
      }
    }
  }

  async sync(options?: SyncOptions): Promise<SyncResult> {
    const tokenResult = await this.getTokenWithError();

    if (!tokenResult.accessToken) {
      return {
        synced: 0,
        total: 0,
        error: tokenResult.error || "Not authenticated",
      };
    }

    const accessToken = tokenResult.accessToken;
    const maxMessages = options?.maxMessages || 100;
    const seenEmailIds = new Set<string>();

    // Sync labels first so we can associate them with emails
    await this.syncLabels();

    // Fetch message list from Gmail - only INBOX messages
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMessages}&labelIds=INBOX`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string } };
      return { synced: 0, total: 0, error: err.error?.message || "Failed to fetch messages" };
    }

    const listData = await listResponse.json() as { messages?: Array<{ id: string }> };
    const messages = listData.messages || [];

    // Fetch full message details in batches
    let synced = 0;
    const batchSize = 20;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      const messagePromises = batch.map((m: any) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then((res) => res.json() as Promise<any>)
      );

      const fullMessages = await Promise.all(messagePromises);

      for (const msg of fullMessages) {
        if (msg.error) continue;

        const parsed = parseGmailMessage(msg, this.accountId);
        seenEmailIds.add(parsed.id);

        const { text, html, attachments } = extractBodyAndAttachments(msg.payload);

        emailQueries.upsert.run(
          parsed.id,
          parsed.accountId,
          parsed.threadId,
          parsed.messageId,
          parsed.subject,
          parsed.snippet,
          parsed.fromName,
          parsed.fromEmail,
          parsed.toAddresses,
          parsed.ccAddresses,
          parsed.bccAddresses,
          text,
          html,
          parsed.labels,
          parsed.isRead ? 1 : 0,
          parsed.isStarred ? 1 : 0,
          parsed.receivedAt,
          "inbox"
        );

        // Ensure this email is not marked as archived (in case it was moved back to INBOX)
        emailQueries.unarchive.run(parsed.id);

        // Associate email with its labels
        if (msg.labelIds) {
          this.associateEmailLabels(parsed.id, msg.labelIds);
        }

        // Fetch and store inline attachments (those with contentId for cid: references)
        for (const att of attachments) {
          if (att.contentId && att.mimeType.startsWith("image/")) {
            try {
              const attResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${att.attachmentId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );

              if (attResponse.ok) {
                const attData = await attResponse.json() as { data: string; size: number };
                // Gmail returns base64url encoded data
                const binaryData = Buffer.from(
                  attData.data.replace(/-/g, "+").replace(/_/g, "/"),
                  "base64"
                );

                attachmentQueries.insert.run(
                  `${parsed.id}:${att.contentId}`,
                  parsed.id,
                  att.contentId,
                  att.filename,
                  att.mimeType,
                  binaryData.length,
                  binaryData
                );
              }
            } catch (e) {
              console.error(`Failed to fetch attachment ${att.contentId}:`, e);
            }
          }
        }

        synced++;
      }
    }

    // Reconcile: mark emails not in INBOX as archived
    const archived = this.reconcileArchivedEmails(seenEmailIds);
    if (archived > 0) {
      console.log(`[Gmail] Reconciled ${archived} archived emails for account ${this.accountId}`);
    }

    return { synced, total: messages.length };
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
      };
    }

    const accessToken = tokenResult.accessToken;
    const maxMessages = options?.maxMessages || 100;

    // Fetch message list from Gmail - only SENT messages
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMessages}&labelIds=SENT`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string } };
      return { synced: 0, total: 0, error: err.error?.message || "Failed to fetch sent messages" };
    }

    const listData = await listResponse.json() as { messages?: Array<{ id: string }> };
    const messages = listData.messages || [];

    // Fetch full message details in batches
    let synced = 0;
    const batchSize = 20;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      const messagePromises = batch.map((m: any) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then((res) => res.json() as Promise<any>)
      );

      const fullMessages = await Promise.all(messagePromises);

      for (const msg of fullMessages) {
        if (msg.error) continue;

        const parsed = parseGmailMessage(msg, this.accountId);
        const { text, html, attachments } = extractBodyAndAttachments(msg.payload);

        emailQueries.upsert.run(
          parsed.id,
          parsed.accountId,
          parsed.threadId,
          parsed.messageId,
          parsed.subject,
          parsed.snippet,
          parsed.fromName,
          parsed.fromEmail,
          parsed.toAddresses,
          parsed.ccAddresses,
          parsed.bccAddresses,
          text,
          html,
          parsed.labels,
          parsed.isRead ? 1 : 0,
          parsed.isStarred ? 1 : 0,
          parsed.receivedAt,
          "sent"
        );

        // Associate email with its labels
        if (msg.labelIds) {
          this.associateEmailLabels(parsed.id, msg.labelIds);
        }

        // Fetch and store inline attachments (those with contentId for cid: references)
        for (const att of attachments) {
          if (att.contentId && att.mimeType.startsWith("image/")) {
            try {
              const attResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${att.attachmentId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );

              if (attResponse.ok) {
                const attData = await attResponse.json() as { data: string; size: number };
                // Gmail returns base64url encoded data
                const binaryData = Buffer.from(
                  attData.data.replace(/-/g, "+").replace(/_/g, "/"),
                  "base64"
                );

                attachmentQueries.insert.run(
                  `${parsed.id}:${att.contentId}`,
                  parsed.id,
                  att.contentId,
                  att.filename,
                  att.mimeType,
                  binaryData.length,
                  binaryData
                );
              }
            } catch (e) {
              console.error(`Failed to fetch attachment ${att.contentId}:`, e);
            }
          }
        }

        synced++;
      }
    }

    return { synced, total: messages.length };
  }

  async syncDrafts(options?: SyncOptions): Promise<SyncResult> {
    const tokenResult = await this.getTokenWithError();

    if (!tokenResult.accessToken) {
      return {
        synced: 0,
        total: 0,
        error: tokenResult.error || "Not authenticated",
      };
    }

    const accessToken = tokenResult.accessToken;
    const maxMessages = options?.maxMessages || 50;

    // Fetch drafts list from Gmail
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=${maxMessages}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string } };
      return { synced: 0, total: 0, error: err.error?.message || "Failed to fetch drafts" };
    }

    const listData = await listResponse.json() as { drafts?: Array<{ id: string; message: { id: string } }> };
    const drafts = listData.drafts || [];

    let synced = 0;
    const batchSize = 20;

    for (let i = 0; i < drafts.length; i += batchSize) {
      const batch = drafts.slice(i, i + batchSize);

      const draftPromises = batch.map((d: any) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${d.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        ).then((res) => res.json() as Promise<any>)
      );

      const fullDrafts = await Promise.all(draftPromises);

      for (const draft of fullDrafts) {
        if (draft.error) continue;

        const msg = draft.message;
        const parsed = parseGmailMessage(msg, this.accountId);
        const { text, html } = extractBodyAndAttachments(msg.payload);

        // Use Gmail draft ID as local ID prefix
        const localId = `gmail-draft:${draft.id}`;

        draftQueries.upsert.run(
          localId,
          this.accountId,
          draft.id, // remote_id
          parsed.toAddresses,
          parsed.ccAddresses,
          parsed.bccAddresses,
          parsed.subject,
          html || text,
          null, // reply_to_id - not available from Gmail draft
          null // reply_mode
        );

        synced++;
      }
    }

    return { synced, total: drafts.length };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Gmail API error: ${response.status}`);
    }
  }

  private async modifyMessage(emailId: string, modifications: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modifications),
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Gmail API error: ${response.status}`);
    }
  }

  async markRead(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { removeLabelIds: ["UNREAD"] });
  }

  async markUnread(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { addLabelIds: ["UNREAD"] });
  }

  async star(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { addLabelIds: ["STARRED"] });
  }

  async unstar(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { removeLabelIds: ["STARRED"] });
  }

  async archive(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { removeLabelIds: ["INBOX"] });
  }

  async unarchive(emailId: string): Promise<void> {
    await this.modifyMessage(emailId, { addLabelIds: ["INBOX"] });
  }

  async trash(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/trash`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Gmail API error: ${response.status}`);
    }
  }

  async untrash(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}/untrash`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Gmail API error: ${response.status}`);
    }
  }

  async permanentDelete(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Gmail API error: ${response.status}`);
    }
  }

  async send(params: SendParams): Promise<SendResult> {
    const account = accountQueries.getById.get(this.accountId) as any;
    if (!account) {
      return { success: false, error: "Account not found" };
    }

    const tokenResult = await this.getTokenWithError();
    if (!tokenResult.accessToken) {
      return {
        success: false,
        error: tokenResult.error || "Not authenticated",
      };
    }

    const accessToken = tokenResult.accessToken;

    const raw = buildRawEmail({
      from: `${account.name || account.email} <${account.email}>`,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      body: params.body,
      inReplyTo: params.inReplyTo,
      references: params.references,
    });

    const sendUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
    const payload: any = { raw };
    if (params.threadId) {
      payload.threadId = params.threadId;
    }

    const response = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      return { success: false, error: err.error?.message || "Failed to send email" };
    }

    const result = await response.json() as { id: string; threadId: string };
    return { success: true, messageId: result.id, threadId: result.threadId };
  }

  async validateCredentials(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }
}
