import type { TrackingSummary, TrackingEvent } from "./tracking";

// Production web builds set VITE_API_URL=/api (same origin, behind a reverse proxy)
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8877";

/** Called on any 401: the app login session is missing or expired */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class AuthError extends Error {
  needsReauth: boolean;

  constructor(message: string, needsReauth = false) {
    super(message);
    this.name = "AuthError";
    this.needsReauth = needsReauth;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const data = await res.json();

  // Check for needsReauth in response
  if (data && typeof data === "object" && "needsReauth" in data && data.needsReauth) {
    throw new AuthError(data.error || "Session expired", true);
  }

  return data;
}

// Action endpoints report failure as HTTP 200 with { success: false }; throw so
// optimistic updates roll back.
async function action(path: string, options?: RequestInit): Promise<{ success: boolean }> {
  const data = await request<{ success: boolean; error?: string }>(path, options);
  if (data && data.success === false) {
    throw new Error(data.error || "Action failed");
  }
  return data;
}

export const api = {
  // Auth
  getAccounts: () => request<Account[]>("/auth/accounts"),
  getAccount: (id: string) => request<Account>(`/auth/accounts/${id}`),
  getAccountStatus: (id: string) => request<AccountStatus>(`/auth/accounts/${id}/status`),
  updateAccount: (id: string, params: { displayName?: string; color?: string; syncFrequencySeconds?: number; initialSyncLimit?: number; syncAllMail?: boolean } & Partial<ImapServerSettings>) =>
    request<{ success: boolean; error?: string }>(`/auth/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),
  uploadAccountAvatar: (id: string, dataUrl: string) =>
    request<{ success?: boolean; error?: string; avatar_updated_at?: number }>(`/auth/accounts/${id}/avatar`, {
      method: "POST",
      body: JSON.stringify({ data: dataUrl }),
    }),
  deleteAccountAvatar: (id: string) => request(`/auth/accounts/${id}/avatar`, { method: "DELETE" }),
  accountAvatarUrl: (id: string, version?: number | null) =>
    `${API_URL}/auth/accounts/${id}/avatar?v=${version ?? 0}`,
  deleteAccount: (id: string) => request(`/auth/accounts/${id}`, { method: "DELETE" }),
  // API keys (public read-only API)
  getApiKeys: () => request<ApiKey[]>("/api-keys"),
  createApiKey: (name: string) =>
    request<{ success: boolean; error?: string; key?: string } & Partial<ApiKey>>("/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revokeApiKey: (id: string) => action(`/api-keys/${id}`, { method: "DELETE" }),
  getApiDocsUrl: () => `${API_URL}/docs`,
  // Web Push (new-mail notifications when the app is closed)
  getPushKey: () => request<{ publicKey: string }>("/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) =>
    action("/push/subscribe", { method: "POST", body: JSON.stringify(subscription) }),
  pushUnsubscribe: (endpoint: string) =>
    action("/push/unsubscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }),

  getLoginUrl: () => `${API_URL}/auth/login`,
  getMicrosoftLoginUrl: () => `${API_URL}/auth/login/microsoft`,
  getYahooLoginUrl: () => `${API_URL}/auth/login/yahoo`,

  // Emails
  getEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getUnreadCounts: () => request<Record<string, number>>("/emails/unread-counts"),

  getStarredEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/starred?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getSentEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/sent?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getTrashedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/trashed?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getArchivedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/archived?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getSnoozedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/snoozed?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getReminderEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/reminders?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getEmail: (id: string) => request<Email>(`/emails/${id}`),

  getThread: (threadId: string, accountId?: string) =>
    request<Email[]>(`/emails/thread/${encodeURIComponent(threadId)}${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`),

  searchEmails: (query: string, limit = 50, accountId?: string) =>
    request<Email[]>(`/emails/search?q=${encodeURIComponent(query)}&limit=${limit}${accountId ? `&accountId=${accountId}` : ''}`),

  syncEmails: (accountId: string) =>
    request<{ synced: number; total: number }>(`/emails/sync/${accountId}`, { method: "POST" }),

  syncSentEmails: (accountId: string) =>
    request<{ synced: number; total: number }>(`/emails/sync-sent/${accountId}`, { method: "POST" }),

  markRead: (id: string) => action(`/emails/${id}/read`, { method: "POST" }),
  markUnread: (id: string) => action(`/emails/${id}/unread`, { method: "POST" }),
  star: (id: string) => action(`/emails/${id}/star`, { method: "POST" }),
  unstar: (id: string) => action(`/emails/${id}/unstar`, { method: "POST" }),
  archive: (id: string) => action(`/emails/${id}/archive`, { method: "POST" }),
  unarchive: (id: string) => action(`/emails/${id}/unarchive`, { method: "POST" }),
  trash: (id: string) => action(`/emails/${id}/trash`, { method: "POST" }),
  untrash: (id: string) => action(`/emails/${id}/untrash`, { method: "POST" }),
  permanentDelete: (id: string) => action(`/emails/${id}/permanent`, { method: "DELETE" }),

  // Batch operations for multi-select
  batchArchive: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/archive", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  batchTrash: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/trash", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  batchStar: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/star", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  batchUnstar: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/unstar", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  batchMarkRead: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/read", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  batchMarkUnread: (emailIds: string[]) =>
    request<{ success: boolean; count: number; failed: string[]; errors: string[] }>("/emails/batch/unread", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),

  snooze: (id: string, snoozedUntil: number) =>
    action(`/emails/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ snoozedUntil }),
    }),
  unsnooze: (id: string) => action(`/emails/${id}/unsnooze`, { method: "POST" }),

  setReminder: (id: string, remindAt: number) =>
    action(`/emails/${id}/reminder`, {
      method: "POST",
      body: JSON.stringify({ remindAt }),
    }),
  clearReminder: (id: string) => action(`/emails/${id}/reminder`, { method: "DELETE" }),

  // Send (immediate, no undo)
  sendEmail: (params: {
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
  }) =>
    request<{ success: boolean; messageId?: string; error?: string }>("/emails/send", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Queue send with undo support
  queueSendEmail: (params: {
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
    trackOpens?: boolean;
    trackLinks?: boolean;
  }) =>
    request<{ success: boolean; pendingId?: string; sendAt?: number; undoWindowSeconds?: number; error?: string }>("/emails/queue-send", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Cancel a pending send (undo)
  cancelPendingSend: (pendingId: string) =>
    request<{ success: boolean; error?: string }>(`/emails/pending/${pendingId}`, {
      method: "DELETE",
    }),

  // IMAP Account
  addImapAccount: (params: ImapAccountParams) =>
    request<{ success: boolean; account?: Account; error?: string }>("/auth/accounts/imap", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  // Drafts
  getDrafts: (accountId: string) =>
    request<Draft[]>(`/drafts?accountId=${accountId}`),

  getDraft: (id: string) => request<Draft>(`/drafts/${id}`),

  saveDraft: (params: {
    id: string;
    accountId: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    replyToId?: string;
    replyMode?: string;
  }) =>
    request<{ success: boolean; id: string; error?: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  deleteDraft: (id: string) =>
    request<{ success: boolean; error?: string }>(`/drafts/${id}`, {
      method: "DELETE",
    }),

  syncDrafts: (accountId: string) =>
    request<{ synced: number; total: number }>(`/drafts/sync/${accountId}`, { method: "POST" }),

  // Labels
  getLabels: (accountId: string) =>
    request<Label[]>(`/labels?accountId=${accountId}`),

  getLabel: (id: string) => request<Label>(`/labels/${id}`),

  getEmailsForLabel: (labelId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/labels/${labelId}/emails?limit=${limit}&offset=${offset}`),

  getLabelsForEmail: (emailId: string) =>
    request<Label[]>(`/labels/email/${emailId}`),

  createLabel: (params: { accountId: string; name: string; color?: string }) =>
    request<{ success: boolean; id?: string; error?: string }>("/labels", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateLabel: (id: string, params: { name?: string; color?: string }) =>
    request<{ success: boolean; error?: string }>(`/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  deleteLabel: (id: string) =>
    request<{ success: boolean; error?: string }>(`/labels/${id}`, {
      method: "DELETE",
    }),

  addLabelToEmail: (labelId: string, emailId: string) =>
    request<{ success: boolean; error?: string }>(`/labels/${labelId}/emails/${emailId}`, {
      method: "POST",
    }),

  removeLabelFromEmail: (labelId: string, emailId: string) =>
    request<{ success: boolean; error?: string }>(`/labels/${labelId}/emails/${emailId}`, {
      method: "DELETE",
    }),

  // Read receipts / link tracking
  getTrackingConfig: () => request<{ available: boolean }>("/emails/tracking/config"),
  getTrackingEvents: (emailId: string) => request<TrackingEvent[]>(`/emails/${emailId}/tracking`),

  // Scheduled emails (send later)
  getScheduledEmails: (accountId: string) =>
    request<ScheduledEmail[]>(`/emails/scheduled?accountId=${accountId}`),

  getScheduledEmail: (id: string) => request<ScheduledEmail>(`/emails/scheduled/${id}`),

  scheduleEmail: (params: {
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
    trackOpens?: boolean;
    trackLinks?: boolean;
  }) =>
    request<{ success: boolean; scheduledId?: string; sendAt?: number; error?: string }>("/emails/schedule", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateScheduledEmail: (id: string, params: {
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
    trackOpens?: boolean;
    trackLinks?: boolean;
  }) =>
    request<{ success: boolean; error?: string }>(`/emails/scheduled/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  cancelScheduledEmail: (id: string) =>
    request<{ success: boolean; error?: string }>(`/emails/scheduled/${id}`, {
      method: "DELETE",
    }),

  // Snippets
  getSnippets: (accountId: string) =>
    request<Snippet[]>(`/snippets?accountId=${accountId}`),

  getSnippet: (id: string) => request<Snippet>(`/snippets/${id}`),

  getSnippetByShortcut: (accountId: string, shortcut: string) =>
    request<Snippet | null>(`/snippets/by-shortcut/${shortcut}?accountId=${accountId}`),

  createSnippet: (params: { accountId: string; name: string; shortcut: string; content: string }) =>
    request<{ success: boolean; id?: string; error?: string }>("/snippets", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateSnippet: (id: string, params: { name?: string; shortcut?: string; content?: string }) =>
    request<{ success: boolean; error?: string }>(`/snippets/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  deleteSnippet: (id: string) =>
    request<{ success: boolean; error?: string }>(`/snippets/${id}`, {
      method: "DELETE",
    }),

  // Contacts
  getContacts: (accountId: string) =>
    request<Contact[]>(`/contacts?accountId=${accountId}`),

  searchContacts: (accountId: string, query?: string, limit = 10) =>
    request<Contact[]>(`/contacts/search?accountId=${accountId}${query ? `&q=${encodeURIComponent(query)}` : ''}&limit=${limit}`),

  populateContacts: (accountId: string) =>
    request<{ success: boolean; count?: number; error?: string }>(`/contacts/populate?accountId=${accountId}`, {
      method: "POST",
    }),

  addContact: (params: { accountId: string; email: string; name?: string }) =>
    request<{ success: boolean; id?: string; error?: string }>("/contacts", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  deleteContact: (id: string) =>
    request<{ success: boolean; error?: string }>(`/contacts/${id}`, {
      method: "DELETE",
    }),

  // AI
  getAiStatus: () => request<{ configured: boolean }>("/ai/status"),

  aiCompose: (params: {
    prompt: string;
    context?: {
      replyTo?: {
        subject: string;
        from: string;
        body: string;
      };
      mode?: "new" | "reply" | "replyAll" | "forward";
    };
  }) =>
    request<{ success: boolean; content?: string; error?: string }>("/ai/compose", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  aiSummarize: (emailId: string, regenerate?: boolean) =>
    request<{ success: boolean; summary?: string; cached?: boolean; generated_at?: number; error?: string }>("/ai/summarize", {
      method: "POST",
      body: JSON.stringify({ emailId, regenerate }),
    }),

  aiClassify: (emailId: string, force?: boolean) =>
    request<{ success: boolean; score?: number; is_important?: boolean; reason?: string; cached?: boolean; classified_at?: number; error?: string }>("/ai/classify", {
      method: "POST",
      body: JSON.stringify({ emailId, force }),
    }),

  aiClassifyBatch: (accountId: string, limit?: number, force?: boolean) =>
    request<{ success: boolean; classified?: number; total?: number; message?: string; error?: string }>("/ai/classify-batch", {
      method: "POST",
      body: JSON.stringify({ accountId, limit, force }),
    }),

  aiSmartReplies: (emailId: string) =>
    request<{ success: boolean; replies?: string[]; error?: string }>("/ai/smart-replies", {
      method: "POST",
      body: JSON.stringify({ emailId }),
    }),

  // Signatures
  getSignatures: (accountId: string) =>
    request<Signature[]>(`/signatures?accountId=${accountId}`),

  getSignature: (id: string) => request<Signature>(`/signatures/${id}`),

  getDefaultSignature: (accountId: string) =>
    request<Signature | null>(`/signatures/default/${accountId}`),

  createSignature: (params: { accountId: string; name: string; content: string; isHtml?: boolean; isDefault?: boolean }) =>
    request<{ success: boolean; id?: string; error?: string }>("/signatures", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  updateSignature: (id: string, params: { name?: string; content?: string; isHtml?: boolean }) =>
    request<{ success: boolean; error?: string }>(`/signatures/${id}`, {
      method: "PUT",
      body: JSON.stringify(params),
    }),

  setDefaultSignature: (id: string) =>
    request<{ success: boolean; error?: string }>(`/signatures/${id}/default`, {
      method: "POST",
    }),

  clearDefaultSignature: (id: string) =>
    request<{ success: boolean; error?: string }>(`/signatures/${id}/default`, {
      method: "DELETE",
    }),

  deleteSignature: (id: string) =>
    request<{ success: boolean; error?: string }>(`/signatures/${id}`, {
      method: "DELETE",
    }),
};

export interface Account {
  id: string;
  email: string;
  name: string;
  provider_type: "gmail" | "imap" | "microsoft" | "yahoo";
  created_at: number;
  tokenStatus?: "valid" | "expired" | "unknown";
  unread_count?: number;
  // Account settings
  display_name?: string | null;
  sync_frequency_seconds?: number;
  // Sync settings
  initial_sync_limit?: number;
  sync_all_mail?: number;
  sync_progress_total?: number | null;
  sync_progress_synced?: number | null;
  last_full_sync_at?: number | null;
  // Appearance
  color?: string | null;
  has_avatar?: boolean;
  avatar_updated_at?: number | null;
  // IMAP/SMTP accounts
  imap_host?: string | null;
  imap_port?: number | null;
  imap_use_tls?: number | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_use_tls?: number | null;
}

/** Server settings for IMAP accounts; omit `password` to keep the current one */
export interface ImapServerSettings {
  imapHost: string;
  imapPort: number;
  imapUseTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUseTls: boolean;
  password: string;
}

export interface ImapAccountParams {
  email: string;
  name?: string;
  username?: string;
  password: string;
  imapHost: string;
  imapPort?: number;
  imapUseTls?: boolean;
  smtpHost: string;
  smtpPort?: number;
  smtpUseTls?: boolean;
}

export interface AccountStatus {
  valid: boolean;
  needsReauth: boolean;
  error?: string;
}

export interface Email {
  id: string;
  account_id: string;
  thread_id: string;
  message_id: string;
  subject: string;
  snippet: string;
  from_name: string;
  from_email: string;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  body_text: string;
  body_html: string;
  labels: string;
  is_read: number;
  is_starred: number;
  is_archived: number;
  is_trashed: number;
  is_important: number;
  snoozed_until: number | null;
  remind_at: number | null;
  received_at: number;
  // Server folder ("inbox", "sent", ...); only inbox mail counts toward the unread badge
  folder?: string | null;
  summary: string | null;
  summary_generated_at: number | null;
  ai_importance_score: number | null;
  ai_classified_at: number | null;
  // Present on sent messages sent with tracking enabled
  tracking?: TrackingSummary;
}

export interface Draft {
  id: string;
  account_id: string;
  remote_id: string | null;
  to_addresses: string;
  cc_addresses: string;
  bcc_addresses: string;
  subject: string;
  body: string;
  reply_to_id: string | null;
  reply_mode: string | null;
  updated_at: number;
  created_at: number;
}

export interface Label {
  id: string;
  account_id: string;
  name: string;
  color: string;
  type: string;
  remote_id: string | null;
  created_at: number;
}

export interface ScheduledEmail {
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
  track_opens?: number;
  track_links?: number;
}

export interface Snippet {
  id: string;
  account_id: string;
  name: string;
  shortcut: string;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface Contact {
  id: string;
  account_id: string;
  email: string;
  name: string | null;
  last_contacted: number;
  contact_count: number;
  created_at: number;
}

export interface SessionStatus {
  authEnabled: boolean;
  authenticated: boolean;
  setupRequired: boolean;
  username: string | null;
  passkeysSupported: boolean;
  hasPasskeys: boolean;
}

export interface AppPasskey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

type SessionResult = { success: boolean; error?: string; username?: string };
// WebAuthn options/credentials are passed through as JSON (see webauthn.ts)
type Ceremony = { ceremonyId?: string; options?: unknown; success?: boolean; error?: string };

export const sessionApi = {
  status: () => request<SessionStatus>("/session/status"),
  setup: (username: string, password: string) =>
    request<SessionResult>("/session/setup", { method: "POST", body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) =>
    request<SessionResult>("/session/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<SessionResult>("/session/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionResult>("/session/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listPasskeys: () => request<AppPasskey[]>("/session/passkeys"),
  deletePasskey: (id: string) => action(`/session/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  registerStart: () => request<Ceremony>("/session/passkeys/register/start", { method: "POST" }),
  registerFinish: (ceremonyId: string, credential: unknown, name: string) =>
    request<SessionResult>("/session/passkeys/register/finish", {
      method: "POST",
      body: JSON.stringify({ ceremonyId, credential, name }),
    }),
  passkeyLoginStart: () => request<Ceremony>("/session/passkeys/login/start", { method: "POST" }),
  passkeyLoginFinish: (ceremonyId: string, credential: unknown) =>
    request<SessionResult>("/session/passkeys/login/finish", {
      method: "POST",
      body: JSON.stringify({ ceremonyId, credential }),
    }),
};

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface Signature {
  id: string;
  account_id: string;
  name: string;
  content: string;
  is_html: number;
  is_default: number;
  created_at: number;
  updated_at: number;
}
