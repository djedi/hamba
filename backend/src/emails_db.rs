//! Shared email persistence helpers used by every provider.

use rusqlite::{Connection, OptionalExtension};

/// Row for `emails` upsert; same column order as `emailQueries.upsert` in the TS backend.
#[derive(Debug, Clone, Default)]
pub struct EmailRow {
    pub id: String,
    pub account_id: String,
    pub thread_id: Option<String>,
    pub message_id: Option<String>,
    pub subject: String,
    pub snippet: String,
    pub from_name: String,
    pub from_email: String,
    pub to_addresses: String,
    pub cc_addresses: Option<String>,
    pub bcc_addresses: Option<String>,
    pub body_text: String,
    pub body_html: String,
    pub labels: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub received_at: i64,
    pub folder: String,
}

/// Insert or update an email keyed on its RFC Message-ID.
pub fn upsert_email(conn: &Connection, e: &EmailRow) -> rusqlite::Result<usize> {
    conn.prepare_cached(
        "INSERT INTO emails (
           id, account_id, thread_id, message_id, subject, snippet,
           from_name, from_email, to_addresses, cc_addresses, bcc_addresses,
           body_text, body_html, labels, is_read, is_starred, received_at, folder
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           subject = excluded.subject,
           snippet = excluded.snippet,
           labels = excluded.labels,
           is_read = excluded.is_read,
           is_starred = excluded.is_starred,
           folder = excluded.folder",
    )?
    .execute(rusqlite::params![
        e.id,
        e.account_id,
        e.thread_id,
        e.message_id,
        e.subject,
        e.snippet,
        e.from_name,
        e.from_email,
        e.to_addresses,
        e.cc_addresses,
        e.bcc_addresses,
        e.body_text,
        e.body_html,
        e.labels,
        e.is_read as i64,
        e.is_starred as i64,
        e.received_at,
        e.folder,
    ])
}

/// Store an attachment, ignoring duplicates (`attachmentQueries.insert`).
pub fn insert_attachment(
    conn: &Connection,
    id: &str,
    email_id: &str,
    content_id: Option<&str>,
    filename: &str,
    mime_type: &str,
    data: &[u8],
) -> rusqlite::Result<usize> {
    conn.prepare_cached(
        "INSERT OR IGNORE INTO attachments (id, email_id, content_id, filename, mime_type, size, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )?
    .execute(rusqlite::params![
        id,
        email_id,
        content_id,
        filename,
        mime_type,
        data.len() as i64,
        data
    ])
}

/// Upsert a label (`labelQueries.upsert`).
pub fn upsert_label(
    conn: &Connection,
    id: &str,
    account_id: &str,
    name: &str,
    color: Option<&str>,
    label_type: &str,
    remote_id: Option<&str>,
) -> rusqlite::Result<usize> {
    conn.prepare_cached(
        "INSERT INTO labels (id, account_id, name, color, type, remote_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, name) DO UPDATE SET
           color = COALESCE(excluded.color, labels.color),
           type = excluded.type,
           remote_id = COALESCE(excluded.remote_id, labels.remote_id)",
    )?
    .execute((id, account_id, name, color, label_type, remote_id))
}

/// Upsert a draft synced from the server (`draftQueries.upsert`).
#[allow(clippy::too_many_arguments)]
pub fn upsert_draft(
    conn: &Connection,
    id: &str,
    account_id: &str,
    remote_id: Option<&str>,
    to: &str,
    cc: &str,
    bcc: &str,
    subject: &str,
    body: &str,
) -> rusqlite::Result<usize> {
    conn.prepare_cached(
        "INSERT INTO drafts (id, account_id, remote_id, to_addresses, cc_addresses, bcc_addresses, subject, body, reply_to_id, reply_mode, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, unixepoch())
         ON CONFLICT(id) DO UPDATE SET
           to_addresses = excluded.to_addresses,
           cc_addresses = excluded.cc_addresses,
           bcc_addresses = excluded.bcc_addresses,
           subject = excluded.subject,
           body = excluded.body,
           updated_at = unixepoch()",
    )?
    .execute((id, account_id, remote_id, to, cc, bcc, subject, body))
}

/// Look up a column of the account row as a string (INTEGER/REAL columns are stringified).
pub fn account_field(conn: &Connection, account_id: &str, column: &str) -> Option<String> {
    use rusqlite::types::ValueRef;
    let sql = format!("SELECT {column} FROM accounts WHERE id = ?");
    conn.query_row(&sql, [account_id], |r| {
        Ok(match r.get_ref(0)? {
            ValueRef::Null => None,
            ValueRef::Integer(n) => Some(n.to_string()),
            ValueRef::Real(f) => Some(f.to_string()),
            ValueRef::Text(t) | ValueRef::Blob(t) => Some(String::from_utf8_lossy(t).into_owned()),
        })
    })
    .optional()
    .ok()
    .flatten()
    .flatten()
}

/// Derive plain text from HTML and a 200-char snippet
pub fn html_to_text(html: &str) -> String {
    static TAG_RE: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"<[^>]*>").unwrap());
    static WS_RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\s+").unwrap());
    WS_RE
        .replace_all(&TAG_RE.replace_all(html, " "), " ")
        .trim()
        .to_string()
}

pub fn snippet(text: &str) -> String {
    text.chars().take(200).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_field_stringifies_integers() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (id TEXT, imap_use_tls INTEGER, imap_port INTEGER, imap_host TEXT, password TEXT);
                            INSERT INTO accounts VALUES ('a', 1, 993, 'h', NULL);",
        )
        .unwrap();
        assert_eq!(account_field(&conn, "a", "imap_use_tls").as_deref(), Some("1"));
        assert_eq!(account_field(&conn, "a", "imap_port").as_deref(), Some("993"));
        assert_eq!(account_field(&conn, "a", "imap_host").as_deref(), Some("h"));
        assert_eq!(account_field(&conn, "a", "password"), None);
        assert_eq!(account_field(&conn, "missing", "imap_host"), None);
    }
}
