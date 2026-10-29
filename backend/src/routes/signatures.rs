use super::*;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
        .route("/default/{account_id}", get(get_default))
        .route("/{id}/default", post(set_default).delete(clear_default))
}

fn find(conn: &rusqlite::Connection, id: &str) -> Option<Value> {
    db::query_one(conn, "SELECT * FROM signatures WHERE id = ?", [id])
        .ok()
        .flatten()
}

async fn list(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    match db::query_all(
        &s.db.conn(),
        "SELECT * FROM signatures WHERE account_id = ? ORDER BY is_default DESC, name ASC",
        [account_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn get_one(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    opt(find(&s.db.conn(), &id))
}

async fn get_default(State(s): State<AppState>, Path(account_id): Path<String>) -> JsonResult {
    opt(db::query_one(
        &s.db.conn(),
        "SELECT * FROM signatures WHERE account_id = ? AND is_default = 1 LIMIT 1",
        [account_id],
    )
    .ok()
    .flatten())
}

async fn create(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let account_id = str_field(&body, "accountId");
    let name = str_field(&body, "name");
    let content = body.get("content").and_then(Value::as_str);
    let (Some(account_id), Some(name), Some(content)) = (account_id, name, content) else {
        return fail("accountId, name, and content are required");
    };
    if name.chars().count() > 100 {
        return fail("Signature name must be 100 characters or less");
    }
    let is_html = body["isHtml"].as_bool().unwrap_or(false);
    let is_default = body["isDefault"].as_bool().unwrap_or(false);
    let id = uuid::Uuid::new_v4().to_string();
    let conn = s.db.conn();
    let result = (|| {
        // If this is set as default, clear other defaults first
        if is_default {
            conn.execute(
                "UPDATE signatures SET is_default = 0 WHERE account_id = ?",
                [account_id],
            )?;
        }
        conn.execute(
            "INSERT INTO signatures (id, account_id, name, content, is_html, is_default) VALUES (?, ?, ?, ?, ?, ?)",
            (&id, account_id, name, content, is_html as i64, is_default as i64),
        )
    })();
    match result {
        Ok(_) => ok(json!({ "success": true, "id": id })),
        Err(e) => fail(e),
    }
}

async fn update(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    let conn = s.db.conn();
    let Some(sig) = find(&conn, &id) else {
        return fail("Signature not found");
    };
    if let Some(name) = str_field(&body, "name") {
        if name.chars().count() > 100 {
            return fail("Signature name must be 100 characters or less");
        }
    }
    // `??` semantics: empty strings are allowed, only missing/null falls back
    let name = body["name"].as_str().or(sig["name"].as_str()).unwrap_or("");
    let content = body["content"].as_str().or(sig["content"].as_str()).unwrap_or("");
    let is_html = match body["isHtml"].as_bool() {
        Some(b) => b as i64,
        None => sig["is_html"].as_i64().unwrap_or(0),
    };
    match conn.execute(
        "UPDATE signatures SET name = ?, content = ?, is_html = ?, updated_at = unixepoch() WHERE id = ?",
        (name, content, is_html, &id),
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn set_default(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let conn = s.db.conn();
    let Some(sig) = find(&conn, &id) else {
        return fail("Signature not found");
    };
    match conn.execute(
        "UPDATE signatures SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE account_id = ?",
        (&id, sig["account_id"].as_str()),
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn clear_default(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let conn = s.db.conn();
    let Some(sig) = find(&conn, &id) else {
        return fail("Signature not found");
    };
    match conn.execute(
        "UPDATE signatures SET is_default = 0 WHERE account_id = ?",
        [sig["account_id"].as_str()],
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let conn = s.db.conn();
    if find(&conn, &id).is_none() {
        return fail("Signature not found");
    }
    match conn.execute("DELETE FROM signatures WHERE id = ?", [&id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}
