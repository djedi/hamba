use rusqlite::{types::ValueRef, Connection, Params, Row};
use serde_json::{Map, Number, Value};
use std::sync::{Arc, Mutex, MutexGuard};

/// Migrations, mirroring the TypeScript backend's `_migrations` versions so
/// existing databases are picked up without re-running anything.
const MIGRATIONS: &[(i64, &str, &str)] = &[
    (1, "initial_schema", include_str!("migrations/001_initial_schema.sql")),
    (2, "add_users_table", ""),
    (3, "add_users_table", ""),
    (4, "add_users_table", ""),
    (5, "add_users_table", ""),
    (6, "add_users_table", ""),
    (7, "add_users_table", ""),
    (8, "add_users_table", ""),
    (9, "add_users_table", ""),
    (10, "add_users_table", ""),
    (
        11,
        "add_sync_settings",
        include_str!("migrations/011_add_sync_settings.sql"),
    ),
    (
        12,
        "message_id_per_account",
        include_str!("migrations/012_message_id_per_account.sql"),
    ),
    (
        13,
        "account_appearance",
        include_str!("migrations/013_account_appearance.sql"),
    ),
];

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    /// Open the database and apply any pending migrations
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let db = Db(Arc::new(Mutex::new(conn)));
        db.migrate()?;
        Ok(db)
    }

    /// `(version, name, applied_at)` for every known migration; `applied_at` is None if pending
    pub fn migration_status(&self) -> rusqlite::Result<Vec<(i64, &'static str, Option<i64>)>> {
        let conn = self.conn();
        MIGRATIONS
            .iter()
            .map(|(version, name, _)| {
                let applied = conn
                    .query_row("SELECT applied_at FROM _migrations WHERE version = ?", [version], |r| {
                        r.get(0)
                    })
                    .ok();
                Ok((*version, *name, applied))
            })
            .collect()
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let table_exists = |conn: &Connection, name: &str| -> rusqlite::Result<bool> {
            conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                [name],
                |r| r.get::<_, i64>(0),
            )
            .map(|c| c > 0)
        };
        let has_migrations = table_exists(&conn, "_migrations")?;
        let has_accounts = table_exists(&conn, "accounts")?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
               version INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               applied_at INTEGER DEFAULT (unixepoch())
             )",
        )?;
        if !has_migrations && has_accounts {
            // Pre-migration database: tables already exist, mark the baseline as applied
            tracing::info!("Bootstrapping existing database with migration system");
            conn.execute(
                "INSERT INTO _migrations (version, name) VALUES (1, 'initial_schema')",
                [],
            )?;
        }

        for (version, name, sql) in MIGRATIONS {
            let applied: i64 =
                conn.query_row("SELECT COUNT(*) FROM _migrations WHERE version = ?", [version], |r| {
                    r.get(0)
                })?;
            if applied > 0 {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO _migrations (version, name) VALUES (?, ?)", (version, name))?;
            tx.commit()?;
            tracing::info!(version, name, "Applied migration");
        }
        Ok(())
    }
}

/// Convert a row to a JSON object keyed by column name (same shape as `SELECT *` in bun:sqlite).
pub fn row_to_json(row: &Row) -> rusqlite::Result<Value> {
    let stmt = row.as_ref();
    let mut map = Map::with_capacity(stmt.column_count());
    for i in 0..stmt.column_count() {
        let v = match row.get_ref(i)? {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(n) => Value::Number(n.into()),
            ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
            ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(b) => Value::Array(b.iter().map(|x| Value::from(*x)).collect()),
        };
        map.insert(stmt.column_name(i)?.to_string(), v);
    }
    Ok(Value::Object(map))
}

pub fn query_all<P: Params>(conn: &Connection, sql: &str, params: P) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let rows = stmt.query_map(params, row_to_json)?;
    rows.collect()
}

pub fn query_one<P: Params>(conn: &Connection, sql: &str, params: P) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let mut rows = stmt.query(params)?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_json(row)?)),
        None => Ok(None),
    }
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
