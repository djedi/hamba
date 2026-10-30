//! Public read-only API (`/api/v1`), authenticated with `Authorization: Bearer hamba_...`.
//! Documented in `openapi_v1.json` and rendered at `/docs`.

use super::api_keys::hash_key;
use super::emails::fts_query;
use super::*;
use crate::AppState;
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::types::Value as Sql;
use rusqlite::Row;

const MAX_LIMIT: i64 = 100;
const DEFAULT_LIMIT: i64 = 25;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/accounts", get(accounts))
        .route("/emails", get(list_emails))
        .route("/emails/{id}", get(get_email))
        .route("/emails/{id}/attachments/{attachment_id}", get(attachment))
        .route("/threads/{thread_id}", get(thread))
        .route("/search", get(search))
        .route_layer(axum::middleware::from_fn_with_state(state, require_key))
}

fn api_error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({ "error": { "code": code, "message": message } }))).into_response()
}

async fn require_key(State(s): State<AppState>, req: Request, next: Next) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")))
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let Some(token) = token else {
        return api_error(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Missing Authorization: Bearer <api key> header",
        );
    };
    // Lookup by SHA-256 hash: the raw key is never compared or stored
    let valid = {
        let conn = s.db.conn();
        conn.query_row(
            "SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
            [hash_key(token)],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .inspect(|id| {
            let _ = conn.execute("UPDATE api_keys SET last_used_at = unixepoch() WHERE id = ?", [id]);
        })
        .is_some()
    };
    if !valid {
        return api_error(StatusCode::UNAUTHORIZED, "unauthorized", "Invalid or revoked API key");
    }
    next.run(req).await
}

// ---------- Shaping ----------

fn iso(ts: i64) -> Value {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .map(|d| json!(d.to_rfc3339_opts(SecondsFormat::Secs, true)))
        .unwrap_or(Value::Null)
}

/// Split an address header ("A <a@x>, b@y") on commas outside quotes and angle brackets
fn split_addresses(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut quoted, mut angle) = (Vec::new(), String::new(), false, false);
    for c in s.chars() {
        match c {
            '"' => quoted = !quoted,
            '<' if !quoted => angle = true,
            '>' if !quoted => angle = false,
            ',' if !quoted && !angle => {
                out.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    out.push(cur);
    out.into_iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect()
}

fn parse_labels(s: Option<String>) -> Vec<String> {
    s.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok()).unwrap_or_default()
}

const LIST_COLS: &str = "e.id, e.account_id, e.thread_id, e.subject, e.from_name, e.from_email, e.to_addresses,
    e.cc_addresses, e.snippet, e.received_at, e.is_read, e.is_starred, e.labels, e.folder,
    EXISTS(SELECT 1 FROM attachments a WHERE a.email_id = e.id)";

fn summary(r: &Row) -> rusqlite::Result<Value> {
    let s = |i: usize| r.get::<_, Option<String>>(i);
    let received: i64 = r.get::<_, Option<i64>>(9)?.unwrap_or(0);
    Ok(json!({
        "id": s(0)?,
        "accountId": s(1)?,
        "threadId": s(2)?,
        "subject": s(3)?.unwrap_or_default(),
        "from": { "name": s(4)?.filter(|n| !n.is_empty()), "email": s(5)?.unwrap_or_default() },
        "to": split_addresses(&s(6)?.unwrap_or_default()),
        "cc": split_addresses(&s(7)?.unwrap_or_default()),
        "snippet": s(8)?.unwrap_or_default(),
        "receivedAt": iso(received),
        "receivedAtUnix": received,
        "isRead": r.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
        "isStarred": r.get::<_, Option<i64>>(11)?.unwrap_or(0) != 0,
        "labels": parse_labels(s(12)?),
        "folder": s(13)?.unwrap_or_else(|| "inbox".into()),
        "hasAttachments": r.get::<_, i64>(14)? != 0,
    }))
}

/// Add `tracking: { opens, clicks, firstOpenedAt, lastOpenedAt }` to sent messages that have it
fn add_tracking(conn: &rusqlite::Connection, rows: &mut [Value]) {
    crate::services::tracking::attach(conn, rows);
    for row in rows.iter_mut() {
        let Some(t) = row.get("tracking").cloned() else { continue };
        let ts = |k: &str| t[k].as_i64().map(iso).unwrap_or(Value::Null);
        row["tracking"] = json!({
            "opens": t["opens"],
            "clicks": t["clicks"],
            "firstOpenedAt": ts("firstOpenedAt"),
            "lastOpenedAt": ts("lastOpenedAt"),
            "lastClickedAt": ts("lastClickedAt"),
        });
    }
}

fn limit_offset(q: &HashMap<String, String>) -> (i64, i64) {
    (
        parse_i64(q, "limit", DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
        parse_i64(q, "offset", 0).max(0),
    )
}

/// Run a summary query ending in `LIMIT ? OFFSET ?`; fetches one extra row to compute `hasMore`
fn page(state: &AppState, sql: &str, mut values: Vec<Sql>, limit: i64, offset: i64) -> Response {
    values.push(Sql::Integer(limit + 1));
    values.push(Sql::Integer(offset));
    let rows = {
        let conn = state.db.conn();
        conn.prepare(sql)
            .and_then(|mut st| {
                st.query_map(rusqlite::params_from_iter(values), summary)?
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .map(|mut rows| {
                add_tracking(&conn, &mut rows);
                rows
            })
    };
    match rows {
        Ok(mut rows) => {
            let has_more = rows.len() as i64 > limit;
            rows.truncate(limit as usize);
            Json(json!({ "data": rows, "pagination": { "limit": limit, "offset": offset, "hasMore": has_more } }))
                .into_response()
        }
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &e.to_string()),
    }
}

/// Accepts unix seconds or ISO 8601 (`2025-01-31` or RFC 3339)
fn parse_since(v: &str) -> Option<i64> {
    v.parse::<i64>()
        .ok()
        .or_else(|| DateTime::parse_from_rfc3339(v).ok().map(|d| d.timestamp()))
        .or_else(|| {
            NaiveDate::parse_from_str(v, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|d| d.and_utc().timestamp())
        })
}

fn like_escape(s: &str) -> String {
    format!("%{}%", s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"))
}

/// Every word must appear in subject, sender or body
fn like_condition(text: &str, values: &mut Vec<Sql>) -> String {
    let parts: Vec<String> = text
        .split_whitespace()
        .map(|w| {
            for _ in 0..4 {
                values.push(Sql::Text(like_escape(w)));
            }
            "(e.subject LIKE ? ESCAPE '\\' OR e.from_name LIKE ? ESCAPE '\\' OR e.from_email LIKE ? ESCAPE '\\' OR e.body_text LIKE ? ESCAPE '\\')".to_string()
        })
        .collect();
    if parts.is_empty() {
        "1=1".into()
    } else {
        parts.join(" AND ")
    }
}

// ---------- Handlers ----------

async fn accounts(State(s): State<AppState>) -> Response {
    let rows = {
        let conn = s.db.conn();
        let unread = crate::emails_db::unread_counts(&conn);
        conn.prepare("SELECT id, email, display_name, name, provider_type FROM accounts ORDER BY rowid")
            .and_then(|mut st| {
                st.query_map([], |r| {
                    let id: String = r.get(0)?;
                    let display = r.get::<_, Option<String>>(2)?.filter(|n| !n.is_empty());
                    let name = r.get::<_, Option<String>>(3)?.filter(|n| !n.is_empty());
                    Ok(json!({
                        "id": id,
                        "email": r.get::<_, String>(1)?,
                        "displayName": display.or(name),
                        "providerType": r.get::<_, Option<String>>(4)?,
                        "unreadCount": unread.get(&id).copied().unwrap_or(0),
                    }))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
            })
    };
    match rows {
        Ok(rows) => Json(json!({ "data": rows })).into_response(),
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &e.to_string()),
    }
}

async fn list_emails(State(s): State<AppState>, Query(q): QueryMap) -> Response {
    let (limit, offset) = limit_offset(&q);
    let mut conds: Vec<String> = Vec::new();
    let mut values: Vec<Sql> = Vec::new();
    if let Some(a) = q.get("accountId").filter(|v| !v.is_empty()) {
        conds.push("e.account_id = ?".into());
        values.push(Sql::Text(a.clone()));
    }
    match q.get("folder").map(String::as_str).filter(|v| !v.is_empty()) {
        Some("trash") => conds.push("e.is_trashed = 1".into()),
        Some("archive") => conds.push("e.is_archived = 1 AND e.is_trashed = 0".into()),
        Some("starred") => conds.push("e.is_starred = 1 AND e.is_trashed = 0".into()),
        Some(f) => {
            conds.push("e.folder = ? AND e.is_trashed = 0".into());
            values.push(Sql::Text(f.to_string()));
            if f == "inbox" {
                conds.push("e.is_archived = 0".into());
            }
        }
        None => conds.push("e.is_trashed = 0".into()),
    }
    if q.get("unread").map(String::as_str) == Some("true") {
        conds.push("e.is_read = 0".into());
    }
    if let Some(since) = q.get("since").filter(|v| !v.is_empty()) {
        let Some(ts) = parse_since(since) else {
            return api_error(StatusCode::BAD_REQUEST, "invalid_request", "since must be unix seconds or ISO 8601");
        };
        conds.push("e.received_at >= ?".into());
        values.push(Sql::Integer(ts));
    }
    if let Some(text) = q.get("q").filter(|v| !v.trim().is_empty()) {
        let c = like_condition(text, &mut values);
        conds.push(c);
    }
    let sql = format!(
        "SELECT {LIST_COLS} FROM emails e WHERE {} ORDER BY e.received_at DESC, e.rowid DESC LIMIT ? OFFSET ?",
        conds.join(" AND ")
    );
    page(&s, &sql, values, limit, offset)
}

fn attachments_of(conn: &rusqlite::Connection, email_id: &str) -> Vec<Value> {
    conn.prepare("SELECT id, filename, mime_type, size, content_id FROM attachments WHERE email_id = ? ORDER BY rowid")
        .and_then(|mut st| {
            st.query_map([email_id], |r| {
                let id: String = r.get(0)?;
                Ok(json!({
                    "id": id,
                    "filename": r.get::<_, Option<String>>(1)?,
                    "mimeType": r.get::<_, Option<String>>(2)?,
                    "size": r.get::<_, Option<i64>>(3)?,
                    "contentId": r.get::<_, Option<String>>(4)?,
                    "url": format!("/api/v1/emails/{email_id}/attachments/{id}"),
                }))
            })?
            .collect()
        })
        .unwrap_or_default()
}

/// Full messages (bodies + attachment metadata) matching `where_sql` (one `?` bound to `arg`)
fn full_messages(conn: &rusqlite::Connection, where_sql: &str, arg: &str) -> rusqlite::Result<Vec<Value>> {
    let sql = format!("SELECT {LIST_COLS}, e.bcc_addresses, e.body_text, e.body_html FROM emails e WHERE {where_sql}");
    let mut msgs = conn
        .prepare(&sql)?
        .query_map([arg], |r| {
            let mut v = summary(r)?;
            v["bcc"] = json!(split_addresses(&r.get::<_, Option<String>>(15)?.unwrap_or_default()));
            v["bodyText"] = json!(r.get::<_, Option<String>>(16)?.unwrap_or_default());
            v["bodyHtml"] = json!(r.get::<_, Option<String>>(17)?.unwrap_or_default());
            Ok(v)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for m in &mut msgs {
        let id = m["id"].as_str().unwrap_or_default().to_string();
        m["attachments"] = json!(attachments_of(conn, &id));
    }
    Ok(msgs)
}

async fn get_email(State(s): State<AppState>, Path(id): Path<String>) -> Response {
    let res = {
        let conn = s.db.conn();
        full_messages(&conn, "e.id = ?", &id).map(|mut v| {
            add_tracking(&conn, &mut v);
            v
        })
    };
    match res.map(|mut v| v.pop()) {
        Ok(Some(m)) => Json(m).into_response(),
        Ok(None) => api_error(StatusCode::NOT_FOUND, "not_found", "Email not found"),
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &e.to_string()),
    }
}

async fn thread(State(s): State<AppState>, Path(thread_id): Path<String>) -> Response {
    let res = {
        let conn = s.db.conn();
        full_messages(
            &conn,
            "e.thread_id = ? AND e.is_trashed = 0 ORDER BY e.received_at ASC, e.rowid ASC",
            &thread_id,
        )
        .map(|mut v| {
            add_tracking(&conn, &mut v);
            v
        })
    };
    match res {
        Ok(msgs) if msgs.is_empty() => api_error(StatusCode::NOT_FOUND, "not_found", "Thread not found"),
        Ok(msgs) => Json(json!({ "threadId": thread_id, "messages": msgs })).into_response(),
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", &e.to_string()),
    }
}

async fn search(State(s): State<AppState>, Query(q): QueryMap) -> Response {
    let Some(text) = q.get("q").map(|v| v.trim()).filter(|v| !v.is_empty()) else {
        return api_error(StatusCode::BAD_REQUEST, "invalid_request", "q is required");
    };
    let limit = parse_i64(&q, "limit", DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let account = q.get("accountId").filter(|v| !v.is_empty());
    let account_sql = if account.is_some() { " AND e.account_id = ?" } else { "" };

    // FTS first (ranked). `emails_fts` is an external-content index that nothing keeps
    // populated and it rejects some syntax, so fall back to LIKE when it yields nothing.
    let mut fts_values = vec![Sql::Text(fts_query(text))];
    if let Some(a) = account {
        fts_values.push(Sql::Text(a.clone()));
    }
    let fts_sql = format!(
        "SELECT {LIST_COLS} FROM emails_fts JOIN emails e ON e.rowid = emails_fts.rowid
         WHERE emails_fts MATCH ? AND e.is_trashed = 0{account_sql} ORDER BY rank LIMIT ? OFFSET ?"
    );
    let fts_has_hits = {
        let mut v = fts_values.clone();
        v.extend([Sql::Integer(1), Sql::Integer(0)]);
        let conn = s.db.conn();
        conn.prepare(&fts_sql)
            .and_then(|mut st| st.query_map(rusqlite::params_from_iter(v), |_| Ok(())).map(|r| r.count()))
            .unwrap_or(0)
            > 0
    };
    if fts_has_hits {
        return page(&s, &fts_sql, fts_values, limit, 0);
    }

    let mut values = Vec::new();
    let cond = like_condition(text, &mut values);
    if let Some(a) = account {
        values.push(Sql::Text(a.clone()));
    }
    let sql = format!(
        "SELECT {LIST_COLS} FROM emails e WHERE {cond} AND e.is_trashed = 0{account_sql}
         ORDER BY e.received_at DESC, e.rowid DESC LIMIT ? OFFSET ?"
    );
    page(&s, &sql, values, limit, 0)
}

async fn attachment(State(s): State<AppState>, Path((id, attachment_id)): Path<(String, String)>) -> Response {
    let row = s.db.conn().query_row(
        "SELECT filename, mime_type, data FROM attachments WHERE email_id = ? AND id = ?",
        (&id, &attachment_id),
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<Vec<u8>>>(2)?,
            ))
        },
    );
    match row {
        Ok((name, mime, data)) => {
            let name = name.unwrap_or_else(|| "attachment".into()).replace(['"', '\\', '\r', '\n'], "_");
            (
                [
                    (header::CONTENT_TYPE, mime.unwrap_or_else(|| "application/octet-stream".into())),
                    (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\"")),
                ],
                Body::from(data.unwrap_or_default()),
            )
                .into_response()
        }
        Err(_) => api_error(StatusCode::NOT_FOUND, "not_found", "Attachment not found"),
    }
}
