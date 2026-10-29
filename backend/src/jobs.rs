//! Background maintenance jobs (trash cleanup, unsnooze).

use crate::AppState;
use std::time::Duration;

/// Delete emails that have been in trash for more than 30 days
fn cleanup_old_trashed_emails(state: &AppState) {
    let conn = state.db.conn();
    match conn.execute(
        "DELETE FROM emails WHERE is_trashed = 1 AND trashed_at < unixepoch() - (30 * 24 * 60 * 60)",
        [],
    ) {
        Ok(n) if n > 0 => tracing::info!(count = n, "Cleaned up old trashed emails"),
        Ok(_) => {}
        Err(e) => tracing::error!(error = %e, "Failed to cleanup old trashed emails"),
    }
}

/// Unsnooze emails whose snooze time has expired and notify clients
fn unsnooze_due_emails(state: &AppState) {
    let due: Vec<(String, String)> = {
        let conn = state.db.conn();
        let result = conn
            .prepare_cached(
                "SELECT id, account_id FROM emails WHERE snoozed_until IS NOT NULL AND snoozed_until <= unixepoch()",
            )
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            });
        match result {
            Ok(rows) => {
                for (id, _) in &rows {
                    let _ = conn.execute("UPDATE emails SET snoozed_until = NULL WHERE id = ?", [id]);
                }
                rows
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to unsnooze emails");
                return;
            }
        }
    };
    for (_, account_id) in &due {
        state.realtime.notify_sync_complete(account_id, 1);
    }
    if !due.is_empty() {
        tracing::info!(count = due.len(), "Unsnoozed due emails");
    }
}

pub fn start(state: AppState) {
    let s = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            interval.tick().await;
            cleanup_old_trashed_emails(&s);
        }
    });
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            unsnooze_due_emails(&state);
        }
    });
}
