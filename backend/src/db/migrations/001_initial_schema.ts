import { Database } from "bun:sqlite";

/**
 * Migration: Initial Schema
 * Version: 1
 *
 * This is the baseline migration that captures the existing database schema.
 * It creates all core tables: accounts, emails, attachments, drafts, labels,
 * email_labels, pending_sends, scheduled_emails, snippets, contacts, signatures,
 * and the FTS5 virtual table for search.
 */

export function up(db: Database): void {
  // Accounts table
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
      username TEXT,
      display_name TEXT,
      sync_frequency_seconds INTEGER DEFAULT 60,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Emails table
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
      trashed_at INTEGER,
      snoozed_until INTEGER,
      remind_at INTEGER,
      summary TEXT,
      summary_generated_at INTEGER,
      ai_importance_score REAL,
      ai_classified_at INTEGER,
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

  // Attachments table
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

  // Drafts table
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

  // Labels table
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

  // Scheduled emails table
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

  // Signatures table for email signatures
  db.run(`
    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_html INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_signatures_account_id ON signatures(account_id)`);
}

export function down(db: Database): void {
  // Drop tables in reverse order of dependencies
  db.run(`DROP TABLE IF EXISTS signatures`);
  db.run(`DROP TABLE IF EXISTS contacts`);
  db.run(`DROP TABLE IF EXISTS snippets`);
  db.run(`DROP TABLE IF EXISTS scheduled_emails`);
  db.run(`DROP TABLE IF EXISTS pending_sends`);
  db.run(`DROP TABLE IF EXISTS emails_fts`);
  db.run(`DROP TABLE IF EXISTS email_labels`);
  db.run(`DROP TABLE IF EXISTS labels`);
  db.run(`DROP TABLE IF EXISTS drafts`);
  db.run(`DROP TABLE IF EXISTS attachments`);
  db.run(`DROP TABLE IF EXISTS emails`);
  db.run(`DROP TABLE IF EXISTS accounts`);
}
