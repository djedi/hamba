use super::*;
use crate::providers::{get_provider, EmailProvider, ProgressCallback, SendResult, SyncOptions};
use crate::routes::contacts::add_contact_from_receive;
use crate::services::send::{self, OutgoingEmail};
use crate::{db, AppState};
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::Router;
use chrono::{Local, NaiveDate, TimeZone};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_inbox))
        .route("/search", get(search))
        .route("/starred", get(|s, q| list_folder(s, q, Folder::Starred)))
        .route("/sent", get(|s, q| list_folder(s, q, Folder::Sent)))
        .route("/trashed", get(|s, q| list_folder(s, q, Folder::Trashed)))
        .route("/archived", get(|s, q| list_folder(s, q, Folder::Archived)))
        .route("/snoozed", get(|s, q| list_folder(s, q, Folder::Snoozed)))
        .route("/reminders", get(|s, q| list_folder(s, q, Folder::Reminders)))
        .route("/scheduled", get(list_scheduled))
        .route(
            "/scheduled/{id}",
            get(get_scheduled).put(update_scheduled).delete(cancel_scheduled),
        )
        .route("/thread/{thread_id}", get(thread))
        .route("/sync/{account_id}", post(sync))
        .route("/sync-sent/{account_id}", post(sync_sent))
        .route("/send", post(send_now))
        .route("/queue-send", post(queue_send))
        .route("/pending/{pending_id}", delete(cancel_pending))
        .route("/schedule", post(schedule))
        .route("/batch/{action}", post(batch))
        .route("/{id}", get(get_one))
        .route("/{id}/read", post(|s, p| action(s, p, Action::Read)))
        .route("/{id}/unread", post(|s, p| action(s, p, Action::Unread)))
        .route("/{id}/star", post(|s, p| action(s, p, Action::Star)))
        .route("/{id}/unstar", post(|s, p| action(s, p, Action::Unstar)))
        .route("/{id}/archive", post(|s, p| action(s, p, Action::Archive)))
        .route("/{id}/unarchive", post(|s, p| action(s, p, Action::Unarchive)))
        .route("/{id}/trash", post(|s, p| action(s, p, Action::Trash)))
        .route("/{id}/untrash", post(|s, p| action(s, p, Action::Untrash)))
        .route("/{id}/permanent", delete(|s, p| action(s, p, Action::PermanentDelete)))
        .route("/{id}/attachment/{content_id}", get(attachment))
        .route("/{id}/snooze", post(snooze))
        .route("/{id}/unsnooze", post(unsnooze))
        .route("/{id}/reminder", post(set_reminder).delete(clear_reminder))
}

// ---------- Listing ----------

enum Folder {
    Starred,
    Sent,
    Trashed,
    Archived,
    Snoozed,
    Reminders,
}

impl Folder {
    fn sql(&self) -> &'static str {
        match self {
            Folder::Starred => "SELECT * FROM emails WHERE account_id = ? AND is_starred = 1 AND is_trashed = 0 ORDER BY received_at DESC LIMIT ? OFFSET ?",
            Folder::Sent => "SELECT * FROM emails WHERE account_id = ? AND folder = 'sent' AND is_trashed = 0 ORDER BY received_at DESC LIMIT ? OFFSET ?",
            Folder::Trashed => "SELECT * FROM emails WHERE account_id = ? AND is_trashed = 1 ORDER BY trashed_at DESC LIMIT ? OFFSET ?",
            Folder::Archived => "SELECT * FROM emails WHERE account_id = ? AND is_archived = 1 AND is_trashed = 0 ORDER BY received_at DESC LIMIT ? OFFSET ?",
            Folder::Snoozed => "SELECT * FROM emails WHERE account_id = ? AND snoozed_until IS NOT NULL AND is_trashed = 0 ORDER BY snoozed_until ASC LIMIT ? OFFSET ?",
            Folder::Reminders => "SELECT * FROM emails WHERE account_id = ? AND remind_at IS NOT NULL AND is_trashed = 0 ORDER BY remind_at ASC LIMIT ? OFFSET ?",
        }
    }
}

const INBOX_SQL: &str = "SELECT * FROM emails
    WHERE account_id = ? AND is_trashed = 0 AND is_archived = 0 AND snoozed_until IS NULL AND folder = 'inbox'
    ORDER BY received_at DESC LIMIT ? OFFSET ?";

fn paged(state: &AppState, q: &HashMap<String, String>, sql: &str) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    let (limit, offset) = (parse_i64(q, "limit", 50), parse_i64(q, "offset", 0));
    match db::query_all(&state.db.conn(), sql, (account_id, limit, offset)) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => ok(json!({ "error": e.to_string() })),
    }
}

async fn list_inbox(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    paged(&s, &q, INBOX_SQL)
}

async fn list_folder(State(s): State<AppState>, Query(q): QueryMap, folder: Folder) -> JsonResult {
    paged(&s, &q, folder.sql())
}

async fn get_one(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    opt(find_email(&s, &id))
}

async fn thread(State(s): State<AppState>, Path(thread_id): Path<String>) -> JsonResult {
    match db::query_all(
        &s.db.conn(),
        "SELECT * FROM emails WHERE thread_id = ? ORDER BY received_at ASC",
        [thread_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => ok(json!({ "error": e.to_string() })),
    }
}

fn find_email(state: &AppState, id: &str) -> Option<Value> {
    db::query_one(&state.db.conn(), "SELECT * FROM emails WHERE id = ?", [id])
        .ok()
        .flatten()
}

// ---------- Search ----------

#[derive(Debug, Default, PartialEq)]
pub struct SearchOperators {
    pub query: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub subject: Option<String>,
    pub has_attachment: bool,
    pub is_unread: Option<bool>,
    pub is_starred: Option<bool>,
    pub before: Option<i64>,
    pub after: Option<i64>,
}

impl SearchOperators {
    fn has_operators(&self) -> bool {
        self.from.is_some()
            || self.to.is_some()
            || self.subject.is_some()
            || self.has_attachment
            || self.is_unread.is_some()
            || self.is_starred.is_some()
            || self.before.is_some()
            || self.after.is_some()
    }
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).unwrap());
    };
}
re!(FROM_RE, r"(?i)from:(\S+)");
re!(TO_RE, r"(?i)to:(\S+)");
re!(SUBJECT_RE, r#"(?i)subject:(?:"([^"]+)"|(\S+))"#);
re!(HAS_ATTACHMENT_RE, r"(?i)has:attachment");
re!(IS_UNREAD_RE, r"(?i)is:unread");
re!(IS_READ_RE, r"(?i)is:read");
re!(IS_STARRED_RE, r"(?i)is:starred");
re!(BEFORE_RE, r"(?i)before:(\d{4}-\d{2}-\d{2})");
re!(AFTER_RE, r"(?i)after:(\d{4}-\d{2}-\d{2})");

/// Remove the first match from `rest` (like `str.replace(match[0], "").trim()`) and return its captures
fn take(re: &Regex, rest: &mut String) -> Option<Vec<Option<String>>> {
    let caps = re.captures(rest)?;
    let groups = caps
        .iter()
        .map(|m| m.map(|m| m.as_str().to_string()))
        .collect::<Vec<_>>();
    let whole = groups[0].clone().unwrap_or_default();
    *rest = rest.replacen(&whole, "", 1).trim().to_string();
    Some(groups)
}

/// Local-time day boundary as a unix timestamp (TS: `new Date(d).setHours(...)`)
fn local_day_boundary(date: &str, end_of_day: bool) -> Option<i64> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let t = if end_of_day {
        d.and_hms_milli_opt(23, 59, 59, 999)?
    } else {
        d.and_hms_opt(0, 0, 0)?
    };
    Local.from_local_datetime(&t).earliest().map(|dt| dt.timestamp())
}

/// Parse search operators: from:, to:, subject:, has:attachment, is:unread/read/starred, before:, after:
pub fn parse_search(q: &str) -> SearchOperators {
    let mut ops = SearchOperators::default();
    let mut rest = q.to_string();
    if let Some(g) = take(&FROM_RE, &mut rest) {
        ops.from = g[1].clone();
    }
    if let Some(g) = take(&TO_RE, &mut rest) {
        ops.to = g[1].clone();
    }
    if let Some(g) = take(&SUBJECT_RE, &mut rest) {
        ops.subject = g[1].clone().or(g[2].clone());
    }
    if take(&HAS_ATTACHMENT_RE, &mut rest).is_some() {
        ops.has_attachment = true;
    }
    if take(&IS_UNREAD_RE, &mut rest).is_some() {
        ops.is_unread = Some(true);
    }
    if take(&IS_READ_RE, &mut rest).is_some() {
        ops.is_unread = Some(false);
    }
    if take(&IS_STARRED_RE, &mut rest).is_some() {
        ops.is_starred = Some(true);
    }
    if let Some(g) = take(&BEFORE_RE, &mut rest) {
        ops.before = g[1].as_deref().and_then(|d| local_day_boundary(d, true));
    }
    if let Some(g) = take(&AFTER_RE, &mut rest) {
        ops.after = g[1].as_deref().and_then(|d| local_day_boundary(d, false));
    }
    let rest = rest.trim();
    if !rest.is_empty() {
        ops.query = Some(rest.to_string());
    }
    ops
}

fn advanced_search(
    state: &AppState,
    ops: &SearchOperators,
    account_id: Option<&str>,
    limit: i64,
) -> rusqlite::Result<Vec<Value>> {
    use rusqlite::types::Value as Sql;
    let mut conditions: Vec<&str> = Vec::new();
    let mut values: Vec<Sql> = Vec::new();
    let like = |s: &str| Sql::Text(format!("%{s}%"));

    if let Some(q) = &ops.query {
        conditions.push("emails.rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?)");
        values.push(Sql::Text(q.clone()));
    }
    if let Some(from) = &ops.from {
        conditions.push("(emails.from_email LIKE ? OR emails.from_name LIKE ?)");
        values.extend([like(from), like(from)]);
    }
    if let Some(to) = &ops.to {
        conditions.push("emails.to_addresses LIKE ?");
        values.push(like(to));
    }
    if let Some(subject) = &ops.subject {
        conditions.push("emails.subject LIKE ?");
        values.push(like(subject));
    }
    if ops.has_attachment {
        conditions.push("emails.id IN (SELECT DISTINCT email_id FROM attachments)");
    }
    if let Some(unread) = ops.is_unread {
        conditions.push("emails.is_read = ?");
        values.push(Sql::Integer(if unread { 0 } else { 1 }));
    }
    if let Some(starred) = ops.is_starred {
        conditions.push("emails.is_starred = ?");
        values.push(Sql::Integer(starred as i64));
    }
    if let Some(before) = ops.before {
        conditions.push("emails.received_at < ?");
        values.push(Sql::Integer(before));
    }
    if let Some(after) = ops.after {
        conditions.push("emails.received_at > ?");
        values.push(Sql::Integer(after));
    }
    if let Some(account_id) = account_id {
        conditions.push("emails.account_id = ?");
        values.push(Sql::Text(account_id.to_string()));
    }
    // Always exclude trashed emails from search results
    conditions.push("emails.is_trashed = 0");
    values.push(Sql::Integer(if limit > 0 { limit } else { 50 }));

    let sql = format!(
        "SELECT * FROM emails WHERE {} ORDER BY received_at DESC LIMIT ?",
        conditions.join(" AND ")
    );
    db::query_all(&state.db.conn(), &sql, rusqlite::params_from_iter(values))
}

async fn search(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(query) = q.get("q").filter(|v| !v.is_empty()) else {
        return ok(json!({ "error": "Search query required" }));
    };
    let limit = parse_i64(&q, "limit", 50);
    let account_id = q.get("accountId").map(String::as_str).filter(|a| !a.is_empty());
    let ops = parse_search(query);

    let result = if ops.has_operators() || ops.query.is_none() {
        advanced_search(&s, &ops, account_id, limit)
    } else {
        // Plain FTS search, ranked by relevance
        db::query_all(
            &s.db.conn(),
            "SELECT emails.* FROM emails_fts
             JOIN emails ON emails.rowid = emails_fts.rowid
             WHERE emails_fts MATCH ?
             ORDER BY rank
             LIMIT ?",
            (ops.query.as_deref(), limit),
        )
    };
    match result {
        Ok(rows) => ok(json!(rows)),
        // FTS syntax errors from user input shouldn't 500
        Err(e) => ok(json!({ "error": e.to_string() })),
    }
}

// ---------- Sync ----------

static ACTIVE_BACKGROUND_SYNCS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

fn update_sync_progress(state: &AppState, account_id: &str, total: i64, synced: i64) {
    let _ = state.db.conn().execute(
        "UPDATE accounts SET sync_progress_total = ?, sync_progress_synced = ?, updated_at = unixepoch() WHERE id = ?",
        (total, synced, account_id),
    );
}

fn mark_full_sync_complete(state: &AppState, account_id: &str) {
    let _ = state.db.conn().execute(
        "UPDATE accounts SET last_full_sync_at = unixepoch(), updated_at = unixepoch() WHERE id = ?",
        [account_id],
    );
}

fn sync_settings(state: &AppState, account_id: &str) -> (i64, bool) {
    state
        .db
        .conn()
        .query_row(
            "SELECT initial_sync_limit, sync_all_mail FROM accounts WHERE id = ?",
            [account_id],
            |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?.unwrap_or(100),
                    r.get::<_, Option<i64>>(1)?.unwrap_or(0) == 1,
                ))
            },
        )
        .unwrap_or((100, false))
}

/// Keep syncing batches until the provider reports no more messages (when `sync_all_mail` is on)
async fn background_sync(state: AppState, account_id: String, batch_size: i64) {
    if !ACTIVE_BACKGROUND_SYNCS.lock().unwrap().insert(account_id.clone()) {
        tracing::info!(account_id, "Background sync already running, skipping");
        return;
    }
    tracing::info!(account_id, "Starting background sync");

    let provider = match get_provider(&state, &account_id) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(account_id, error = %e, "Background sync failed");
            ACTIVE_BACKGROUND_SYNCS.lock().unwrap().remove(&account_id);
            return;
        }
    };
    let total_synced = Arc::new(std::sync::atomic::AtomicI64::new(0));
    let mut has_more = true;
    // Safety limit to prevent infinite loops
    for _ in 0..100 {
        let progress = {
            let (state, account_id, total_synced) = (state.clone(), account_id.clone(), total_synced.clone());
            ProgressCallback(Arc::new(move |synced, total| {
                let done = total_synced.load(std::sync::atomic::Ordering::Relaxed) + synced;
                update_sync_progress(&state, &account_id, total, done);
                state.realtime.notify_background_sync_progress(&account_id, done, total);
            }))
        };
        let result = provider
            .sync(SyncOptions {
                max_messages: Some(batch_size),
                on_progress: Some(progress),
                ..Default::default()
            })
            .await;
        if result.error.is_some() || result.needs_reauth == Some(true) {
            tracing::error!(account_id, error = ?result.error, "Background sync error");
            break;
        }
        let done = total_synced.fetch_add(result.synced, std::sync::atomic::Ordering::Relaxed) + result.synced;
        has_more = result.has_more.unwrap_or(false);
        tracing::info!(
            account_id,
            synced = result.synced,
            total = done,
            has_more,
            "Background sync batch"
        );
        if !has_more {
            break;
        }
        // Small delay between batches to avoid overwhelming the server
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    if !has_more {
        mark_full_sync_complete(&state, &account_id);
    }
    let total = total_synced.load(std::sync::atomic::Ordering::Relaxed);
    if total > 0 {
        state.realtime.notify_sync_complete(&account_id, total);
    }
    ACTIVE_BACKGROUND_SYNCS.lock().unwrap().remove(&account_id);
}

async fn sync(State(s): State<AppState>, Path(account_id): Path<String>) -> JsonResult {
    let (max_messages, sync_all) = sync_settings(&s, &account_id);
    let provider = match get_provider(&s, &account_id) {
        Ok(p) => p,
        Err(e) => return ok(json!({ "error": e, "synced": 0, "total": 0 })),
    };
    let progress = {
        let (state, account_id) = (s.clone(), account_id.clone());
        ProgressCallback(Arc::new(move |synced, total| {
            update_sync_progress(&state, &account_id, total, synced)
        }))
    };
    let result = provider
        .sync(SyncOptions {
            max_messages: Some(max_messages),
            sync_all,
            on_progress: Some(progress),
            ..Default::default()
        })
        .await;

    // If auth error, return immediately with needsReauth flag
    if result.needs_reauth == Some(true) {
        return ok(json!(result));
    }

    if result.synced > 0 {
        // Add senders of newly synced emails to contacts
        let conn = s.db.conn();
        let recent = db::query_all(
            &conn,
            "SELECT from_email, from_name, received_at FROM emails
             WHERE account_id = ? AND folder = 'inbox'
             ORDER BY received_at DESC LIMIT ?",
            (&account_id, result.synced),
        )
        .unwrap_or_default();
        for e in recent {
            if let Some(from) = e["from_email"].as_str().filter(|f| !f.is_empty()) {
                add_contact_from_receive(
                    &conn,
                    &account_id,
                    from,
                    e["from_name"].as_str(),
                    e["received_at"].as_i64().unwrap_or(0),
                );
            }
        }
    }

    let has_more = result.has_more.unwrap_or(false);
    if !has_more && result.synced > 0 {
        mark_full_sync_complete(&s, &account_id);
    }
    if result.synced > 0 {
        s.realtime.notify_sync_complete(&account_id, result.synced);
    }
    if sync_all && has_more {
        tokio::spawn(background_sync(s.clone(), account_id, max_messages));
    }
    ok(json!(result))
}

async fn sync_sent(State(s): State<AppState>, Path(account_id): Path<String>) -> JsonResult {
    let (max_messages, _) = sync_settings(&s, &account_id);
    match get_provider(&s, &account_id) {
        Ok(p) => ok(json!(
            p.sync_sent(SyncOptions {
                max_messages: Some(max_messages),
                ..Default::default()
            })
            .await
        )),
        Err(e) => ok(json!({ "error": e, "synced": 0, "total": 0 })),
    }
}

// ---------- Single-email actions ----------

#[derive(Clone, Copy)]
enum Action {
    Read,
    Unread,
    Star,
    Unstar,
    Archive,
    Unarchive,
    Trash,
    Untrash,
    PermanentDelete,
}

impl Action {
    async fn remote(self, p: &dyn EmailProvider, id: &str) -> Result<(), String> {
        match self {
            Action::Read => p.mark_read(id).await,
            Action::Unread => p.mark_unread(id).await,
            Action::Star => p.star(id).await,
            Action::Unstar => p.unstar(id).await,
            Action::Archive => p.archive(id).await,
            Action::Unarchive => p.unarchive(id).await,
            Action::Trash => p.trash(id).await,
            Action::Untrash => p.untrash(id).await,
            Action::PermanentDelete => p.permanent_delete(id).await,
        }
    }

    fn local_sql(self) -> &'static str {
        match self {
            Action::Read => "UPDATE emails SET is_read = 1 WHERE id = ?",
            Action::Unread => "UPDATE emails SET is_read = 0 WHERE id = ?",
            Action::Star => "UPDATE emails SET is_starred = 1 WHERE id = ?",
            Action::Unstar => "UPDATE emails SET is_starred = 0 WHERE id = ?",
            Action::Archive => "UPDATE emails SET is_archived = 1 WHERE id = ?",
            Action::Unarchive => "UPDATE emails SET is_archived = 0 WHERE id = ?",
            Action::Trash => "UPDATE emails SET is_trashed = 1, trashed_at = unixepoch() WHERE id = ?",
            Action::Untrash => "UPDATE emails SET is_trashed = 0, trashed_at = NULL WHERE id = ?",
            Action::PermanentDelete => "DELETE FROM emails WHERE id = ?",
        }
    }

    /// Read/star state is applied locally even when the server call fails (better UX);
    /// moves and deletes only apply after the server succeeds.
    fn optimistic(self) -> bool {
        matches!(self, Action::Read | Action::Unread | Action::Star | Action::Unstar)
    }

    fn from_batch(name: &str) -> Option<Self> {
        Some(match name {
            "archive" => Action::Archive,
            "trash" => Action::Trash,
            "star" => Action::Star,
            "unstar" => Action::Unstar,
            "read" => Action::Read,
            "unread" => Action::Unread,
            _ => return None,
        })
    }
}

fn apply_local(state: &AppState, action: Action, id: &str) {
    let _ = state.db.conn().execute(action.local_sql(), [id]);
}

async fn action(State(s): State<AppState>, Path(id): Path<String>, action: Action) -> JsonResult {
    let Some(email) = find_email(&s, &id) else {
        return fail("Email not found");
    };
    let account_id = email["account_id"].as_str().unwrap_or("");
    let result = match get_provider(&s, account_id) {
        Ok(p) => action.remote(p.as_ref(), &id).await,
        Err(e) => Err(e),
    };
    match result {
        Ok(()) => {
            apply_local(&s, action, &id);
            ok(json!({ "success": true }))
        }
        Err(e) if action.optimistic() => {
            tracing::error!(email_id = %id, error = %e, "Provider action failed; applied locally");
            apply_local(&s, action, &id);
            ok(json!({ "success": true, "warning": e }))
        }
        Err(e) => {
            tracing::error!(email_id = %id, error = %e, "Provider action failed");
            fail(e)
        }
    }
}

async fn batch(State(s): State<AppState>, Path(name): Path<String>, Json(body): Json<Value>) -> Response {
    let Some(action) = Action::from_batch(&name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let ids: Vec<String> = body["emailIds"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if ids.is_empty() {
        return fail("emailIds array required").into_response();
    }
    if ids.len() > 100 {
        return fail("Maximum 100 emails per batch").into_response();
    }

    // Group emails by account for provider calls, preserving order
    let mut by_account: Vec<(String, Vec<String>)> = Vec::new();
    for id in ids {
        if let Some(email) = find_email(&s, &id) {
            let account_id = email["account_id"].as_str().unwrap_or("").to_string();
            match by_account.iter_mut().find(|(a, _)| *a == account_id) {
                Some((_, list)) => list.push(id),
                None => by_account.push((account_id, vec![id])),
            }
        }
    }

    let (mut count, mut failed, mut errors) = (0, Vec::<String>::new(), Vec::<String>::new());
    for (account_id, ids) in by_account {
        let provider = match get_provider(&s, &account_id) {
            Ok(p) => Some(p),
            // For read status, we still update locally even if the provider is unavailable
            Err(_) if matches!(action, Action::Read | Action::Unread) => None,
            Err(e) => {
                failed.extend(ids);
                errors.push(e);
                continue;
            }
        };
        for id in ids {
            let result = match &provider {
                Some(p) => action.remote(p.as_ref(), &id).await,
                None => Err(String::new()),
            };
            match result {
                Ok(()) => {
                    apply_local(&s, action, &id);
                    count += 1;
                }
                Err(_) if matches!(action, Action::Read | Action::Unread) => {
                    // Still update local DB for better UX
                    apply_local(&s, action, &id);
                    count += 1;
                }
                Err(e) => {
                    failed.push(id);
                    errors.push(e);
                }
            }
        }
    }
    let success = matches!(action, Action::Read | Action::Unread) || failed.is_empty();
    Json(json!({ "success": success, "count": count, "failed": failed, "errors": errors })).into_response()
}

// ---------- Attachments ----------

async fn attachment(State(s): State<AppState>, Path((id, content_id)): Path<(String, String)>) -> Response {
    let row = s.db.conn().query_row(
        "SELECT mime_type, data FROM attachments WHERE email_id = ? AND content_id = ?",
        (&id, &content_id),
        |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<Vec<u8>>>(1)?)),
    );
    match row {
        Ok((mime, data)) => (
            [
                (
                    header::CONTENT_TYPE,
                    mime.unwrap_or_else(|| "application/octet-stream".into()),
                ),
                (header::CACHE_CONTROL, "public, max-age=31536000".into()),
            ],
            Body::from(data.unwrap_or_default()),
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, Json(json!({ "error": "Attachment not found" }))).into_response(),
    }
}

// ---------- Sending ----------

fn validate_outgoing(email: &OutgoingEmail) -> bool {
    !email.account_id.is_empty() && !email.to.is_empty() && !email.subject.is_empty()
}

async fn send_now(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let email = OutgoingEmail::from_json(&body);
    if !validate_outgoing(&email) {
        return ok(json!({ "error": "accountId, to, and subject are required" }));
    }
    let Some(params) = send::build_send_params(&s, &email) else {
        return ok(json!({ "error": "Account not found" }));
    };
    let result: SendResult = match get_provider(&s, &email.account_id) {
        Ok(p) => p.send(params).await,
        Err(e) => return ok(json!({ "error": e, "success": false })),
    };
    ok(json!(result))
}

async fn queue_send(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let email = OutgoingEmail::from_json(&body);
    if !validate_outgoing(&email) {
        return fail("accountId, to, and subject are required");
    }
    ok(send::queue_send(&s, &email))
}

async fn cancel_pending(State(s): State<AppState>, Path(pending_id): Path<String>) -> JsonResult {
    ok(send::cancel_send(&s, &pending_id))
}

async fn list_scheduled(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    match q.get("accountId") {
        Some(account_id) => ok(json!(send::get_scheduled_emails(&s, account_id))),
        None => ok(json!({ "error": "accountId required" })),
    }
}

async fn get_scheduled(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    match send::get_scheduled_email(&s, &id) {
        Some(row) => ok(row),
        None => ok(json!({ "error": "Scheduled email not found" })),
    }
}

async fn schedule(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let email = OutgoingEmail::from_json(&body);
    if !validate_outgoing(&email) {
        return fail("accountId, to, and subject are required");
    }
    let Some(send_at) = body["sendAt"].as_i64().filter(|v| *v != 0) else {
        return fail("sendAt timestamp required");
    };
    ok(send::schedule_email(&s, &email, send_at))
}

async fn update_scheduled(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    ok(send::update_scheduled_email(&s, &id, &body))
}

async fn cancel_scheduled(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    ok(send::cancel_scheduled_email(&s, &id))
}

// ---------- Snooze & reminders ----------

async fn set_timestamp(s: &AppState, id: &str, body: &Value, key: &str, sql: &str) -> JsonResult {
    if find_email(s, id).is_none() {
        return fail("Email not found");
    }
    let Some(ts) = body[key].as_f64().filter(|v| *v != 0.0) else {
        return fail(format!("{key} timestamp required"));
    };
    match s.db.conn().execute(sql, (ts as i64, id)) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn clear_column(s: &AppState, id: &str, sql: &str) -> JsonResult {
    if find_email(s, id).is_none() {
        return fail("Email not found");
    }
    match s.db.conn().execute(sql, [id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn snooze(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    set_timestamp(
        &s,
        &id,
        &body,
        "snoozedUntil",
        "UPDATE emails SET snoozed_until = ? WHERE id = ?",
    )
    .await
}

async fn unsnooze(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    clear_column(&s, &id, "UPDATE emails SET snoozed_until = NULL WHERE id = ?").await
}

async fn set_reminder(State(s): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    set_timestamp(
        &s,
        &id,
        &body,
        "remindAt",
        "UPDATE emails SET remind_at = ? WHERE id = ?",
    )
    .await
}

async fn clear_reminder(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    clear_column(&s, &id, "UPDATE emails SET remind_at = NULL WHERE id = ?").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_query() {
        let ops = parse_search("quarterly report");
        assert_eq!(ops.query.as_deref(), Some("quarterly report"));
        assert!(!ops.has_operators());
    }

    #[test]
    fn parses_operators() {
        let ops =
            parse_search(r#"from:alice to:bob subject:"budget review" has:attachment is:unread is:starred hello"#);
        assert_eq!(ops.from.as_deref(), Some("alice"));
        assert_eq!(ops.to.as_deref(), Some("bob"));
        assert_eq!(ops.subject.as_deref(), Some("budget review"));
        assert!(ops.has_attachment);
        assert_eq!(ops.is_unread, Some(true));
        assert_eq!(ops.is_starred, Some(true));
        assert_eq!(ops.query.as_deref(), Some("hello"));
    }

    #[test]
    fn is_read_overrides_unread() {
        assert_eq!(parse_search("is:read").is_unread, Some(false));
    }

    #[test]
    fn date_bounds_cover_whole_day() {
        let ops = parse_search("after:2024-01-02 before:2024-01-02");
        let (after, before) = (ops.after.unwrap(), ops.before.unwrap());
        assert_eq!(before - after, 24 * 60 * 60 - 1);
        assert!(ops.query.is_none());
    }
}
