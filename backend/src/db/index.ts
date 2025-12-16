import { Database } from "bun:sqlite";
import { migrate, getAppliedMigrations } from "./migrate";

// Support DATABASE_PATH env var for Docker deployments
const databasePath = process.env.DATABASE_PATH || "hamba.db";
export const db = new Database(databasePath);

/**
 * Initialize the database using the migration system.
 *
 * For existing databases:
 * - If _migrations table doesn't exist but other tables do, we assume
 *   the database was created before the migration system was added.
 *   We bootstrap by marking the initial migration as applied.
 *
 * For new databases:
 * - Run all migrations to create the schema.
 */
async function initializeDatabase(): Promise<void> {
  // Check if _migrations table exists
  const hasMigrations =
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
      )
      .get() !== null;

  // Check if accounts table exists (indicator of pre-migration database)
  const hasAccounts =
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
      )
      .get() !== null;

  if (!hasMigrations && hasAccounts) {
    // Existing database without migration tracking - bootstrap it
    console.log("📦 Bootstrapping existing database with migration system...");

    // Create migrations table
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER DEFAULT (unixepoch())
      )
    `);

    // Mark initial schema migration as applied since tables already exist
    db.run(
      "INSERT INTO _migrations (version, name) VALUES (1, 'initial_schema')"
    );

    console.log("✓ Database bootstrapped with migration tracking");
  }

  // Run any pending migrations
  const count = await migrate(db);
  if (count === 0 && !hasMigrations && !hasAccounts) {
    // Fresh database - migrations ran
    console.log("📦 Database initialized");
  }
}

// Initialize database on module load
await initializeDatabase();

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

  updateSettings: db.prepare(`
    UPDATE accounts
    SET display_name = ?,
        sync_frequency_seconds = ?,
        updated_at = unixepoch()
    WHERE id = ?
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

  // For reconciliation - get message_ids of non-archived inbox emails for an account
  // Uses message_id (RFC Message-ID header) which is stable across folder moves
  getActiveMessageIdsByAccount: db.prepare(`
    SELECT id, message_id FROM emails
    WHERE account_id = ? AND is_archived = 0 AND is_trashed = 0 AND folder = 'inbox'
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

  // Summary operations
  setSummary: db.prepare("UPDATE emails SET summary = ?, summary_generated_at = unixepoch() WHERE id = ?"),
  clearSummary: db.prepare("UPDATE emails SET summary = NULL, summary_generated_at = NULL WHERE id = ?"),

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

// Signature operations
export const signatureQueries = {
  getByAccount: db.prepare(`
    SELECT * FROM signatures
    WHERE account_id = ?
    ORDER BY is_default DESC, name ASC
  `),

  getById: db.prepare("SELECT * FROM signatures WHERE id = ?"),

  getDefault: db.prepare(`
    SELECT * FROM signatures
    WHERE account_id = ? AND is_default = 1
    LIMIT 1
  `),

  insert: db.prepare(`
    INSERT INTO signatures (id, account_id, name, content, is_html, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE signatures SET name = ?, content = ?, is_html = ?, updated_at = unixepoch() WHERE id = ?
  `),

  setDefault: db.prepare(`
    UPDATE signatures SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END
    WHERE account_id = ?
  `),

  clearDefault: db.prepare(`
    UPDATE signatures SET is_default = 0 WHERE account_id = ?
  `),

  delete: db.prepare("DELETE FROM signatures WHERE id = ?"),

  deleteByAccount: db.prepare("DELETE FROM signatures WHERE account_id = ?"),
};

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
