use super::*;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::get;
use axum::Router;
use regex::Regex;
use std::sync::LazyLock;

static SHORTCUT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap());

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
        .route("/by-shortcut/{shortcut}", get(by_shortcut))
}

fn validate_shortcut(shortcut: &str) -> Option<JsonResult> {
    if !SHORTCUT_RE.is_match(shortcut) {
        return Some(fail(
            "Shortcut can only contain letters, numbers, underscores, and hyphens",
        ));
    }
    if shortcut.chars().count() > 50 {
        return Some(fail("Shortcut must be 50 characters or less"));
    }
    None
}

async fn list(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    let conn = s.db.conn();
    match db::query_all(
        &conn,
        "SELECT * FROM snippets WHERE account_id = ? ORDER BY name ASC",
        [account_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn get_one(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    opt(db::query_one(&s.db.conn(), "SELECT * FROM snippets WHERE id = ?", [id])
        .ok()
        .flatten())
}

async fn by_shortcut(State(s): State<AppState>, Path(shortcut): Path<String>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    let conn = s.db.conn();
    opt(db::query_one(
        &conn,
        "SELECT * FROM snippets WHERE account_id = ? AND shortcut = ?",
        [account_id, &shortcut],
    )
    .ok()
    .flatten())
}

async fn create(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let (Some(account_id), Some(name), Some(shortcut), Some(content)) = (
        str_field(&body, "accountId"),
        str_field(&body, "name"),
        str_field(&body, "shortcut"),
        str_field(&body, "content"),
    ) else {
        return fail("accountId, name, shortcut, and content are required");
    };
    if let Some(err) = validate_shortcut(shortcut) {
        return err;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let conn = s.db.conn();
    match conn.execute(
        "INSERT INTO snippets (id, account_id, name, shortcut, content) VALUES (?, ?, ?, ?, ?)",
        (&id, account_id, name, shortcut, content),
    ) {
        Ok(_) => ok(json!({ "success": true, "id": id })),
        Err(e) if is_unique_violation(&e) => fail("A snippet with this shortcut already exists"),
        Err(e) => fail(e),
    }
}

async fn update(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    let conn = s.db.conn();
    let Some(snippet) = db::query_one(&conn, "SELECT * FROM snippets WHERE id = ?", [&id])
        .ok()
        .flatten()
    else {
        return fail("Snippet not found");
    };
    let shortcut = str_field(&body, "shortcut");
    if let Some(err) = shortcut.and_then(validate_shortcut) {
        return err;
    }
    let pick = |key: &str| {
        str_field(&body, key)
            .or_else(|| snippet[key].as_str())
            .unwrap_or("")
            .to_string()
    };
    match conn.execute(
        "UPDATE snippets SET name = ?, shortcut = ?, content = ?, updated_at = unixepoch() WHERE id = ?",
        (pick("name"), pick("shortcut"), pick("content"), &id),
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) if is_unique_violation(&e) => fail("A snippet with this shortcut already exists"),
        Err(e) => fail(e),
    }
}

async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let conn = s.db.conn();
    if db::query_one(&conn, "SELECT * FROM snippets WHERE id = ?", [&id])
        .ok()
        .flatten()
        .is_none()
    {
        return fail("Snippet not found");
    }
    match conn.execute("DELETE FROM snippets WHERE id = ?", [&id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}
