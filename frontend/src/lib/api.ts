const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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

export const api = {
  // Auth
  getAccounts: () => request<Account[]>("/auth/accounts"),
  getAccountStatus: (id: string) => request<AccountStatus>(`/auth/accounts/${id}/status`),
  deleteAccount: (id: string) => request(`/auth/accounts/${id}`, { method: "DELETE" }),
  getLoginUrl: () => `${API_URL}/auth/login`,

  // Emails
  getEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getStarredEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/starred?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getSentEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/sent?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getTrashedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/trashed?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getArchivedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/archived?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getImportantEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/important?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getOtherEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/other?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getSnoozedEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/snoozed?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  getReminderEmails: (accountId: string, limit = 50, offset = 0) =>
    request<Email[]>(`/emails/reminders?accountId=${accountId}&limit=${limit}&offset=${offset}`),

  classifyEmails: (accountId: string) =>
    request<{ success: boolean; classified: number }>(`/emails/classify/${accountId}`, { method: "POST" }),

  markImportant: (id: string) => request(`/emails/${id}/important`, { method: "POST" }),
  markNotImportant: (id: string) => request(`/emails/${id}/not-important`, { method: "POST" }),

  getEmail: (id: string) => request<Email>(`/emails/${id}`),

  getThread: (threadId: string) => request<Email[]>(`/emails/thread/${threadId}`),

  searchEmails: (query: string, limit = 50) =>
    request<Email[]>(`/emails/search?q=${encodeURIComponent(query)}&limit=${limit}`),

  syncEmails: (accountId: string) =>
    request<{ synced: number; total: number }>(`/emails/sync/${accountId}`, { method: "POST" }),

  syncSentEmails: (accountId: string) =>
    request<{ synced: number; total: number }>(`/emails/sync-sent/${accountId}`, { method: "POST" }),

  markRead: (id: string) => request(`/emails/${id}/read`, { method: "POST" }),
  markUnread: (id: string) => request(`/emails/${id}/unread`, { method: "POST" }),
  star: (id: string) => request(`/emails/${id}/star`, { method: "POST" }),
  unstar: (id: string) => request(`/emails/${id}/unstar`, { method: "POST" }),
  archive: (id: string) => request(`/emails/${id}/archive`, { method: "POST" }),
  unarchive: (id: string) => request(`/emails/${id}/unarchive`, { method: "POST" }),
  trash: (id: string) => request(`/emails/${id}/trash`, { method: "POST" }),
  untrash: (id: string) => request(`/emails/${id}/untrash`, { method: "POST" }),
  permanentDelete: (id: string) => request(`/emails/${id}/permanent`, { method: "DELETE" }),

  snooze: (id: string, snoozedUntil: number) =>
    request(`/emails/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ snoozedUntil }),
    }),
  unsnooze: (id: string) => request(`/emails/${id}/unsnooze`, { method: "POST" }),

  setReminder: (id: string, remindAt: number) =>
    request(`/emails/${id}/reminder`, {
      method: "POST",
      body: JSON.stringify({ remindAt }),
    }),
  clearReminder: (id: string) => request(`/emails/${id}/reminder`, { method: "DELETE" }),

  // Send
  sendEmail: (params: {
    accountId: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    replyToId?: string;
  }) =>
    request<{ success: boolean; messageId?: string; error?: string }>("/emails/send", {
      method: "POST",
      body: JSON.stringify(params),
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
};

export interface Account {
  id: string;
  email: string;
  name: string;
  provider_type: "gmail" | "imap";
  created_at: number;
  tokenStatus?: "valid" | "expired" | "unknown";
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
