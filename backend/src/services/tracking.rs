//! Read receipts (open pixel) and link tracking for sent mail.
//!
//! Needs a publicly reachable `PUBLIC_URL`; without one tracking is unavailable and mail is sent untouched.

use crate::providers::SendParams;
use crate::services::send::OutgoingEmail;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use regex::{Captures, Regex};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Opens within this many seconds of sending are ignored (our own copy loading, server-side prefetch)
pub const OPEN_GRACE_SECONDS: i64 = 10;

/// 1x1 transparent GIF
const PIXEL: [u8; 43] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
    0x02, 0x44, 0x01, 0x00, 0x3b,
];

/// Configured public base URL without a trailing slash (None if unset or not http(s))
pub fn public_url() -> Option<String> {
    std::env::var("PUBLIC_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| v.starts_with("http://") || v.starts_with("https://"))
}

fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?is)(<a\b[^>]*?\bhref\s*=\s*)(?:"([^"]*)"|'([^']*)')"#).unwrap())
}

/// Rewrite http(s) `<a href>` targets through `f` (which may decline by returning None)
pub fn rewrite_links(html: &str, f: &mut dyn FnMut(&str) -> Option<String>) -> String {
    link_re()
        .replace_all(html, |c: &Captures| {
            let raw = c.get(2).or_else(|| c.get(3)).map(|m| m.as_str()).unwrap_or("");
            let url = raw.trim().replace("&amp;", "&");
            let lower = url.to_ascii_lowercase();
            if !(lower.starts_with("http://") || lower.starts_with("https://")) {
                return c[0].to_string();
            }
            match f(&url) {
                Some(new) => format!("{}\"{}\"", &c[1], new),
                None => c[0].to_string(),
            }
        })
        .into_owned()
}

/// Append the tracking pixel (before `</body>` when present)
pub fn add_pixel(html: &str, pixel_url: &str) -> String {
    let img = format!(r#"<img src="{pixel_url}" width="1" height="1" alt="" style="display:none">"#);
    match html.to_ascii_lowercase().rfind("</body>") {
        Some(i) => format!("{}{}{}", &html[..i], img, &html[i..]),
        None => format!("{html}{img}"),
    }
}

/// Create the tracking rows for an outgoing message and rewrite `params.body`.
/// Returns the tracking id, or None when tracking is off or unavailable.
pub fn prepare(state: &AppState, email: &OutgoingEmail, params: &mut SendParams) -> Option<String> {
    let base = public_url()?;
    if !(email.track_opens || email.track_links) {
        return None;
    }
    let tracking_id = uuid::Uuid::new_v4().to_string();
    let token = new_token();
    let mut links: Vec<(String, String)> = Vec::new();
    let mut body = params.body.clone();
    if email.track_links {
        body = rewrite_links(&body, &mut |url| {
            if url.starts_with(&base) {
                return None;
            }
            let link_token = new_token();
            links.push((link_token.clone(), url.to_string()));
            Some(format!("{base}/t/c/{link_token}"))
        });
    }
    if email.track_opens {
        body = add_pixel(&body, &format!("{base}/t/o/{token}.gif"));
    }
    {
        let conn = state.db.conn();
        let inserted = conn.execute(
            "INSERT INTO email_tracking (id, token, account_id, recipients, subject, track_opens, track_links)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                tracking_id,
                token,
                email.account_id,
                email.to,
                email.subject,
                email.track_opens,
                email.track_links
            ],
        );
        if let Err(e) = inserted {
            tracing::error!(error = %e, "Failed to create tracking row, sending untracked");
            return None;
        }
        for (link_token, url) in &links {
            let _ = conn.execute(
                "INSERT INTO tracking_links (id, tracking_id, url) VALUES (?, ?, ?)",
                (link_token, &tracking_id, url),
            );
        }
    }
    params.local_body = Some(std::mem::replace(&mut params.body, body));
    Some(tracking_id)
}

/// Link the tracking row to the sent message once the provider returned its id
pub fn finish(state: &AppState, tracking_id: &str, message_id: Option<&str>, success: bool) {
    let conn = state.db.conn();
    if !success {
        let _ = conn.execute("DELETE FROM email_tracking WHERE id = ?", [tracking_id]);
        return;
    }
    let Some(message_id) = message_id else { return };
    // IMAP stores the sent copy under its own id; Gmail/Graph ids are the email id
    let email_id: String = conn
        .query_row(
            "SELECT id FROM emails WHERE message_id = ? ORDER BY created_at DESC LIMIT 1",
            [message_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| message_id.to_string());
    let _ = conn.execute(
        "UPDATE email_tracking SET email_id = ?, message_id = ? WHERE id = ?",
        (email_id, message_id, tracking_id),
    );
}

/// Attach a `tracking` summary to each row (by `id`) with one aggregate query
pub fn attach(conn: &rusqlite::Connection, rows: &mut [Value]) {
    let ids: Vec<String> = rows.iter().filter_map(|r| r["id"].as_str().map(str::to_string)).collect();
    if ids.is_empty() {
        return;
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT t.email_id, t.track_opens, t.track_links,
                COALESCE(SUM(e.type = 'open'), 0), COALESCE(SUM(e.type = 'click'), 0),
                MIN(CASE WHEN e.type = 'open' THEN e.created_at END),
                MAX(CASE WHEN e.type = 'open' THEN e.created_at END),
                MAX(CASE WHEN e.type = 'click' THEN e.created_at END)
         FROM email_tracking t LEFT JOIN tracking_events e ON e.tracking_id = t.id
         WHERE t.email_id IN ({placeholders}) GROUP BY t.id"
    );
    let Ok(mut stmt) = conn.prepare_cached(&sql) else { return };
    let mapped = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
        Ok((
            r.get::<_, String>(0)?,
            json!({
                "trackOpens": r.get::<_, i64>(1)? != 0,
                "trackLinks": r.get::<_, i64>(2)? != 0,
                "opens": r.get::<_, i64>(3)?,
                "clicks": r.get::<_, i64>(4)?,
                "firstOpenedAt": r.get::<_, Option<i64>>(5)?,
                "lastOpenedAt": r.get::<_, Option<i64>>(6)?,
                "lastClickedAt": r.get::<_, Option<i64>>(7)?,
            }),
        ))
    });
    let Ok(mapped) = mapped else { return };
    let summaries: HashMap<String, Value> = mapped.flatten().collect();
    for row in rows.iter_mut() {
        if let Some(s) = row["id"].as_str().and_then(|id| summaries.get(id)) {
            row["tracking"] = s.clone();
        }
    }
}

/// Raw event list for one email (newest first)
pub fn events(conn: &rusqlite::Connection, email_id: &str) -> Vec<Value> {
    db::query_all(
        conn,
        "SELECT e.type, e.url, e.created_at AS createdAt, e.user_agent AS userAgent
         FROM tracking_events e JOIN email_tracking t ON t.id = e.tracking_id
         WHERE t.email_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT 200",
        [email_id],
    )
    .unwrap_or_default()
}

// ---------- Public endpoints ----------

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(|v| v.chars().take(500).collect())
}

fn record(state: &AppState, tracking_id: &str, kind: &str, url: Option<&str>, headers: &HeaderMap) -> Option<i64> {
    let ip = header_str(headers, "x-forwarded-for")
        .map(|v| v.split(',').next().unwrap_or("").trim().to_string())
        .or_else(|| header_str(headers, "x-real-ip"));
    let ua = header_str(headers, "user-agent");
    let conn = state.db.conn();
    conn.execute(
        "INSERT INTO tracking_events (tracking_id, type, url, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![tracking_id, kind, url, ip, ua],
    )
    .ok()?;
    conn.query_row(
        "SELECT COUNT(*) FROM tracking_events WHERE tracking_id = ? AND type = ?",
        (tracking_id, kind),
        |r| r.get(0),
    )
    .ok()
}

fn notify(state: &AppState, tracking_id: &str, kind: &str, count: i64, url: Option<&str>) {
    let row = db::query_one(
        &state.db.conn(),
        "SELECT account_id, email_id, subject FROM email_tracking WHERE id = ?",
        [tracking_id],
    )
    .ok()
    .flatten();
    if let Some(row) = row {
        state.realtime.notify_tracking(
            row["account_id"].as_str().unwrap_or(""),
            row["email_id"].as_str().unwrap_or(""),
            row["subject"].as_str().unwrap_or(""),
            kind,
            count,
            url,
        );
    }
}

fn pixel_response() -> Response {
    (
        [
            (header::CONTENT_TYPE, "image/gif"),
            (header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, max-age=0"),
            (header::PRAGMA, "no-cache"),
        ],
        PIXEL.to_vec(),
    )
        .into_response()
}

async fn open(State(s): State<AppState>, Path(file): Path<String>, headers: HeaderMap) -> Response {
    let token = file.strip_suffix(".gif").unwrap_or(&file);
    let found = {
        let conn = s.db.conn();
        conn.query_row(
            "SELECT id, created_at FROM email_tracking WHERE token = ? AND track_opens = 1",
            [token],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .ok()
    };
    if let Some((id, created)) = found {
        if db::now() - created.unwrap_or(0) >= OPEN_GRACE_SECONDS {
            if let Some(count) = record(&s, &id, "open", None, &headers) {
                notify(&s, &id, "open", count, None);
            }
        }
    }
    pixel_response()
}

async fn click(State(s): State<AppState>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    // Only URLs stored at send time are ever redirected to
    let found = {
        let conn = s.db.conn();
        conn.query_row(
            "SELECT tracking_id, url FROM tracking_links WHERE id = ?",
            [&token],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .ok()
    };
    let Some((tracking_id, url)) = found else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if let Some(count) = record(&s, &tracking_id, "click", Some(&url), &headers) {
        notify(&s, &tracking_id, "click", count, Some(&url));
    }
    (
        StatusCode::FOUND,
        [(header::LOCATION, url), (header::CACHE_CONTROL, "no-store".to_string())],
    )
        .into_response()
}

pub fn router() -> Router<AppState> {
    Router::new().route("/o/{file}", get(open)).route("/c/{token}", get(click))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_only_http_links() {
        let html = r##"<p><a href="https://a.com/x?a=1&amp;b=2">A</a> <a class="k" href='http://b.com'>B</a> <a href="mailto:x@y.com">M</a> <a href="#top">T</a></p>"##;
        let mut seen = Vec::new();
        let out = rewrite_links(html, &mut |u| {
            seen.push(u.to_string());
            Some("https://t/c/1".into())
        });
        assert_eq!(seen, vec!["https://a.com/x?a=1&b=2", "http://b.com"]);
        assert!(out.contains(r#"<a href="https://t/c/1">A</a>"#));
        assert!(out.contains(r#"<a class="k" href="https://t/c/1">B</a>"#));
        assert!(out.contains("mailto:x@y.com") && out.contains("#top"));
    }

    #[test]
    fn pixel_goes_before_body_end() {
        let out = add_pixel("<html><body><p>Hi</p></BODY></html>", "https://t/o/x.gif");
        assert!(out.contains(r#"alt="" style="display:none"></BODY>"#));
        assert!(add_pixel("<p>Hi</p>", "https://t/o/x.gif").ends_with("display:none\">"));
    }
}
