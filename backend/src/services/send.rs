//! Undo-send queue (`pending_sends`) and send-later (`scheduled_emails`).
//!
//! Both tables share a shape, so queueing, cancelling and processing are
//! implemented once and parameterised by table.

use crate::providers::{get_provider, Attachment, SendParams};
use crate::routes::contacts::add_contact_from_send;
use crate::{db, AppState};
use serde_json::{json, Value};
use std::time::Duration;

/// Default undo window in seconds
pub const UNDO_WINDOW_SECONDS: i64 = 5;

#[derive(Clone, Copy)]
pub enum Queue {
    Pending,
    Scheduled,
}

impl Queue {
    fn table(self) -> &'static str {
        match self {
            Queue::Pending => "pending_sends",
            Queue::Scheduled => "scheduled_emails",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Queue::Pending => "pending-send",
            Queue::Scheduled => "scheduled-send",
        }
    }
}

/// Outgoing email fields as posted by the frontend
#[derive(Debug, Clone, Default)]
pub struct OutgoingEmail {
    pub account_id: String,
    pub to: String,
    pub cc: Option<String>,
    pub bcc: Option<String>,
    pub subject: String,
    pub body: String,
    pub reply_to_id: Option<String>,
    /// JSON array of `{ filename, mimeType, content }`, stored verbatim
    pub attachments: Option<Value>,
}

impl OutgoingEmail {
    pub fn from_json(body: &Value) -> Self {
        let s = |k: &str| body[k].as_str().filter(|v| !v.is_empty()).map(str::to_string);
        OutgoingEmail {
            account_id: s("accountId").unwrap_or_default(),
            to: s("to").unwrap_or_default(),
            cc: s("cc"),
            bcc: s("bcc"),
            subject: s("subject").unwrap_or_default(),
            body: body["body"].as_str().unwrap_or("").to_string(),
            reply_to_id: s("replyToId"),
            attachments: body.get("attachments").filter(|a| a.is_array()).cloned(),
        }
    }
}

fn account_exists(state: &AppState, account_id: &str) -> bool {
    db::query_one(&state.db.conn(), "SELECT id FROM accounts WHERE id = ?", [account_id])
        .ok()
        .flatten()
        .is_some()
}

fn insert(state: &AppState, queue: Queue, email: &OutgoingEmail, send_at: i64) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let sql = format!(
        "INSERT INTO {} (id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, attachments, send_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        queue.table()
    );
    state
        .db
        .conn()
        .execute(
            &sql,
            rusqlite::params![
                id,
                email.account_id,
                email.to,
                email.cc,
                email.bcc,
                email.subject,
                email.body,
                email.reply_to_id,
                email.attachments.as_ref().map(Value::to_string),
                send_at
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Queue an email for sending after the undo window
pub fn queue_send(state: &AppState, email: &OutgoingEmail) -> Value {
    if !account_exists(state, &email.account_id) {
        return json!({ "success": false, "error": "Account not found" });
    }
    let send_at = db::now() + UNDO_WINDOW_SECONDS;
    match insert(state, Queue::Pending, email, send_at) {
        Ok(id) => {
            json!({ "success": true, "pendingId": id, "sendAt": send_at, "undoWindowSeconds": UNDO_WINDOW_SECONDS })
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

/// Cancel a pending send (undo)
pub fn cancel_send(state: &AppState, pending_id: &str) -> Value {
    let conn = state.db.conn();
    let Some(pending) = db::query_one(&conn, "SELECT * FROM pending_sends WHERE id = ?", [pending_id])
        .ok()
        .flatten()
    else {
        return json!({ "success": false, "error": "Pending send not found" });
    };
    if pending["send_at"].as_i64().unwrap_or(0) <= db::now() {
        return json!({ "success": false, "error": "Email already sent" });
    }
    match conn.execute("DELETE FROM pending_sends WHERE id = ?", [pending_id]) {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

pub fn schedule_email(state: &AppState, email: &OutgoingEmail, send_at: i64) -> Value {
    if !account_exists(state, &email.account_id) {
        return json!({ "success": false, "error": "Account not found" });
    }
    if send_at <= db::now() {
        return json!({ "success": false, "error": "Scheduled time must be in the future" });
    }
    match insert(state, Queue::Scheduled, email, send_at) {
        Ok(id) => json!({ "success": true, "scheduledId": id, "sendAt": send_at }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}

pub fn get_scheduled_email(state: &AppState, id: &str) -> Option<Value> {
    db::query_one(&state.db.conn(), "SELECT * FROM scheduled_emails WHERE id = ?", [id])
        .ok()
        .flatten()
}

pub fn get_scheduled_emails(state: &AppState, account_id: &str) -> Vec<Value> {
    db::query_all(
        &state.db.conn(),
        "SELECT * FROM scheduled_emails WHERE account_id = ? ORDER BY send_at ASC",
        [account_id],
    )
    .unwrap_or_default()
}

pub fn cancel_scheduled_email(state: &AppState, id: &str) -> Value {
    if get_scheduled_email(state, id).is_none() {
        return json!({ "success": false, "error": "Scheduled email not found" });
    }
    match state
        .db
        .conn()
        .execute("DELETE FROM scheduled_emails WHERE id = ?", [id])
    {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

/// Update a scheduled email; mirrors the TS fallback rules (`||` vs `!== undefined`).
pub fn update_scheduled_email(state: &AppState, id: &str, body: &Value) -> Value {
    let Some(existing) = get_scheduled_email(state, id) else {
        return json!({ "success": false, "error": "Scheduled email not found" });
    };
    let send_at = body["sendAt"].as_i64().filter(|v| *v != 0);
    if let Some(send_at) = send_at {
        if send_at <= db::now() {
            return json!({ "success": false, "error": "Scheduled time must be in the future" });
        }
    }
    // `params.x || existing.x`
    let or_existing = |key: &str, col: &str| {
        body[key]
            .as_str()
            .filter(|v| !v.is_empty())
            .map(str::to_string)
            .or_else(|| existing[col].as_str().map(str::to_string))
    };
    // `params.x !== undefined ? (params.x || null) : existing.x`
    let nullable = |key: &str, col: &str| match body.get(key) {
        Some(v) if !v.is_null() => v.as_str().filter(|s| !s.is_empty()).map(str::to_string),
        _ => existing[col].as_str().map(str::to_string),
    };
    let attachments = match body.get("attachments").filter(|a| a.is_array()) {
        Some(a) => Some(a.to_string()),
        None => existing["attachments"].as_str().map(str::to_string),
    };
    match state.db.conn().execute(
        "UPDATE scheduled_emails
         SET to_addresses = ?, cc_addresses = ?, bcc_addresses = ?, subject = ?, body = ?, reply_to_id = ?, attachments = ?, send_at = ?
         WHERE id = ?",
        rusqlite::params![
            or_existing("to", "to_addresses"),
            nullable("cc", "cc_addresses"),
            nullable("bcc", "bcc_addresses"),
            or_existing("subject", "subject"),
            or_existing("body", "body"),
            nullable("replyToId", "reply_to_id"),
            attachments,
            send_at.or(existing["send_at"].as_i64()),
            id
        ],
    ) {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

/// Build provider send params for an account, adding reply headers from `reply_to_id`.
/// Returns `None` if the account doesn't exist.
pub fn build_send_params(state: &AppState, email: &OutgoingEmail) -> Option<SendParams> {
    let conn = state.db.conn();
    let account = db::query_one(
        &conn,
        "SELECT name, email FROM accounts WHERE id = ?",
        [&email.account_id],
    )
    .ok()
    .flatten()?;
    let address = account["email"].as_str().unwrap_or("");
    let name = account["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(address);

    let (mut in_reply_to, mut references, mut thread_id) = (None, None, None);
    if let Some(reply_to_id) = &email.reply_to_id {
        if let Some(original) = db::query_one(
            &conn,
            "SELECT message_id, thread_id FROM emails WHERE id = ?",
            [reply_to_id],
        )
        .ok()
        .flatten()
        {
            in_reply_to = original["message_id"].as_str().map(str::to_string);
            references = in_reply_to.clone();
            thread_id = original["thread_id"].as_str().map(str::to_string);
        }
    }

    let attachments: Vec<Attachment> = email
        .attachments
        .clone()
        .and_then(|a| {
            serde_json::from_value(a)
                .map_err(|e| tracing::error!(error = %e, "Failed to parse attachments"))
                .ok()
        })
        .unwrap_or_default();

    Some(SendParams {
        from: format!("{name} <{address}>"),
        to: email.to.clone(),
        cc: email.cc.clone(),
        bcc: email.bcc.clone(),
        subject: email.subject.clone(),
        body: email.body.clone(),
        in_reply_to,
        references,
        thread_id,
        attachments,
    })
}

fn row_to_outgoing(row: &Value) -> OutgoingEmail {
    let s = |k: &str| row[k].as_str().map(str::to_string);
    OutgoingEmail {
        account_id: s("account_id").unwrap_or_default(),
        to: s("to_addresses").unwrap_or_default(),
        cc: s("cc_addresses").filter(|v| !v.is_empty()),
        bcc: s("bcc_addresses").filter(|v| !v.is_empty()),
        subject: s("subject").unwrap_or_default(),
        body: s("body").unwrap_or_default(),
        reply_to_id: s("reply_to_id"),
        attachments: row["attachments"].as_str().and_then(|a| serde_json::from_str(a).ok()),
    }
}

/// The queue row is already gone, so keep the message as a draft and tell the UI (which
/// showed "Email sent" when it was queued) that it didn't go out.
fn send_failed(state: &AppState, email: &OutgoingEmail, error: &str) {
    let draft_id = uuid::Uuid::new_v4().to_string();
    if let Err(e) = crate::emails_db::upsert_draft(
        &state.db.conn(),
        &draft_id,
        &email.account_id,
        None,
        &email.to,
        email.cc.as_deref().unwrap_or(""),
        email.bcc.as_deref().unwrap_or(""),
        &email.subject,
        &email.body,
    ) {
        tracing::error!(error = %e, "Failed to save unsent email as draft");
    }
    state
        .realtime
        .notify_send_failed(&email.account_id, &email.subject, error, &draft_id);
}

/// Send every ready row in the queue. Rows are removed whether or not sending succeeds
/// (same as the TS: avoids re-sending in a loop).
pub async fn process_queue(state: &AppState, queue: Queue) -> (i64, i64) {
    let sql = format!(
        "SELECT * FROM {} WHERE send_at <= unixepoch() ORDER BY send_at ASC",
        queue.table()
    );
    let ready = db::query_all(&state.db.conn(), &sql, []).unwrap_or_default();
    let delete_sql = format!("DELETE FROM {} WHERE id = ?", queue.table());
    let (mut sent, mut errors) = (0, 0);

    for row in ready {
        let id = row["id"].as_str().unwrap_or("").to_string();
        let email = row_to_outgoing(&row);
        // Remove first so a slow send can't be picked up again by the next tick
        let _ = state.db.conn().execute(&delete_sql, [&id]);

        let Some(params) = build_send_params(state, &email) else {
            tracing::error!(service = queue.label(), account_id = %email.account_id, id = %id, "Account not found, removing queued email");
            errors += 1;
            continue;
        };
        let result = match get_provider(state, &email.account_id) {
            Ok(provider) => provider.send(params).await,
            Err(e) => {
                tracing::error!(service = queue.label(), id = %id, error = %e, "Error processing queued email");
                send_failed(state, &email, &e.to_string());
                errors += 1;
                continue;
            }
        };
        if result.success {
            tracing::info!(service = queue.label(), id = %id, to = %email.to, "Email sent successfully");
            add_contact_from_send(
                &state.db.conn(),
                &email.account_id,
                &email.to,
                email.cc.as_deref(),
                email.bcc.as_deref(),
            );
            sent += 1;
        } else {
            tracing::error!(service = queue.label(), id = %id, error = ?result.error, "Failed to send email");
            send_failed(state, &email, result.error.as_deref().unwrap_or("Unknown error"));
            errors += 1;
        }
    }
    (sent, errors)
}

/// Start both processors: pending sends every second, scheduled emails every minute
pub fn start_processors(state: AppState) {
    for (queue, period) in [
        (Queue::Pending, Duration::from_secs(1)),
        (Queue::Scheduled, Duration::from_secs(60)),
    ] {
        let state = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                interval.tick().await;
                let (sent, errors) = process_queue(&state, queue).await;
                if sent > 0 || errors > 0 {
                    tracing::info!(service = queue.label(), sent, errors, "Processor batch completed");
                }
            }
        });
        tracing::info!(service = queue.label(), "Background processor started");
    }
}
