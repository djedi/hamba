-- message_id was globally UNIQUE, so the same message in two local accounts
-- (e.g. sent from one, received by another) shared one row and the second
-- account's sync overwrote the first's folder. Make it unique per account.
CREATE TABLE emails_new (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      thread_id TEXT,
      message_id TEXT,
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
      UNIQUE (account_id, message_id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );
-- Keep rowids so the external-content emails_fts index stays aligned
INSERT INTO emails_new (rowid, id, account_id, thread_id, message_id, subject, snippet, from_name, from_email, to_addresses, cc_addresses, bcc_addresses, body_text, body_html, labels, is_read, is_starred, is_archived, is_trashed, is_important, trashed_at, snoozed_until, remind_at, summary, summary_generated_at, ai_importance_score, ai_classified_at, received_at, created_at, folder)
  SELECT rowid, id, account_id, thread_id, message_id, subject, snippet, from_name, from_email, to_addresses, cc_addresses, bcc_addresses, body_text, body_html, labels, is_read, is_starred, is_archived, is_trashed, is_important, trashed_at, snoozed_until, remind_at, summary, summary_generated_at, ai_importance_score, ai_classified_at, received_at, created_at, folder FROM emails;
DROP TABLE emails;
ALTER TABLE emails_new RENAME TO emails;
CREATE INDEX idx_emails_account_id ON emails(account_id);
CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE INDEX idx_emails_is_important ON emails(is_important);
CREATE INDEX idx_emails_snoozed_until ON emails(snoozed_until);
CREATE INDEX idx_emails_remind_at ON emails(remind_at);
