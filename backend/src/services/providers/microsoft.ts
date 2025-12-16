import type { EmailProvider, SendParams, SendResult, SyncOptions, SyncResult, Attachment } from "./types";
import { getMicrosoftAccessToken } from "../token";
import { emailQueries, accountQueries, attachmentQueries, draftQueries, labelQueries, emailLabelQueries } from "../../db";

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

interface AttachmentInfo {
  id: string;
  contentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
}

// Parse Microsoft Graph message to our format
function parseMicrosoftMessage(msg: any, accountId: string) {
  const from = msg.from?.emailAddress || {};

  return {
    id: msg.id,
    accountId,
    threadId: msg.conversationId || msg.id,
    messageId: msg.internetMessageId || `<${msg.id}@outlook.com>`,
    subject: msg.subject || "",
    snippet: msg.bodyPreview || "",
    fromName: from.name || "",
    fromEmail: from.address || "",
    toAddresses: (msg.toRecipients || [])
      .map((r: any) => r.emailAddress?.address)
      .filter(Boolean)
      .join(", "),
    ccAddresses: (msg.ccRecipients || [])
      .map((r: any) => r.emailAddress?.address)
      .filter(Boolean)
      .join(", "),
    bccAddresses: (msg.bccRecipients || [])
      .map((r: any) => r.emailAddress?.address)
      .filter(Boolean)
      .join(", "),
    bodyText: msg.body?.contentType === "text" ? msg.body?.content || "" : "",
    bodyHtml: msg.body?.contentType === "html" ? msg.body?.content || "" : "",
    labels: JSON.stringify(msg.categories || []),
    isRead: msg.isRead || false,
    isStarred: msg.flag?.flagStatus === "flagged",
    receivedAt: msg.receivedDateTime
      ? Math.floor(new Date(msg.receivedDateTime).getTime() / 1000)
      : Math.floor(Date.now() / 1000),
  };
}

// System folders that should not be synced as labels
const SYSTEM_FOLDERS = new Set([
  "inbox", "sentitems", "drafts", "deleteditems", "junkemail",
  "archive", "outbox", "scheduled"
]);

export class MicrosoftProvider implements EmailProvider {
  private accountId: string;

  constructor(accountId: string) {
    this.accountId = accountId;
  }

  private async getToken(): Promise<string | null> {
    const result = await getMicrosoftAccessToken(this.accountId);
    return result.accessToken;
  }

  private async getTokenWithError() {
    return getMicrosoftAccessToken(this.accountId);
  }

  // Sync Microsoft mail folders to local database as labels
  async syncLabels(): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) return;

    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/me/mailFolders?$top=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return;

      const data = await response.json() as { value?: Array<{ id: string; displayName: string; isHidden?: boolean }> };
      const folders = data.value || [];

      for (const folder of folders) {
        // Skip system folders and hidden folders
        const folderNameLower = folder.displayName.toLowerCase().replace(/\s+/g, '');
        if (SYSTEM_FOLDERS.has(folderNameLower) || folder.isHidden) {
          continue;
        }

        const localId = `microsoft:${this.accountId}:${folder.id}`;
        const color = "#6366f1"; // Default purple color

        labelQueries.upsert.run(
          localId,
          this.accountId,
          folder.displayName,
          color,
          "user",
          folder.id
        );
      }
    } catch (e) {
      console.error("[Microsoft] Error syncing labels:", e);
    }
  }

  // Associate email with its categories/labels
  private associateEmailLabels(emailId: string, categories: string[]): void {
    emailLabelQueries.removeAllLabelsFromEmail.run(emailId);

    for (const category of categories) {
      // Find the label by name
      const label = labelQueries.getByName.get(this.accountId, category) as any;
      if (label) {
        emailLabelQueries.addLabelToEmail.run(emailId, label.id);
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
        needsReauth: tokenResult.needsReauth,
      };
    }

    const accessToken = tokenResult.accessToken;
    const maxMessages = options?.maxMessages || 100;
    const seenEmailIds = new Set<string>();

    // Sync labels first
    await this.syncLabels();

    // Fetch messages from inbox
    const listResponse = await fetch(
      `${GRAPH_API_BASE}/me/mailFolders/inbox/messages?$top=${maxMessages}&$orderby=receivedDateTime desc&$select=id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,body,categories,isRead,flag,receivedDateTime,hasAttachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string; code?: string } };
      const isAuthError = listResponse.status === 401 || listResponse.status === 403;
      return {
        synced: 0,
        total: 0,
        error: err.error?.message || "Failed to fetch messages",
        needsReauth: isAuthError,
      };
    }

    const listData = await listResponse.json() as { value?: Array<any> };
    const messages = listData.value || [];

    let synced = 0;

    for (const msg of messages) {
      const parsed = parseMicrosoftMessage(msg, this.accountId);
      seenEmailIds.add(parsed.id);

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
        parsed.bodyText,
        parsed.bodyHtml,
        parsed.labels,
        parsed.isRead ? 1 : 0,
        parsed.isStarred ? 1 : 0,
        parsed.receivedAt,
        "inbox"
      );

      // Ensure this email is not marked as archived
      emailQueries.unarchive.run(parsed.id);

      // Associate email with its categories
      if (msg.categories && msg.categories.length > 0) {
        this.associateEmailLabels(parsed.id, msg.categories);
      }

      // Fetch inline attachments for embedded images
      if (msg.hasAttachments) {
        await this.fetchAttachments(parsed.id, accessToken);
      }

      synced++;
    }

    // Reconcile: mark emails not in INBOX as archived
    const archived = this.reconcileArchivedEmails(seenEmailIds);
    if (archived > 0) {
      console.log(`[Microsoft] Reconciled ${archived} archived emails for account ${this.accountId}`);
    }

    return { synced, total: messages.length };
  }

  private async fetchAttachments(emailId: string, accessToken: string): Promise<void> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/me/messages/${emailId}/attachments`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!response.ok) return;

      const data = await response.json() as { value?: Array<any> };
      const attachments = data.value || [];

      for (const att of attachments) {
        if (att.contentId && att.contentType?.startsWith("image/")) {
          const binaryData = Buffer.from(att.contentBytes || "", "base64");

          attachmentQueries.insert.run(
            `${emailId}:${att.contentId}`,
            emailId,
            att.contentId,
            att.name || "attachment",
            att.contentType,
            att.size || binaryData.length,
            binaryData
          );
        }
      }
    } catch (e) {
      console.error(`[Microsoft] Failed to fetch attachments for ${emailId}:`, e);
    }
  }

  private reconcileArchivedEmails(seenEmailIds: Set<string>): number {
    const localEmails = emailQueries.getActiveIdsByAccount.all(this.accountId) as { id: string }[];
    let archived = 0;

    for (const email of localEmails) {
      if (!seenEmailIds.has(email.id)) {
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
    const maxMessages = options?.maxMessages || 100;

    const listResponse = await fetch(
      `${GRAPH_API_BASE}/me/mailFolders/sentitems/messages?$top=${maxMessages}&$orderby=receivedDateTime desc&$select=id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,body,categories,isRead,flag,receivedDateTime,hasAttachments`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string } };
      const isAuthError = listResponse.status === 401 || listResponse.status === 403;
      return {
        synced: 0,
        total: 0,
        error: err.error?.message || "Failed to fetch sent messages",
        needsReauth: isAuthError,
      };
    }

    const listData = await listResponse.json() as { value?: Array<any> };
    const messages = listData.value || [];

    let synced = 0;

    for (const msg of messages) {
      const parsed = parseMicrosoftMessage(msg, this.accountId);

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
        parsed.bodyText,
        parsed.bodyHtml,
        parsed.labels,
        parsed.isRead ? 1 : 0,
        parsed.isStarred ? 1 : 0,
        parsed.receivedAt,
        "sent"
      );

      if (msg.categories && msg.categories.length > 0) {
        this.associateEmailLabels(parsed.id, msg.categories);
      }

      if (msg.hasAttachments) {
        const token = await this.getToken();
        if (token) await this.fetchAttachments(parsed.id, token);
      }

      synced++;
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
        needsReauth: tokenResult.needsReauth,
      };
    }

    const accessToken = tokenResult.accessToken;
    const maxMessages = options?.maxMessages || 50;

    const listResponse = await fetch(
      `${GRAPH_API_BASE}/me/mailFolders/drafts/messages?$top=${maxMessages}&$orderby=lastModifiedDateTime desc&$select=id,subject,bodyPreview,toRecipients,ccRecipients,bccRecipients,body`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!listResponse.ok) {
      const err = await listResponse.json() as { error?: { message?: string } };
      const isAuthError = listResponse.status === 401 || listResponse.status === 403;
      return {
        synced: 0,
        total: 0,
        error: err.error?.message || "Failed to fetch drafts",
        needsReauth: isAuthError,
      };
    }

    const listData = await listResponse.json() as { value?: Array<any> };
    const drafts = listData.value || [];

    let synced = 0;

    for (const draft of drafts) {
      const localId = `microsoft-draft:${draft.id}`;

      const toAddresses = (draft.toRecipients || [])
        .map((r: any) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ");
      const ccAddresses = (draft.ccRecipients || [])
        .map((r: any) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ");
      const bccAddresses = (draft.bccRecipients || [])
        .map((r: any) => r.emailAddress?.address)
        .filter(Boolean)
        .join(", ");

      draftQueries.upsert.run(
        localId,
        this.accountId,
        draft.id, // remote_id
        toAddresses,
        ccAddresses,
        bccAddresses,
        draft.subject || "",
        draft.body?.content || "",
        null, // reply_to_id
        null  // reply_mode
      );

      synced++;
    }

    return { synced, total: drafts.length };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/messages/${draftId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok && response.status !== 204) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Microsoft API error: ${response.status}`);
    }
  }

  async markRead(emailId: string): Promise<void> {
    await this.updateMessage(emailId, { isRead: true });
  }

  async markUnread(emailId: string): Promise<void> {
    await this.updateMessage(emailId, { isRead: false });
  }

  async star(emailId: string): Promise<void> {
    await this.updateMessage(emailId, { flag: { flagStatus: "flagged" } });
  }

  async unstar(emailId: string): Promise<void> {
    await this.updateMessage(emailId, { flag: { flagStatus: "notFlagged" } });
  }

  async archive(emailId: string): Promise<void> {
    // Move to archive folder
    await this.moveMessage(emailId, "archive");
  }

  async unarchive(emailId: string): Promise<void> {
    // Move back to inbox
    await this.moveMessage(emailId, "inbox");
  }

  async trash(emailId: string): Promise<void> {
    await this.moveMessage(emailId, "deleteditems");
  }

  async untrash(emailId: string): Promise<void> {
    await this.moveMessage(emailId, "inbox");
  }

  async permanentDelete(emailId: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/messages/${emailId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok && response.status !== 204) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Microsoft API error: ${response.status}`);
    }
  }

  private async updateMessage(emailId: string, updates: any): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/messages/${emailId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Microsoft API error: ${response.status}`);
    }
  }

  private async moveMessage(emailId: string, destinationFolder: string): Promise<void> {
    const accessToken = await this.getToken();
    if (!accessToken) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/messages/${emailId}/move`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ destinationId: destinationFolder }),
      }
    );

    if (!response.ok) {
      const err = await response.json() as { error?: { message?: string } };
      throw new Error(err.error?.message || `Microsoft API error: ${response.status}`);
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

    // Build Microsoft Graph message format
    const message: any = {
      subject: params.subject,
      body: {
        contentType: "html",
        content: params.body,
      },
      toRecipients: params.to.split(",").map((email) => ({
        emailAddress: { address: email.trim() },
      })),
    };

    if (params.cc) {
      message.ccRecipients = params.cc.split(",").map((email) => ({
        emailAddress: { address: email.trim() },
      }));
    }

    if (params.bcc) {
      message.bccRecipients = params.bcc.split(",").map((email) => ({
        emailAddress: { address: email.trim() },
      }));
    }

    // Handle attachments
    if (params.attachments && params.attachments.length > 0) {
      message.attachments = params.attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename,
        contentType: att.mimeType,
        contentBytes: Buffer.isBuffer(att.content)
          ? att.content.toString("base64")
          : att.content,
      }));
    }

    // Handle reply threading
    if (params.inReplyTo) {
      message.internetMessageHeaders = [
        { name: "In-Reply-To", value: params.inReplyTo },
      ];
      if (params.references) {
        message.internetMessageHeaders.push({
          name: "References",
          value: params.references,
        });
      }
    }

    const response = await fetch(
      `${GRAPH_API_BASE}/me/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      }
    );

    if (!response.ok && response.status !== 202) {
      const err = await response.json() as { error?: { message?: string } };
      return { success: false, error: err.error?.message || "Failed to send email" };
    }

    // Microsoft sendMail doesn't return the message ID directly
    return { success: true };
  }

  async validateCredentials(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;

    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/me`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
