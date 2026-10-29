ALTER TABLE accounts ADD COLUMN initial_sync_limit INTEGER DEFAULT 100;
ALTER TABLE accounts ADD COLUMN sync_all_mail INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN sync_progress_total INTEGER;
ALTER TABLE accounts ADD COLUMN sync_progress_synced INTEGER;
ALTER TABLE accounts ADD COLUMN last_full_sync_at INTEGER;
