import { Database } from "bun:sqlite";

/**
 * Migration: add users table
 * Version: 2
 */

export function up(db: Database): void {
  // Add migration logic here
  // Example:
  // db.run(`ALTER TABLE users ADD COLUMN age INTEGER`);
}

export function down(db: Database): void {
  // Add rollback logic here
  // Example:
  // db.run(`ALTER TABLE users DROP COLUMN age`);
}
