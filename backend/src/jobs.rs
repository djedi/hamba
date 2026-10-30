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
    let due: Vec<(String, String, String)> = {
        let conn = state.db.conn();
        let result = conn
            .prepare_cached(
                "SELECT id, account_id, COALESCE(subject, '') FROM emails WHERE snoozed_until IS NOT NULL AND snoozed_until <= unixepoch()",
            )
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()
            });
        match result {
            Ok(rows) => {
                // Resurface at the top of the inbox as unread
                for (id, _, _) in &rows {
                    let _ = conn.execute(
                        "UPDATE emails SET snoozed_until = NULL, is_read = 0, received_at = unixepoch() WHERE id = ?",
                        [id],
                    );
                }
                rows
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to unsnooze emails");
                return;
            }
        }
    };
    for (id, account_id, subject) in &due {
        state.realtime.notify_unsnoozed(account_id, id, subject);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsnooze_resurfaces_email_as_unread_at_top() {
        let db = crate::db::Db::open(":memory:").unwrap();
        db.conn()
            .execute_batch(
                "INSERT INTO accounts (id, email, name, provider_type) VALUES ('a', 'me@x.com', 'Me', 'imap');
                 INSERT INTO emails (id, account_id, message_id, subject, is_read, received_at, snoozed_until)
                 VALUES ('due', 'a', '<1>', 'Due', 1, 1000, 5), ('later', 'a', '<2>', 'Later', 1, 1000, 9999999999);",
            )
            .unwrap();
        let state = AppState { db, realtime: Default::default(), auth: false };
        unsnooze_due_emails(&state);
        let conn = state.db.conn();
        let (snoozed, read, received): (Option<i64>, i64, i64) = conn
            .query_row("SELECT snoozed_until, is_read, received_at FROM emails WHERE id = 'due'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((snoozed, read), (None, 0));
        assert!(received > 1000);
        let still: Option<i64> = conn
            .query_row("SELECT snoozed_until FROM emails WHERE id = 'later'", [], |r| r.get(0))
            .unwrap();
        assert!(still.is_some());
    }
}
