use super::*;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", get(get_one).put(update).delete(remove))
        .route("/{id}/emails", get(emails_for_label))
        .route("/{id}/count", get(count))
        .route("/{id}/emails/{email_id}", post(add_to_email).delete(remove_from_email))
        .route("/email/{email_id}", get(labels_for_email))
}

fn find(conn: &rusqlite::Connection, id: &str) -> Option<Value> {
    db::query_one(conn, "SELECT * FROM labels WHERE id = ?", [id])
        .ok()
        .flatten()
}

async fn list(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    match db::query_all(
        &s.db.conn(),
        "SELECT * FROM labels WHERE account_id = ? ORDER BY type DESC, name ASC",
        [account_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn get_one(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    opt(find(&s.db.conn(), &id))
}

async fn emails_for_label(State(s): State<AppState>, Path(id): Path<String>, Query(q): QueryMap) -> JsonResult {
    let limit = parse_i64(&q, "limit", 50);
    let offset = parse_i64(&q, "offset", 0);
    match db::query_all(
        &s.db.conn(),
        "SELECT emails.* FROM emails
         JOIN email_labels ON emails.id = email_labels.email_id
         WHERE email_labels.label_id = ? AND emails.is_trashed = 0
         ORDER BY emails.received_at DESC
         LIMIT ? OFFSET ?",
        (&id, limit, offset),
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn count(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let count: i64 =
        s.db.conn()
            .query_row(
                "SELECT COUNT(*) FROM email_labels
             JOIN emails ON emails.id = email_labels.email_id
             WHERE email_labels.label_id = ? AND emails.is_trashed = 0",
                [&id],
                |r| r.get(0),
            )
            .unwrap_or(0);
    ok(json!({ "count": count }))
}

async fn create(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let (Some(account_id), Some(name)) = (str_field(&body, "accountId"), str_field(&body, "name")) else {
        return fail("accountId and name are required");
    };
    let color = str_field(&body, "color").unwrap_or("#6366f1");
    let id = uuid::Uuid::new_v4().to_string();
    match s.db.conn().execute(
        "INSERT INTO labels (id, account_id, name, color, type, remote_id) VALUES (?, ?, ?, ?, 'user', NULL)",
        (&id, account_id, name, color),
    ) {
        Ok(_) => ok(json!({ "success": true, "id": id })),
        Err(e) if is_unique_violation(&e) => fail("Label already exists"),
        Err(e) => fail(e),
    }
}

async fn update(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    let conn = s.db.conn();
    let Some(label) = find(&conn, &id) else {
        return fail("Label not found");
    };
    let name = str_field(&body, "name").or(label["name"].as_str());
    let color = str_field(&body, "color").or(label["color"].as_str());
    match conn.execute("UPDATE labels SET name = ?, color = ? WHERE id = ?", (name, color, &id)) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let conn = s.db.conn();
    if find(&conn, &id).is_none() {
        return fail("Label not found");
    }
    match conn.execute("DELETE FROM labels WHERE id = ?", [&id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn add_to_email(State(s): State<AppState>, Path((id, email_id)): Path<(String, String)>) -> JsonResult {
    match s.db.conn().execute(
        "INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)",
        (&email_id, &id),
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn remove_from_email(State(s): State<AppState>, Path((id, email_id)): Path<(String, String)>) -> JsonResult {
    match s.db.conn().execute(
        "DELETE FROM email_labels WHERE email_id = ? AND label_id = ?",
        (&email_id, &id),
    ) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn labels_for_email(State(s): State<AppState>, Path(email_id): Path<String>) -> JsonResult {
    match db::query_all(
        &s.db.conn(),
        "SELECT labels.* FROM labels
         JOIN email_labels ON labels.id = email_labels.label_id
         WHERE email_labels.email_id = ?",
        [&email_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}
