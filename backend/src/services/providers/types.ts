// Provider interface for email operations
export interface EmailProvider {
  sync(options?: SyncOptions): Promise<SyncResult>;
  syncSent(options?: SyncOptions): Promise<SyncResult>;
  syncDrafts(options?: SyncOptions): Promise<SyncResult>;
  markRead(emailId: string): Promise<void>;
  markUnread(emailId: string): Promise<void>;
  star(emailId: string): Promise<void>;
  unstar(emailId: string): Promise<void>;
  archive(emailId: string): Promise<void>;
  unarchive(emailId: string): Promise<void>;
  trash(emailId: string): Promise<void>;
  untrash(emailId: string): Promise<void>;
  permanentDelete(emailId: string): Promise<void>;
  send(params: SendParams): Promise<SendResult>;
  deleteDraft(draftId: string): Promise<void>;
  validateCredentials(): Promise<boolean>;
}

export interface SyncOptions {
  maxMessages?: number;
  folder?: string;
  /** If true, sync continues in background until all messages are fetched */
  syncAll?: boolean;
  /** Callback for progress updates */
  onProgress?: (synced: number, total: number) => void;
}

export interface SyncResult {
  synced: number;
  total: number;
  error?: string;
  needsReauth?: boolean;
  /** Total messages available on the server */
  serverTotal?: number;
  /** Whether more messages are available to sync */
  hasMore?: boolean;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  content: Buffer | string; // Buffer for binary, base64 string from frontend
}

export interface SendParams {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  attachments?: Attachment[];
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

// Account types
export interface GmailAccount {
  id: string;
  email: string;
  name: string;
  provider_type: "gmail";
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
}

export interface ImapAccount {
  id: string;
  email: string;
  name: string;
  provider_type: "imap";
  imap_host: string;
  imap_port: number;
  imap_use_tls: number;
  smtp_host: string;
  smtp_port: number;
  smtp_use_tls: number;
  password: string;
}

export interface MicrosoftAccount {
  id: string;
  email: string;
  name: string;
  provider_type: "microsoft";
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
}

export interface YahooAccount {
  id: string;
  email: string;
  name: string;
  provider_type: "yahoo";
  access_token: string;
  refresh_token: string;
  token_expires_at: number;
}

export type Account = GmailAccount | ImapAccount | MicrosoftAccount | YahooAccount;
