//! API key management for the app UI (unauthenticated, like the rest of the internal API).
//! Keys authenticate the public read-only API in `routes/v1.rs`; only a SHA-256 hash is stored.

use super::*;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::{delete, get};
use axum::Router;
use sha2::{Digest, Sha256};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", delete(revoke))
}

pub fn hash_key(key: &str) -> String {
    Sha256::digest(key.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// `hamba_` + 64 random hex chars (two v4 UUIDs, URL-safe)
fn generate_key() -> String {
    format!("hamba_{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

async fn list(State(s): State<AppState>) -> JsonResult {
    match db::query_all(
        &s.db.conn(),
        "SELECT id, name, key_prefix AS keyPrefix, created_at AS createdAt, last_used_at AS lastUsedAt
         FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC, rowid DESC",
        [],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn create(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let Some(name) = str_field(&body, "name").map(str::trim).filter(|n| !n.is_empty()) else {
        return fail("name required");
    };
    let name: String = name.chars().take(100).collect();
    let key = generate_key();
    let id = uuid::Uuid::new_v4().to_string();
    let prefix: String = key.chars().take(12).collect();
    let created_at = db::now();
    let res = s.db.conn().execute(
        "INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        (&id, &name, &prefix, hash_key(&key), created_at),
    );
    match res {
        // The full key is returned only here; it can't be recovered later
        Ok(_) => ok(json!({
            "success": true, "id": id, "name": name, "keyPrefix": prefix,
            "createdAt": created_at, "key": key
        })),
        Err(e) => fail(e),
    }
}

async fn revoke(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    match s.db.conn().execute(
        "UPDATE api_keys SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL",
        [&id],
    ) {
        Ok(0) => fail("Key not found"),
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}
