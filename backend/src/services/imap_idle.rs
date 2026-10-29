//! IMAP IDLE connection manager (port of backend/src/services/imap-idle.ts).
//! Maintains persistent connections to IMAP servers for real-time notifications.

use crate::providers::imap_common::{self, ImapConfig, ImapSession};
use crate::providers::{get_provider, SyncOptions};
use crate::AppState;
use async_imap::extensions::idle::IdleResponse;
use async_imap::imap_proto::{MailboxDatum, Response};
use async_imap::types::UnsolicitedResponse;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

/// Re-issue IDLE before the 30-minute server timeout (RFC 2177)
const IDLE_TIMEOUT: Duration = Duration::from_secs(29 * 60);
const RECONNECT_DELAY: Duration = Duration::from_secs(30);

struct IdleConnection {
    /// Distinguishes this connection from a later one for the same account
    generation: u64,
    task: tokio::task::JoinHandle<()>,
}

static CONNECTIONS: LazyLock<Mutex<HashMap<String, IdleConnection>>> = LazyLock::new(Default::default);
/// Pending reconnect timers (TS `reconnectTimeout`), cancelled by `stop_idle`
static RECONNECTS: LazyLock<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> = LazyLock::new(Default::default);
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn is_imap_account(state: &AppState, account_id: &str) -> bool {
    let conn = state.db.conn();
    crate::emails_db::account_field(&conn, account_id, "provider_type").as_deref() == Some("imap")
}

fn imap_account_ids(state: &AppState) -> Vec<String> {
    let conn = state.db.conn();
    conn.prepare("SELECT id FROM accounts WHERE provider_type = 'imap'")
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0))?.collect())
        .unwrap_or_default()
}

/// Start IDLE for an IMAP account. Returns true if connected (or already connected).
pub fn start_idle(state: AppState, account_id: String) -> futures::future::BoxFuture<'static, bool> {
    Box::pin(start_idle_inner(state, account_id))
}

async fn start_idle_inner(state: AppState, account_id: String) -> bool {
    // Don't start if already connected
    if CONNECTIONS.lock().unwrap().contains_key(&account_id) {
        return true;
    }
    if !is_imap_account(&state, &account_id) {
        return false;
    }
    let cfg = match ImapConfig::from_account(&state, &account_id) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(service = "imap-idle", account_id, error = %e, "Failed to start IDLE");
            return false;
        }
    };

    let connected: Result<(ImapSession, u32), imap_common::ImapErr> = async {
        let mut s = imap_common::connect(&cfg).await?;
        // Select INBOX for IDLE
        let exists = imap_common::select(&mut s, "INBOX").await?;
        Ok((s, exists))
    }
    .await;
    let (session, exists) = match connected {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(service = "imap-idle", account_id, error = %e, "Failed to start IDLE");
            return false;
        }
    };

    let mut conns = CONNECTIONS.lock().unwrap();
    if conns.contains_key(&account_id) {
        // Lost a race with a concurrent start; drop our session
        return true;
    }
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let task = tokio::spawn(idle_loop(state, account_id.clone(), generation, session, exists));
    conns.insert(account_id.clone(), IdleConnection { generation, task });
    tracing::info!(service = "imap-idle", account_id, "IDLE started");
    true
}

/// Stop IDLE for an account
pub async fn stop_idle(account_id: &str) {
    if let Some(r) = RECONNECTS.lock().unwrap().remove(account_id) {
        r.abort();
    }
    let conn = CONNECTIONS.lock().unwrap().remove(account_id);
    if let Some(c) = conn {
        // Aborting drops the session/socket (no graceful LOGOUT while mid-IDLE)
        c.task.abort();
        tracing::info!(service = "imap-idle", account_id, "IDLE stopped");
    }
}

/// Start IDLE for all IMAP accounts (spawned; returns immediately)
pub fn start_all_idle(state: AppState) {
    tokio::spawn(async move {
        let ids = imap_account_ids(&state);
        tracing::info!(
            service = "imap-idle",
            count = ids.len(),
            "Starting IDLE for IMAP accounts"
        );
        for id in ids {
            start_idle(state.clone(), id).await;
        }
    });
}

/// Stop all IDLE connections
#[allow(dead_code)]
pub async fn stop_all_idle() {
    let ids: Vec<String> = CONNECTIONS.lock().unwrap().keys().cloned().collect();
    for id in ids {
        stop_idle(&id).await;
    }
}

/// Status of IDLE connections: `[{ accountId, connected }]`
pub fn get_idle_status(state: &AppState) -> Value {
    let conns = CONNECTIONS.lock().unwrap();
    Value::Array(
        imap_account_ids(state)
            .into_iter()
            .map(|id| {
                let connected = conns.contains_key(&id);
                json!({ "accountId": id, "connected": connected })
            })
            .collect(),
    )
}

enum Change {
    Exists(u32),
    Expunge,
}

fn classify(resp: &Response<'_>) -> Option<Change> {
    match resp {
        Response::MailboxData(MailboxDatum::Exists(n)) => Some(Change::Exists(*n)),
        Response::Expunge(_) => Some(Change::Expunge),
        _ => None,
    }
}

async fn idle_loop(state: AppState, account_id: String, generation: u64, mut session: ImapSession, mut count: u32) {
    let err = loop {
        let mut idle = session.idle();
        if let Err(e) = idle.init().await {
            break e.to_string();
        }
        let (result, mut changes) = {
            let (fut, _stop) = idle.wait_with_timeout(IDLE_TIMEOUT);
            let r = fut.await;
            let mut changes = Vec::new();
            if let Ok(IdleResponse::NewData(data)) = &r {
                changes.extend(classify(data.parsed()));
            }
            (r, changes)
        };
        if let Err(e) = result {
            break e.to_string();
        }
        session = match idle.done().await {
            Ok(s) => s,
            Err(e) => break e.to_string(),
        };
        // Responses that arrived while terminating IDLE are queued as unsolicited
        while let Ok(u) = session.unsolicited_responses.try_recv() {
            match u {
                UnsolicitedResponse::Exists(n) => changes.push(Change::Exists(n)),
                UnsolicitedResponse::Expunge(_) => changes.push(Change::Expunge),
                _ => {}
            }
        }
        for change in changes {
            match change {
                Change::Expunge => count = count.saturating_sub(1),
                Change::Exists(n) => {
                    let prev = count;
                    count = n;
                    if n > prev {
                        tracing::info!(
                            service = "imap-idle",
                            account_id,
                            new_count = n,
                            prev_count = prev,
                            "New mail detected"
                        );
                        tokio::spawn(on_new_mail(state.clone(), account_id.clone()));
                    }
                }
            }
        }
    };

    tracing::info!(service = "imap-idle", account_id, error = %err, "Connection closed");
    {
        let mut conns = CONNECTIONS.lock().unwrap();
        if conns.get(&account_id).map(|c| c.generation) != Some(generation) {
            return; // stopped or replaced
        }
        conns.remove(&account_id);
    }
    // Attempt to reconnect after 30 seconds (retries every 30s until it succeeds or is stopped)
    let (s, id) = (state.clone(), account_id.clone());
    let timer = tokio::spawn(async move {
        loop {
            tokio::time::sleep(RECONNECT_DELAY).await;
            if start_idle(s.clone(), id.clone()).await || !is_imap_account(&s, &id) {
                break;
            }
        }
        RECONNECTS.lock().unwrap().remove(&id);
    });
    RECONNECTS.lock().unwrap().insert(account_id, timer);
}

/// Trigger a quick sync and notify connected clients with the latest email's details
async fn on_new_mail(state: AppState, account_id: String) {
    let provider = match get_provider(&state, &account_id) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(service = "imap-idle", account_id, error = %e, "Sync error after new mail detection");
            state.realtime.notify_new_mail(&account_id, None);
            return;
        }
    };
    let result = provider
        .sync(SyncOptions {
            max_messages: Some(10),
            ..Default::default()
        })
        .await;
    if let Some(e) = &result.error {
        // TS only logs when sync throws; Rust sync reports errors in the result — still notify with details
        tracing::warn!(service = "imap-idle", account_id, error = %e, "Sync after new mail reported an error");
    }
    let latest = {
        let conn = state.db.conn();
        conn.query_row(
            "SELECT from_name, from_email, subject, is_important FROM emails
             WHERE account_id = ? AND is_trashed = 0 ORDER BY received_at DESC LIMIT 1",
            [&account_id],
            |r| {
                let from_name: Option<String> = r.get(0)?;
                let from_email: Option<String> = r.get(1)?;
                let subject: Option<String> = r.get(2)?;
                let important: Option<i64> = r.get(3)?;
                Ok(json!({
                    "from": from_name.filter(|s| !s.is_empty()).or(from_email).unwrap_or_default(),
                    "subject": subject.filter(|s| !s.is_empty()).unwrap_or_else(|| "(no subject)".into()),
                    "isImportant": important.unwrap_or(0) != 0,
                }))
            },
        )
        .ok()
    };
    state.realtime.notify_new_mail(&account_id, latest);
}
