import { Database } from "bun:sqlite";
import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
  down: (db: Database) => void;
}

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: number;
}

const MIGRATIONS_DIR = join(dirname(import.meta.path), "migrations");

/**
 * Initialize the migrations tracking table
 */
function initMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER DEFAULT (unixepoch())
    )
  `);
}

/**
 * Get list of applied migrations from database
 */
export function getAppliedMigrations(db: Database): MigrationRecord[] {
  initMigrationsTable(db);
  return db.prepare("SELECT * FROM _migrations ORDER BY version ASC").all() as MigrationRecord[];
}

/**
 * Load migration files from the migrations directory
 */
export async function loadMigrations(): Promise<Migration[]> {
  if (!existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();

  const migrations: Migration[] = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.ts$/);
    if (!match) {
      console.warn(`Skipping invalid migration file: ${file}`);
      continue;
    }

    const version = parseInt(match[1], 10);
    const name = match[2];

    const module = await import(join(MIGRATIONS_DIR, file));

    if (typeof module.up !== "function" || typeof module.down !== "function") {
      throw new Error(`Migration ${file} must export 'up' and 'down' functions`);
    }

    migrations.push({
      version,
      name,
      up: module.up,
      down: module.down,
    });
  }

  return migrations;
}

/**
 * Get pending migrations that haven't been applied yet
 */
export async function getPendingMigrations(db: Database): Promise<Migration[]> {
  const applied = getAppliedMigrations(db);
  const appliedVersions = new Set(applied.map((m) => m.version));

  const allMigrations = await loadMigrations();
  return allMigrations.filter((m) => !appliedVersions.has(m.version));
}

/**
 * Apply a single migration
 */
function applyMigration(db: Database, migration: Migration): void {
  db.transaction(() => {
    migration.up(db);
    db.prepare("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(
      migration.version,
      migration.name
    );
  })();
}

/**
 * Rollback a single migration
 */
function rollbackMigration(db: Database, migration: Migration): void {
  db.transaction(() => {
    migration.down(db);
    db.prepare("DELETE FROM _migrations WHERE version = ?").run(migration.version);
  })();
}

/**
 * Run all pending migrations
 */
export async function migrate(db: Database): Promise<number> {
  initMigrationsTable(db);

  const pending = await getPendingMigrations(db);

  if (pending.length === 0) {
    console.log("✓ No pending migrations");
    return 0;
  }

  console.log(`Running ${pending.length} migration(s)...`);

  for (const migration of pending) {
    console.log(`  ↑ ${migration.version}_${migration.name}`);
    applyMigration(db, migration);
  }

  console.log(`✓ Applied ${pending.length} migration(s)`);
  return pending.length;
}

/**
 * Rollback the last N migrations
 */
export async function rollback(db: Database, count: number = 1): Promise<number> {
  initMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  if (applied.length === 0) {
    console.log("✓ No migrations to rollback");
    return 0;
  }

  const allMigrations = await loadMigrations();
  const migrationMap = new Map(allMigrations.map((m) => [m.version, m]));

  // Get the last N applied migrations in reverse order
  const toRollback = applied.slice(-count).reverse();

  console.log(`Rolling back ${toRollback.length} migration(s)...`);

  for (const record of toRollback) {
    const migration = migrationMap.get(record.version);
    if (!migration) {
      throw new Error(
        `Migration file for version ${record.version} (${record.name}) not found`
      );
    }

    console.log(`  ↓ ${migration.version}_${migration.name}`);
    rollbackMigration(db, migration);
  }

  console.log(`✓ Rolled back ${toRollback.length} migration(s)`);
  return toRollback.length;
}

/**
 * Show migration status
 */
export async function status(db: Database): Promise<void> {
  initMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const appliedVersions = new Set(applied.map((m) => m.version));

  const allMigrations = await loadMigrations();

  console.log("\nMigration Status:");
  console.log("─".repeat(50));

  if (allMigrations.length === 0) {
    console.log("  No migrations found");
    return;
  }

  for (const migration of allMigrations) {
    const isApplied = appliedVersions.has(migration.version);
    const record = applied.find((m) => m.version === migration.version);
    const appliedAt = record
      ? new Date(record.applied_at * 1000).toISOString()
      : "";

    const status = isApplied ? "✓" : "○";
    console.log(
      `  ${status} ${migration.version}_${migration.name}${appliedAt ? ` (${appliedAt})` : ""}`
    );
  }

  const pending = allMigrations.filter((m) => !appliedVersions.has(m.version));
  console.log("─".repeat(50));
  console.log(`  Applied: ${applied.length}  Pending: ${pending.length}\n`);
}

/**
 * Create a new migration file
 */
export function createMigration(name: string): string {
  // Get next version number
  const files = existsSync(MIGRATIONS_DIR) ? readdirSync(MIGRATIONS_DIR) : [];
  const versions = files
    .map((f) => {
      const match = f.match(/^(\d+)_/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((v) => v > 0);

  const nextVersion = versions.length > 0 ? Math.max(...versions) + 1 : 1;
  const paddedVersion = String(nextVersion).padStart(3, "0");

  // Sanitize name
  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const filename = `${paddedVersion}_${sanitizedName}.ts`;
  const filepath = join(MIGRATIONS_DIR, filename);

  const template = `import { Database } from "bun:sqlite";

/**
 * Migration: ${name}
 * Version: ${nextVersion}
 */

export function up(db: Database): void {
  // Add migration logic here
  // Example:
  // db.run(\`ALTER TABLE users ADD COLUMN age INTEGER\`);
}

export function down(db: Database): void {
  // Add rollback logic here
  // Example:
  // db.run(\`ALTER TABLE users DROP COLUMN age\`);
}
`;

  Bun.write(filepath, template);
  console.log(`Created migration: ${filename}`);
  return filepath;
}

// CLI entry point
if (import.meta.main) {
  const db = new Database("hamba.db");
  const command = process.argv[2] || "up";
  const arg = process.argv[3];

  switch (command) {
    case "up":
    case "migrate":
      await migrate(db);
      break;

    case "down":
    case "rollback":
      await rollback(db, arg ? parseInt(arg, 10) : 1);
      break;

    case "status":
      await status(db);
      break;

    case "create":
    case "new":
      if (!arg) {
        console.error("Usage: bun run migrate create <migration_name>");
        process.exit(1);
      }
      createMigration(arg);
      break;

    default:
      console.log(`
Database Migration Tool

Usage:
  bun run migrate [command]

Commands:
  up, migrate     Run all pending migrations (default)
  down, rollback  Rollback the last migration (or N migrations)
  status          Show migration status
  create, new     Create a new migration file

Examples:
  bun run migrate                    # Run pending migrations
  bun run migrate rollback           # Rollback last migration
  bun run migrate rollback 3         # Rollback last 3 migrations
  bun run migrate status             # Show status
  bun run migrate create add_users   # Create new migration
`);
      break;
  }

  db.close();
}
