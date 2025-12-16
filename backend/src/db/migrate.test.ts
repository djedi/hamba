import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  migrate,
  rollback,
  status,
  getAppliedMigrations,
  loadMigrations,
  getPendingMigrations,
  createMigration,
} from "./migrate";

const TEST_DB_PATH = "test_migrate.db";
const TEST_MIGRATIONS_DIR = join(import.meta.dir, "migrations_test");

describe("Migration System", () => {
  let db: Database;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);

    // Clean up test migrations directory
    if (existsSync(TEST_MIGRATIONS_DIR)) {
      rmSync(TEST_MIGRATIONS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_MIGRATIONS_DIR)) {
      rmSync(TEST_MIGRATIONS_DIR, { recursive: true });
    }
  });

  test("getAppliedMigrations returns empty array for fresh database", () => {
    const applied = getAppliedMigrations(db);
    expect(applied).toEqual([]);
  });

  test("getAppliedMigrations creates _migrations table if not exists", () => {
    getAppliedMigrations(db);

    const tableExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
      )
      .get();

    expect(tableExists).not.toBeNull();
  });

  test("migrate runs pending migrations", async () => {
    // Load actual migrations from the migrations directory
    const count = await migrate(db);

    // Should have run at least the initial schema migration
    expect(count).toBeGreaterThan(0);

    // Check that migrations were recorded
    const applied = getAppliedMigrations(db);
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0].version).toBe(1);
    expect(applied[0].name).toBe("initial_schema");
  });

  test("migrate is idempotent", async () => {
    // Run migrations twice
    const count1 = await migrate(db);
    const count2 = await migrate(db);

    // First run should apply migrations, second should apply none
    expect(count1).toBeGreaterThan(0);
    expect(count2).toBe(0);
  });

  test("migrate creates all expected tables", async () => {
    await migrate(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    // Check for core tables
    expect(tableNames).toContain("accounts");
    expect(tableNames).toContain("emails");
    expect(tableNames).toContain("attachments");
    expect(tableNames).toContain("drafts");
    expect(tableNames).toContain("labels");
    expect(tableNames).toContain("email_labels");
    expect(tableNames).toContain("pending_sends");
    expect(tableNames).toContain("scheduled_emails");
    expect(tableNames).toContain("snippets");
    expect(tableNames).toContain("contacts");
    expect(tableNames).toContain("signatures");
    expect(tableNames).toContain("_migrations");
  });

  test("rollback removes last migration", async () => {
    await migrate(db);

    const appliedBefore = getAppliedMigrations(db);
    expect(appliedBefore.length).toBeGreaterThan(0);

    const rolledBack = await rollback(db, 1);
    expect(rolledBack).toBe(1);

    const appliedAfter = getAppliedMigrations(db);
    expect(appliedAfter.length).toBe(appliedBefore.length - 1);
  });

  test("rollback removes specified number of migrations", async () => {
    await migrate(db);

    const appliedBefore = getAppliedMigrations(db);
    const rollbackCount = Math.min(2, appliedBefore.length);

    const rolledBack = await rollback(db, rollbackCount);
    expect(rolledBack).toBe(rollbackCount);

    const appliedAfter = getAppliedMigrations(db);
    expect(appliedAfter.length).toBe(appliedBefore.length - rollbackCount);
  });

  test("loadMigrations loads migration files in order", async () => {
    const migrations = await loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);

    // Check they're sorted by version
    for (let i = 1; i < migrations.length; i++) {
      expect(migrations[i].version).toBeGreaterThan(migrations[i - 1].version);
    }

    // Check first migration is initial schema
    expect(migrations[0].version).toBe(1);
    expect(migrations[0].name).toBe("initial_schema");
  });

  test("getPendingMigrations returns only unapplied migrations", async () => {
    // Fresh database - all migrations should be pending
    const pendingBefore = await getPendingMigrations(db);
    expect(pendingBefore.length).toBeGreaterThan(0);

    // Apply migrations
    await migrate(db);

    // No migrations should be pending now
    const pendingAfter = await getPendingMigrations(db);
    expect(pendingAfter.length).toBe(0);
  });

  test("createMigration creates a new migration file", () => {
    // Create test migrations directory
    mkdirSync(TEST_MIGRATIONS_DIR, { recursive: true });

    // Mock the migrations directory for this test by creating a file there
    const migrationContent = `
import { Database } from "bun:sqlite";
export function up(db: Database): void {}
export function down(db: Database): void {}
`;
    writeFileSync(join(TEST_MIGRATIONS_DIR, "001_test.ts"), migrationContent);

    // Create a new migration
    const filepath = createMigration("add users table");

    expect(existsSync(filepath)).toBe(true);

    // The file should be in the actual migrations directory
    const content = Bun.file(filepath).text();
    expect(content).resolves.toContain("Migration: add users table");
  });

  test("migration up and down are reversible", async () => {
    // Run migrations
    await migrate(db);

    // Verify tables exist
    const tablesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
      .get();
    expect(tablesBefore).not.toBeNull();

    // Rollback all migrations
    const applied = getAppliedMigrations(db);
    await rollback(db, applied.length);

    // Verify core tables are gone (accounts should be dropped)
    const tablesAfter = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
      .get();
    expect(tablesAfter).toBeNull();
  });

  test("migration records include timestamp", async () => {
    const before = Math.floor(Date.now() / 1000);
    await migrate(db);
    const after = Math.floor(Date.now() / 1000);

    const applied = getAppliedMigrations(db);
    expect(applied.length).toBeGreaterThan(0);

    // Check that applied_at is within the expected range
    expect(applied[0].applied_at).toBeGreaterThanOrEqual(before);
    expect(applied[0].applied_at).toBeLessThanOrEqual(after);
  });
});

describe("Initial Schema Migration", () => {
  let db: Database;

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  test("creates accounts table with correct columns", async () => {
    await migrate(db);

    const columns = db
      .prepare("PRAGMA table_info(accounts)")
      .all() as { name: string; type: string }[];

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("email");
    expect(columnNames).toContain("provider_type");
    expect(columnNames).toContain("access_token");
    expect(columnNames).toContain("refresh_token");
    expect(columnNames).toContain("imap_host");
    expect(columnNames).toContain("smtp_host");
  });

  test("creates emails table with correct columns", async () => {
    await migrate(db);

    const columns = db
      .prepare("PRAGMA table_info(emails)")
      .all() as { name: string; type: string }[];

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("account_id");
    expect(columnNames).toContain("thread_id");
    expect(columnNames).toContain("subject");
    expect(columnNames).toContain("is_read");
    expect(columnNames).toContain("is_starred");
    expect(columnNames).toContain("is_archived");
    expect(columnNames).toContain("is_trashed");
    expect(columnNames).toContain("is_important");
    expect(columnNames).toContain("snoozed_until");
    expect(columnNames).toContain("remind_at");
    expect(columnNames).toContain("folder");
  });

  test("creates required indexes", async () => {
    await migrate(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_emails_account_id");
    expect(indexNames).toContain("idx_emails_thread_id");
    expect(indexNames).toContain("idx_emails_received_at");
    expect(indexNames).toContain("idx_attachments_email_id");
    expect(indexNames).toContain("idx_drafts_account_id");
  });

  test("creates FTS5 virtual table for search", async () => {
    await migrate(db);

    const fts = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='emails_fts'"
      )
      .get();

    expect(fts).not.toBeNull();
  });
});
