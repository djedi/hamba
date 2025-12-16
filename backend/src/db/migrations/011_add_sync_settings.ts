import { Database } from "bun:sqlite";

/**
 * Migration: Add sync settings to accounts table
 * Version: 11
 *
 * Adds configurable sync settings per account:
 * - initial_sync_limit: Number of messages for fast initial sync (default 100)
 * - sync_all_mail: Whether to continue syncing all mail in background (default 0/false)
 * - sync_progress_total: Total messages on server
 * - sync_progress_synced: Messages synced so far
 * - last_full_sync_at: Timestamp when full sync was completed
 */

export function up(db: Database): void {
  // Add initial sync limit (default 100)
  db.run(`ALTER TABLE accounts ADD COLUMN initial_sync_limit INTEGER DEFAULT 100`);

  // Add sync all mail flag (default false)
  db.run(`ALTER TABLE accounts ADD COLUMN sync_all_mail INTEGER DEFAULT 0`);

  // Add sync progress tracking columns
  db.run(`ALTER TABLE accounts ADD COLUMN sync_progress_total INTEGER`);
  db.run(`ALTER TABLE accounts ADD COLUMN sync_progress_synced INTEGER`);
  db.run(`ALTER TABLE accounts ADD COLUMN last_full_sync_at INTEGER`);
}

export function down(db: Database): void {
  // SQLite doesn't support DROP COLUMN before version 3.35.0
  // So we need to recreate the table without these columns
  // For safety, we'll just leave the columns (they won't hurt anything)
  // In a production system, you'd want to do a full table recreation
}
