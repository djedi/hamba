CREATE TABLE IF NOT EXISTS email_tracking (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  email_id TEXT,
  message_id TEXT,
  recipients TEXT,
  subject TEXT,
  track_opens INTEGER NOT NULL DEFAULT 1,
  track_links INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_tracking_email_id ON email_tracking(email_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_account_id ON email_tracking(account_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'click')),
  url TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (tracking_id) REFERENCES email_tracking(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking_id ON tracking_events(tracking_id);

CREATE TABLE IF NOT EXISTS tracking_links (
  id TEXT PRIMARY KEY,
  tracking_id TEXT NOT NULL,
  url TEXT NOT NULL,
  FOREIGN KEY (tracking_id) REFERENCES email_tracking(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tracking_links_tracking_id ON tracking_links(tracking_id);

ALTER TABLE pending_sends ADD COLUMN track_opens INTEGER DEFAULT 0;
ALTER TABLE pending_sends ADD COLUMN track_links INTEGER DEFAULT 0;
ALTER TABLE scheduled_emails ADD COLUMN track_opens INTEGER DEFAULT 0;
ALTER TABLE scheduled_emails ADD COLUMN track_links INTEGER DEFAULT 0;
