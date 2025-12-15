import { Database } from "bun:sqlite";

export const db = new Database("hamba.db");

// Initialize tables immediately
db.run(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    provider_type TEXT DEFAULT 'gmail',
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER,
    imap_host TEXT,
    imap_port INTEGER DEFAULT 993,
    imap_use_tls INTEGER DEFAULT 1,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    smtp_use_tls INTEGER DEFAULT 1,
    password TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`);

// Add columns for existing databases (migrations)
const addColumnIfNotExists = (table: string, column: string, definition: string) => {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    // Column already exists
  }
};

addColumnIfNotExists("accounts", "provider_type", "TEXT DEFAULT 'gmail'");
addColumnIfNotExists("accounts", "imap_host", "TEXT");
addColumnIfNotExists("accounts", "imap_port", "INTEGER DEFAULT 993");
addColumnIfNotExists("accounts", "imap_use_tls", "INTEGER DEFAULT 1");
addColumnIfNotExists("accounts", "smtp_host", "TEXT");
addColumnIfNotExists("accounts", "smtp_port", "INTEGER DEFAULT 587");
addColumnIfNotExists("accounts", "smtp_use_tls", "INTEGER DEFAULT 1");
addColumnIfNotExists("accounts", "password", "TEXT");

// Add trashed_at column for auto-delete after 30 days
addColumnIfNotExists("emails", "trashed_at", "INTEGER");

// Remove body_html_dark column - dark mode now applied via CSS filter at render time
try {
  db.run("ALTER TABLE emails DROP COLUMN body_html_dark");
} catch (e) {
  // Column doesn't exist or already removed
}

// Add username field for IMAP accounts (defaults to email if not specified)
addColumnIfNotExists("accounts", "username", "TEXT");

// Add folder column to emails for tracking inbox vs sent vs other folders
addColumnIfNotExists("emails", "folder", "TEXT DEFAULT 'inbox'");

// Add is_important column for split inbox feature
addColumnIfNotExists("emails", "is_important", "INTEGER DEFAULT 0");

// Add snoozed_until column for snooze functionality
addColumnIfNotExists("emails", "snoozed_until", "INTEGER");

// Add remind_at column for follow-up reminders
addColumnIfNotExists("emails", "remind_at", "INTEGER");

db.run(`
  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    thread_id TEXT,
    message_id TEXT UNIQUE,
    subject TEXT,
    snippet TEXT,
    from_name TEXT,
    from_email TEXT,
    to_addresses TEXT,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    body_text TEXT,
    body_html TEXT,
    labels TEXT,
    is_read INTEGER DEFAULT 0,
    is_starred INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_trashed INTEGER DEFAULT 0,
    is_important INTEGER DEFAULT 0,
    snoozed_until INTEGER,
    remind_at INTEGER,
    received_at INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    folder TEXT DEFAULT 'inbox',
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_is_important ON emails(is_important)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_snoozed_until ON emails(snoozed_until)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_emails_remind_at ON emails(remind_at)`);

// Attachments table for embedded images and files
db.run(`
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL,
    content_id TEXT,
    filename TEXT,
    mime_type TEXT,
    size INTEGER,
    data BLOB,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_content_id ON attachments(content_id)`);

// Drafts table for auto-saving compose content
db.run(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    remote_id TEXT,
    to_addresses TEXT,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    subject TEXT,
    body TEXT,
    reply_to_id TEXT,
    reply_mode TEXT,
    updated_at INTEGER DEFAULT (unixepoch()),
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_account_id ON drafts(account_id)`);

// Labels table for Gmail labels and IMAP folders
db.run(`
  CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    type TEXT DEFAULT 'user',
    remote_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, name)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_labels_account_id ON labels(account_id)`);

// Junction table for email-label associations
db.run(`
  CREATE TABLE IF NOT EXISTS email_labels (
    email_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (email_id, label_id),
    FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_email_labels_email_id ON email_labels(email_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_email_labels_label_id ON email_labels(label_id)`);

// Full-text search for emails
db.run(`
  CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
    subject,
    snippet,
    from_name,
    from_email,
    body_text,
    content='emails',
    content_rowid='rowid'
  )
`);

console.log("📦 Database initialized");

// Account operations
export const accountQueries = {
  getAll: db.prepare("SELECT * FROM accounts"),
  getById: db.prepare("SELECT * FROM accounts WHERE id = ?"),
  getByEmail: db.prepare("SELECT * FROM accounts WHERE email = ?"),

  upsert: db.prepare(`
    INSERT INTO accounts (id, email, name, access_token, refresh_token, token_expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      updated_at = unixepoch()
  `),

  delete: db.prepare("DELETE FROM accounts WHERE id = ?"),
};

// Email operations
export const emailQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_trashed = 0 AND is_archived = 0 AND snoozed_until IS NULL
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  getById: db.prepare("SELECT * FROM emails WHERE id = ?"),

  getByThread: db.prepare(`
    SELECT * FROM emails WHERE thread_id = ? ORDER BY received_at ASC
  `),

  search: db.prepare(`
    SELECT emails.* FROM emails_fts
    JOIN emails ON emails.rowid = emails_fts.rowid
    WHERE emails_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `),

  upsert: db.prepare(`
    INSERT INTO emails (
      id, account_id, thread_id, message_id, subject, snippet,
      from_name, from_email, to_addresses, cc_addresses, bcc_addresses,
      body_text, body_html, labels, is_read, is_starred, received_at, folder
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      subject = excluded.subject,
      snippet = excluded.snippet,
      labels = excluded.labels,
      is_read = excluded.is_read,
      is_starred = excluded.is_starred,
      folder = excluded.folder
  `),

  markRead: db.prepare("UPDATE emails SET is_read = 1 WHERE id = ?"),
  markUnread: db.prepare("UPDATE emails SET is_read = 0 WHERE id = ?"),
  star: db.prepare("UPDATE emails SET is_starred = 1 WHERE id = ?"),
  unstar: db.prepare("UPDATE emails SET is_starred = 0 WHERE id = ?"),
  archive: db.prepare("UPDATE emails SET is_archived = 1 WHERE id = ?"),
  unarchive: db.prepare("UPDATE emails SET is_archived = 0 WHERE id = ?"),
  trash: db.prepare("UPDATE emails SET is_trashed = 1, trashed_at = unixepoch() WHERE id = ?"),
  untrash: db.prepare("UPDATE emails SET is_trashed = 0, trashed_at = NULL WHERE id = ?"),

  delete: db.prepare("DELETE FROM emails WHERE id = ?"),

  getTrashed: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_trashed = 1
    ORDER BY trashed_at DESC
    LIMIT ? OFFSET ?
  `),

  // Delete emails that have been in trash for more than 30 days
  deleteOldTrashed: db.prepare(`
    DELETE FROM emails
    WHERE is_trashed = 1 AND trashed_at < unixepoch() - (30 * 24 * 60 * 60)
  `),

  // For reconciliation - get IDs of non-archived emails for an account
  getActiveIdsByAccount: db.prepare(`
    SELECT id FROM emails
    WHERE account_id = ? AND is_archived = 0 AND is_trashed = 0
  `),

  getStarred: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_starred = 1 AND is_trashed = 0
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  getSent: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND folder = 'sent' AND is_trashed = 0
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  getArchived: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_archived = 1 AND is_trashed = 0
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  getImportant: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_important = 1 AND is_trashed = 0 AND is_archived = 0 AND snoozed_until IS NULL
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  getOther: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND is_important = 0 AND is_trashed = 0 AND is_archived = 0 AND snoozed_until IS NULL
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `),

  markImportant: db.prepare("UPDATE emails SET is_important = 1 WHERE id = ?"),
  markNotImportant: db.prepare("UPDATE emails SET is_important = 0 WHERE id = ?"),

  // Snooze operations
  snooze: db.prepare("UPDATE emails SET snoozed_until = ? WHERE id = ?"),
  unsnooze: db.prepare("UPDATE emails SET snoozed_until = NULL WHERE id = ?"),

  getSnoozed: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND snoozed_until IS NOT NULL AND is_trashed = 0
    ORDER BY snoozed_until ASC
    LIMIT ? OFFSET ?
  `),

  // Get emails due to unsnooze (snoozed_until <= now)
  getDueToUnsnooze: db.prepare(`
    SELECT * FROM emails
    WHERE snoozed_until IS NOT NULL AND snoozed_until <= unixepoch()
  `),

  // Reminder operations
  setReminder: db.prepare("UPDATE emails SET remind_at = ? WHERE id = ?"),
  clearReminder: db.prepare("UPDATE emails SET remind_at = NULL WHERE id = ?"),

  getReminders: db.prepare(`
    SELECT * FROM emails
    WHERE account_id = ? AND remind_at IS NOT NULL AND is_trashed = 0
    ORDER BY remind_at ASC
    LIMIT ? OFFSET ?
  `),

  // Get emails with due reminders (remind_at <= now)
  getDueReminders: db.prepare(`
    SELECT * FROM emails
    WHERE remind_at IS NOT NULL AND remind_at <= unixepoch() AND is_trashed = 0
  `),
};

// Attachment operations
export const attachmentQueries = {
  getByEmailId: db.prepare("SELECT * FROM attachments WHERE email_id = ?"),

  getByContentId: db.prepare(`
    SELECT * FROM attachments
    WHERE email_id = ? AND content_id = ?
  `),

  insert: db.prepare(`
    INSERT OR IGNORE INTO attachments (id, email_id, content_id, filename, mime_type, size, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  delete: db.prepare("DELETE FROM attachments WHERE email_id = ?"),
};

// Draft operations
export const draftQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM drafts
    WHERE account_id = ?
    ORDER BY updated_at DESC
  `),

  getById: db.prepare("SELECT * FROM drafts WHERE id = ?"),

  upsert: db.prepare(`
    INSERT INTO drafts (id, account_id, remote_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, reply_mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      to_addresses = excluded.to_addresses,
      cc_addresses = excluded.cc_addresses,
      bcc_addresses = excluded.bcc_addresses,
      subject = excluded.subject,
      body = excluded.body,
      reply_to_id = excluded.reply_to_id,
      reply_mode = excluded.reply_mode,
      updated_at = unixepoch()
  `),

  delete: db.prepare("DELETE FROM drafts WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM drafts WHERE account_id = ?"),
};

// Label operations
export const labelQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM labels
    WHERE account_id = ?
    ORDER BY type DESC, name ASC
  `),

  getById: db.prepare("SELECT * FROM labels WHERE id = ?"),

  getByName: db.prepare(`
    SELECT * FROM labels WHERE account_id = ? AND name = ?
  `),

  getByRemoteId: db.prepare(`
    SELECT * FROM labels WHERE account_id = ? AND remote_id = ?
  `),

  insert: db.prepare(`
    INSERT INTO labels (id, account_id, name, color, type, remote_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  upsert: db.prepare(`
    INSERT INTO labels (id, account_id, name, color, type, remote_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, name) DO UPDATE SET
      color = COALESCE(excluded.color, labels.color),
      type = excluded.type,
      remote_id = COALESCE(excluded.remote_id, labels.remote_id)
  `),

  update: db.prepare(`
    UPDATE labels SET name = ?, color = ? WHERE id = ?
  `),

  delete: db.prepare("DELETE FROM labels WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM labels WHERE account_id = ?"),
};

// Pending sends table for undo send functionality
db.run(`
  CREATE TABLE IF NOT EXISTS pending_sends (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    to_addresses TEXT NOT NULL,
    cc_addresses TEXT,
    bcc_addresses TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    reply_to_id TEXT,
    attachments TEXT,
    send_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_pending_sends_send_at ON pending_sends(send_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_pending_sends_account_id ON pending_sends(account_id)`);

// Pending send operations
export const pendingSendQueries = {
  getById: db.prepare("SELECT * FROM pending_sends WHERE id = ?"),

  getReady: db.prepare(`
    SELECT * FROM pending_sends
    WHERE send_at <= unixepoch()
    ORDER BY send_at ASC
  `),

  insert: db.prepare(`
    INSERT INTO pending_sends (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, attachments, send_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  delete: db.prepare("DELETE FROM pending_sends WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM pending_sends WHERE account_id = ?"),
};

// Email-Label junction operations
export const emailLabelQueries = {
  getLabelsForEmail: db.prepare(`
    SELECT labels.* FROM labels
    JOIN email_labels ON labels.id = email_labels.label_id
    WHERE email_labels.email_id = ?
  `),

  getEmailsForLabel: db.prepare(`
    SELECT emails.* FROM emails
    JOIN email_labels ON emails.id = email_labels.email_id
    WHERE email_labels.label_id = ? AND emails.is_trashed = 0
    ORDER BY emails.received_at DESC
    LIMIT ? OFFSET ?
  `),

  addLabelToEmail: db.prepare(`
    INSERT OR IGNORE INTO email_labels (email_id, label_id)
    VALUES (?, ?)
  `),

  removeLabelFromEmail: db.prepare(`
    DELETE FROM email_labels WHERE email_id = ? AND label_id = ?
  `),

  removeAllLabelsFromEmail: db.prepare(`
    DELETE FROM email_labels WHERE email_id = ?
  `),

  countEmailsForLabel: db.prepare(`
    SELECT COUNT(*) as count FROM email_labels
    JOIN emails ON emails.id = email_labels.email_id
    WHERE email_labels.label_id = ? AND emails.is_trashed = 0
  `),
};
