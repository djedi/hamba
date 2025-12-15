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
  trash: (id: string) => request(`/emails/${id}/trash`, { method: "POST" }),

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
  received_at: number;
}
