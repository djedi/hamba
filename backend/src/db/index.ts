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

// Add summary columns for AI summarization
addColumnIfNotExists("emails", "summary", "TEXT");
addColumnIfNotExists("emails", "summary_generated_at", "INTEGER");

// Add AI importance classification columns
addColumnIfNotExists("emails", "ai_importance_score", "REAL");
addColumnIfNotExists("emails", "ai_classified_at", "INTEGER");

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

  // Advanced search with operators - executed dynamically
  advancedSearch: (params: {
    query?: string;
    from?: string;
    to?: string;
    subject?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    isStarred?: boolean;
    before?: number;
    after?: number;
    accountId?: string;
    limit?: number;
  }) => {
    const conditions: string[] = [];
    const values: any[] = [];

    // FTS query for general text search
    if (params.query) {
      conditions.push(`emails.rowid IN (
        SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?
      )`);
      values.push(params.query);
    }

    // From filter (email or name)
    if (params.from) {
      conditions.push(`(emails.from_email LIKE ? OR emails.from_name LIKE ?)`);
      const fromPattern = `%${params.from}%`;
      values.push(fromPattern, fromPattern);
    }

    // To filter
    if (params.to) {
      conditions.push(`emails.to_addresses LIKE ?`);
      values.push(`%${params.to}%`);
    }

    // Subject filter
    if (params.subject) {
      conditions.push(`emails.subject LIKE ?`);
      values.push(`%${params.subject}%`);
    }

    // Has attachment filter (requires subquery to attachments table)
    if (params.hasAttachment) {
      conditions.push(`emails.id IN (SELECT DISTINCT email_id FROM attachments)`);
    }

    // Unread filter
    if (params.isUnread !== undefined) {
      conditions.push(`emails.is_read = ?`);
      values.push(params.isUnread ? 0 : 1);
    }

    // Starred filter
    if (params.isStarred !== undefined) {
      conditions.push(`emails.is_starred = ?`);
      values.push(params.isStarred ? 1 : 0);
    }

    // Date filters
    if (params.before) {
      conditions.push(`emails.received_at < ?`);
      values.push(params.before);
    }

    if (params.after) {
      conditions.push(`emails.received_at > ?`);
      values.push(params.after);
    }

    // Account filter
    if (params.accountId) {
      conditions.push(`emails.account_id = ?`);
      values.push(params.accountId);
    }

    // Always exclude trashed emails from search results
    conditions.push(`emails.is_trashed = 0`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 50;

    const sql = `
      SELECT * FROM emails
      ${whereClause}
      ORDER BY received_at DESC
      LIMIT ?
    `;

    values.push(limit);

    return db.prepare(sql).all(...values);
  },

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

  // Summary operations
  setSummary: db.prepare("UPDATE emails SET summary = ?, summary_generated_at = unixepoch() WHERE id = ?"),
  clearSummary: db.prepare("UPDATE emails SET summary = NULL, summary_generated_at = NULL WHERE id = ?"),

  // AI importance classification operations
  setAiImportanceScore: db.prepare("UPDATE emails SET ai_importance_score = ?, ai_classified_at = unixepoch() WHERE id = ?"),
  clearAiImportanceScore: db.prepare("UPDATE emails SET ai_importance_score = NULL, ai_classified_at = NULL WHERE id = ?"),
  getUnclassifiedByAi: db.prepare(`
    SELECT id, account_id, from_email, from_name, subject, to_addresses, labels, snippet
    FROM emails
    WHERE account_id = ? AND folder = 'inbox' AND is_trashed = 0 AND ai_importance_score IS NULL
    ORDER BY received_at DESC
    LIMIT ?
  `),

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

  // Get the most recent email for an account (for notifications)
  getLatest: db.prepare(`
    SELECT from_name, from_email, subject, is_important FROM emails
    WHERE account_id = ? AND is_trashed = 0
    ORDER BY received_at DESC
    LIMIT 1
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

// Scheduled emails table for send later functionality
db.run(`
  CREATE TABLE IF NOT EXISTS scheduled_emails (
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

db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_emails_send_at ON scheduled_emails(send_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_scheduled_emails_account_id ON scheduled_emails(account_id)`);

// Scheduled email operations
export const scheduledEmailQueries = {
  getById: db.prepare("SELECT * FROM scheduled_emails WHERE id = ?"),

  getByAccount: db.prepare(`
    SELECT * FROM scheduled_emails
    WHERE account_id = ?
    ORDER BY send_at ASC
  `),

  getReady: db.prepare(`
    SELECT * FROM scheduled_emails
    WHERE send_at <= unixepoch()
    ORDER BY send_at ASC
  `),

  insert: db.prepare(`
    INSERT INTO scheduled_emails (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, attachments, send_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE scheduled_emails
    SET to_addresses = ?, cc_addresses = ?, bcc_addresses = ?, subject = ?, body = ?, reply_to_id = ?, attachments = ?, send_at = ?
    WHERE id = ?
  `),

  delete: db.prepare("DELETE FROM scheduled_emails WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM scheduled_emails WHERE account_id = ?"),
};

// Snippets table for email templates
db.run(`
  CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    shortcut TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, shortcut)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_snippets_account_id ON snippets(account_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_snippets_shortcut ON snippets(account_id, shortcut)`);

// Snippet operations
export const snippetQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM snippets
    WHERE account_id = ?
    ORDER BY name ASC
  `),

  getById: db.prepare("SELECT * FROM snippets WHERE id = ?"),

  getByShortcut: db.prepare(`
    SELECT * FROM snippets WHERE account_id = ? AND shortcut = ?
  `),

  insert: db.prepare(`
    INSERT INTO snippets (id, account_id, name, shortcut, content)
    VALUES (?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE snippets SET name = ?, shortcut = ?, content = ?, updated_at = unixepoch() WHERE id = ?
  `),

  delete: db.prepare("DELETE FROM snippets WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM snippets WHERE account_id = ?"),
};

// Contacts table for autocomplete
db.run(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    last_contacted INTEGER,
    contact_count INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, email)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_account_id ON contacts(account_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted ON contacts(last_contacted DESC)`);

// Contact operations
export const contactQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM contacts
    WHERE account_id = ?
    ORDER BY last_contacted DESC, contact_count DESC
  `),

  search: db.prepare(`
    SELECT * FROM contacts
    WHERE account_id = ? AND (
      email LIKE ? OR name LIKE ?
    )
    ORDER BY last_contacted DESC, contact_count DESC
    LIMIT ?
  `),

  getByEmail: db.prepare(`
    SELECT * FROM contacts WHERE account_id = ? AND email = ?
  `),

  upsert: db.prepare(`
    INSERT INTO contacts (id, account_id, email, name, last_contacted, contact_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(account_id, email) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      last_contacted = MAX(excluded.last_contacted, contacts.last_contacted),
      contact_count = contacts.contact_count + 1
  `),

  delete: db.prepare("DELETE FROM contacts WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM contacts WHERE account_id = ?"),
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
