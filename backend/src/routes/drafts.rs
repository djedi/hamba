use super::*;
use crate::providers::{get_provider, SyncOptions};
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(save))
        .route("/{id}", get(get_one).delete(remove))
        .route("/sync/{account_id}", post(sync))
}

async fn list(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    match db::query_all(
        &s.db.conn(),
        "SELECT * FROM drafts WHERE account_id = ? ORDER BY updated_at DESC",
        [account_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn get_one(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    opt(db::query_one(&s.db.conn(), "SELECT * FROM drafts WHERE id = ?", [id])
        .ok()
        .flatten())
}

async fn save(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let (Some(id), Some(account_id)) = (str_field(&body, "id"), str_field(&body, "accountId")) else {
        return ok(json!({ "error": "id and accountId are required" }));
    };
    let text = |key: &str| str_field(&body, key).unwrap_or("");
    match s.db.conn().execute(
        "INSERT INTO drafts (id, account_id, remote_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, reply_mode, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(id) DO UPDATE SET
           to_addresses = excluded.to_addresses,
           cc_addresses = excluded.cc_addresses,
           bcc_addresses = excluded.bcc_addresses,
           subject = excluded.subject,
           body = excluded.body,
           reply_to_id = excluded.reply_to_id,
           reply_mode = excluded.reply_mode,
           updated_at = unixepoch()",
        (
            id,
            account_id,
            text("to"),
            text("cc"),
            text("bcc"),
            text("subject"),
            text("body"),
            str_field(&body, "replyToId"),
            str_field(&body, "replyMode"),
        ),
    ) {
        Ok(_) => ok(json!({ "success": true, "id": id })),
        Err(e) => fail(e),
    }
}

async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    // Get draft to check if it has a remote_id
    let draft = db::query_one(&s.db.conn(), "SELECT * FROM drafts WHERE id = ?", [&id])
        .ok()
        .flatten();
    if let Some(draft) = draft {
        if let (Some(remote_id), Some(account_id)) = (draft["remote_id"].as_str(), draft["account_id"].as_str()) {
            // Continue to delete locally even if server delete fails
            match get_provider(&s, account_id) {
                Ok(p) => {
                    if let Err(e) = p.delete_draft(remote_id).await {
                        tracing::error!(error = %e, "Failed to delete draft from server");
                    }
                }
                Err(e) => tracing::error!(error = %e, "Failed to delete draft from server"),
            }
        }
    }
    match s.db.conn().execute("DELETE FROM drafts WHERE id = ?", [&id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn sync(State(s): State<AppState>, Path(account_id): Path<String>) -> JsonResult {
    match get_provider(&s, &account_id) {
        Ok(p) => ok(json!(p.sync_drafts(SyncOptions::default()).await)),
        Err(e) => ok(json!({ "error": e, "synced": 0, "total": 0 })),
    }
}
