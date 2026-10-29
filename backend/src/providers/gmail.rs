//! Gmail API provider (port of backend/src/services/providers/gmail.ts).
use super::*;
use crate::emails_db::{self, EmailRow};
use crate::services::token::{get_valid_access_token, TokenResult};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashSet;

const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const BATCH_SIZE: usize = 20;

/// System labels that should not be synced
const SYSTEM_LABELS: &[&str] = &[
    "INBOX",
    "SENT",
    "DRAFT",
    "TRASH",
    "SPAM",
    "STARRED",
    "UNREAD",
    "IMPORTANT",
    "CATEGORY_PERSONAL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
];

fn label_color(id: &str) -> &'static str {
    match id {
        "INBOX" => "#4285f4",
        "SENT" => "#34a853",
        "STARRED" => "#fbbc05",
        "IMPORTANT" => "#ea4335",
        _ => "#6366f1",
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentInfo {
    pub attachment_id: String,
    pub content_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
}

fn get_header(headers: Option<&Value>, name: &str) -> String {
    headers
        .and_then(Value::as_array)
        .and_then(|hs| {
            hs.iter().find(|h| {
                h.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        })
        .and_then(|h| h.get("value").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

/// Split a `From` header into (name, email).
///
/// Deviation: the TS regex `^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$` backtracks on
/// unquoted headers ("Bob <bob@x.com>" -> name "Bob <bob@x.co", email "m").
/// This parses the intended `Name <addr>` / bare `addr` forms instead.
pub fn parse_from(from: &str) -> (String, String) {
    let f = from.trim();
    if let (Some(lt), true) = (f.rfind('<'), f.ends_with('>')) {
        let email = f[lt + 1..f.len() - 1].trim().to_string();
        let name = f[..lt].trim().trim_matches('"').trim().to_string();
        if !email.is_empty() {
            return (name, email);
        }
    }
    (
        String::new(),
        if f.is_empty() { from.to_string() } else { f.to_string() },
    )
}

/// Decode Gmail base64 / base64url data leniently (like Node's Buffer.from(.., "base64")).
pub fn decode_b64(data: &str) -> Vec<u8> {
    let cleaned: String = data
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .collect();
    base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(cleaned)
        .unwrap_or_default()
}

/// Parse a Gmail message resource into an `EmailRow` (body left empty).
pub fn parse_gmail_message(msg: &Value, account_id: &str, folder: &str) -> EmailRow {
    let headers = msg.pointer("/payload/headers");
    let from_header = get_header(headers, "From");
    let (from_name, from_email) = parse_from(&from_header);
    let label_ids: Vec<&str> = msg
        .get("labelIds")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let internal: i64 = msg
        .get("internalDate")
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()))
        .unwrap_or(0);
    EmailRow {
        id: msg.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        account_id: account_id.to_string(),
        thread_id: msg.get("threadId").and_then(Value::as_str).map(str::to_string),
        message_id: Some(get_header(headers, "Message-ID")),
        subject: get_header(headers, "Subject"),
        snippet: msg
            .get("snippet")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        from_name,
        from_email,
        to_addresses: get_header(headers, "To"),
        cc_addresses: Some(get_header(headers, "Cc")),
        bcc_addresses: Some(get_header(headers, "Bcc")),
        body_text: String::new(),
        body_html: String::new(),
        labels: serde_json::to_string(&label_ids).unwrap_or_else(|_| "[]".into()),
        is_read: !label_ids.contains(&"UNREAD"),
        is_starred: label_ids.contains(&"STARRED"),
        received_at: internal / 1000,
        folder: folder.to_string(),
    }
}

/// Walk the MIME part tree, returning (text, html, attachments).
pub fn extract_body_and_attachments(payload: &Value) -> (String, String, Vec<AttachmentInfo>) {
    fn walk(part: &Value, text: &mut String, html: &mut String, atts: &mut Vec<AttachmentInfo>) {
        let mime = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
        let data = part
            .pointer("/body/data")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        let att_id = part
            .pointer("/body/attachmentId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        if let (Some(data), "text/plain") = (data, mime) {
            *text = String::from_utf8_lossy(&decode_b64(data)).into_owned();
        } else if let (Some(data), "text/html") = (data, mime) {
            *html = String::from_utf8_lossy(&decode_b64(data)).into_owned();
        } else if let Some(att_id) = att_id {
            let cid = get_header(part.get("headers"), "Content-ID");
            let cid = cid.strip_prefix('<').unwrap_or(&cid);
            let cid = cid.strip_suffix('>').unwrap_or(cid);
            atts.push(AttachmentInfo {
                attachment_id: att_id.to_string(),
                content_id: Some(cid.to_string()).filter(|s| !s.is_empty()),
                filename: part
                    .get("filename")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("attachment")
                    .to_string(),
                mime_type: mime.to_string(),
                size: part.pointer("/body/size").and_then(Value::as_i64).unwrap_or(0),
            });
        }
        if let Some(parts) = part.get("parts").and_then(Value::as_array) {
            for p in parts {
                walk(p, text, html, atts);
            }
        }
    }
    let (mut text, mut html, mut atts) = (String::new(), String::new(), Vec::new());
    walk(payload, &mut text, &mut html, &mut atts);
    (text, html, atts)
}

#[derive(Default)]
pub struct RawEmail<'a> {
    pub from: &'a str,
    pub to: &'a str,
    pub cc: Option<&'a str>,
    pub bcc: Option<&'a str>,
    pub subject: &'a str,
    pub body: &'a str,
    pub in_reply_to: Option<&'a str>,
    pub references: Option<&'a str>,
    pub attachments: &'a [Attachment],
}

/// Build the RFC 2822 message (unencoded), with a caller-provided boundary.
pub fn build_raw_mime(o: &RawEmail, boundary: &str) -> String {
    let nonempty = |v: Option<&str>| v.filter(|s| !s.is_empty()).map(str::to_string);
    let mut lines: Vec<String> = vec![format!("From: {}", o.from), format!("To: {}", o.to)];
    if let Some(cc) = nonempty(o.cc) {
        lines.push(format!("Cc: {cc}"));
    }
    if let Some(bcc) = nonempty(o.bcc) {
        lines.push(format!("Bcc: {bcc}"));
    }
    lines.push(format!("Subject: {}", o.subject));
    if let Some(v) = nonempty(o.in_reply_to) {
        lines.push(format!("In-Reply-To: {v}"));
    }
    if let Some(v) = nonempty(o.references) {
        lines.push(format!("References: {v}"));
    }
    lines.push("MIME-Version: 1.0".into());
    if !o.attachments.is_empty() {
        lines.push(format!("Content-Type: multipart/mixed; boundary=\"{boundary}\""));
        lines.push(String::new());
        lines.push(format!("--{boundary}"));
        lines.push("Content-Type: text/html; charset=\"UTF-8\"".into());
        lines.push("Content-Transfer-Encoding: base64".into());
        lines.push(String::new());
        lines.push(STANDARD.encode(o.body));
        for att in o.attachments {
            lines.push(format!("--{boundary}"));
            lines.push(format!("Content-Type: {}; name=\"{}\"", att.mime_type, att.filename));
            lines.push(format!(
                "Content-Disposition: attachment; filename=\"{}\"",
                att.filename
            ));
            lines.push("Content-Transfer-Encoding: base64".into());
            lines.push(String::new());
            lines.push(att.content.clone());
        }
        lines.push(format!("--{boundary}--"));
    } else {
        lines.push("Content-Type: text/html; charset=\"UTF-8\"".into());
        lines.push(String::new());
        lines.push(o.body.to_string());
    }
    lines.join("\r\n")
}

/// Build the base64url-encoded raw message the Gmail API expects.
pub fn build_raw_email(o: &RawEmail) -> String {
    let boundary = format!("boundary_{}", uuid::Uuid::new_v4().simple());
    URL_SAFE_NO_PAD.encode(build_raw_mime(o, &boundary))
}

fn api_error(v: &Value) -> Option<String> {
    v.pointer("/error/message").and_then(Value::as_str).map(str::to_string)
}

pub struct GmailProvider {
    state: AppState,
    account_id: String,
    http: reqwest::Client,
}

impl GmailProvider {
    pub fn new(state: AppState, account_id: String) -> Self {
        Self {
            state,
            account_id,
            http: reqwest::Client::new(),
        }
    }

    async fn token(&self) -> TokenResult {
        get_valid_access_token(&self.state, &self.account_id).await
    }

    async fn require_token(&self) -> ProviderResult<String> {
        self.token().await.token.ok_or_else(|| "Not authenticated".to_string())
    }

    async fn get_json(&self, url: &str, token: &str) -> Result<(u16, Value), String> {
        let r = self
            .http
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = r.status().as_u16();
        Ok((status, r.json().await.unwrap_or(Value::Null)))
    }

    /// Execute a request and convert non-2xx into the Gmail error message.
    async fn exec(&self, req: reqwest::RequestBuilder) -> ProviderResult<()> {
        let r = req.send().await.map_err(|e| e.to_string())?;
        if r.status().is_success() {
            return Ok(());
        }
        let status = r.status().as_u16();
        let v: Value = r.json().await.unwrap_or(Value::Null);
        Err(api_error(&v).unwrap_or_else(|| format!("Gmail API error: {status}")))
    }

    /// Sync Gmail labels to local database
    pub async fn sync_labels(&self) {
        let Some(token) = self.token().await.token else { return };
        let Ok((status, data)) = self.get_json(&format!("{API}/labels"), &token).await else {
            tracing::error!("[Gmail] Error syncing labels");
            return;
        };
        if !(200..300).contains(&status) {
            return;
        }
        let conn = self.state.db.conn();
        for label in data.get("labels").and_then(Value::as_array).into_iter().flatten() {
            let id = label.get("id").and_then(Value::as_str).unwrap_or_default();
            let ty = label.get("type").and_then(Value::as_str).unwrap_or_default();
            if SYSTEM_LABELS.contains(&id) || ty == "system" {
                continue;
            }
            let name = label.get("name").and_then(Value::as_str).unwrap_or_default();
            let local_id = format!("gmail:{}:{id}", self.account_id);
            let kind = if ty == "user" { "user" } else { "system" };
            if let Err(e) = emails_db::upsert_label(
                &conn,
                &local_id,
                &self.account_id,
                name,
                Some(label_color(id)),
                kind,
                Some(id),
            ) {
                tracing::error!(error = %e, "[Gmail] Error syncing labels");
            }
        }
    }

    fn associate_email_labels(&self, conn: &rusqlite::Connection, email_id: &str, label_ids: &[Value]) {
        let _ = conn.execute("DELETE FROM email_labels WHERE email_id = ?", [email_id]);
        for lid in label_ids.iter().filter_map(Value::as_str) {
            if SYSTEM_LABELS.contains(&lid) {
                continue;
            }
            let local = format!("gmail:{}:{lid}", self.account_id);
            let exists: bool = conn
                .query_row("SELECT 1 FROM labels WHERE id = ?", [&local], |_| Ok(()))
                .is_ok();
            if exists {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)",
                    [email_id, &local],
                );
            }
        }
    }

    /// Fetch full message resources for ids, BATCH_SIZE at a time.
    async fn fetch_full(&self, urls: Vec<String>, token: &str) -> Vec<Value> {
        let mut out = Vec::with_capacity(urls.len());
        for chunk in urls.chunks(BATCH_SIZE) {
            let futs = chunk.iter().map(|u| async move {
                match self.http.get(u).bearer_auth(token).send().await {
                    Ok(r) => r
                        .json::<Value>()
                        .await
                        .unwrap_or_else(|e| json!({ "error": e.to_string() })),
                    Err(e) => json!({ "error": e.to_string() }),
                }
            });
            out.extend(futures::future::join_all(futs).await);
        }
        out
    }

    /// Shared inbox/sent sync. Returns (synced, total, seen ids, has_more, server_total) or an error result.
    async fn sync_label(
        &self,
        label: &str,
        folder: &str,
        options: &SyncOptions,
        err_default: &str,
    ) -> Result<(i64, i64, HashSet<String>, bool, Option<i64>), SyncResult> {
        let tr = self.token().await;
        let Some(token) = tr.token else {
            return Err(SyncResult {
                error: Some(tr.error.unwrap_or_else(|| "Not authenticated".into())),
                needs_reauth: tr.needs_reauth.then_some(true),
                ..Default::default()
            });
        };
        let max = options.max_messages.filter(|n| *n != 0).unwrap_or(100);
        let url = format!("{API}/messages?maxResults={max}&labelIds={label}");
        let (status, list) = self.get_json(&url, &token).await.map_err(SyncResult::error)?;
        if !(200..300).contains(&status) {
            return Err(SyncResult {
                error: Some(api_error(&list).unwrap_or_else(|| err_default.into())),
                needs_reauth: Some(status == 401 || status == 403),
                ..Default::default()
            });
        }
        let ids: Vec<String> = list
            .get("messages")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let has_more = list
            .get("nextPageToken")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty());
        let server_total = list.get("resultSizeEstimate").and_then(Value::as_i64);

        let urls = ids
            .iter()
            .map(|id| format!("{API}/messages/{id}?format=full"))
            .collect();
        let full = self.fetch_full(urls, &token).await;
        let mut seen = HashSet::new();
        let mut synced = 0;
        for msg in full {
            if msg.get("error").is_some_and(|e| !e.is_null()) {
                continue;
            }
            let mut row = parse_gmail_message(&msg, &self.account_id, folder);
            seen.insert(row.id.clone());
            let (text, html, atts) = extract_body_and_attachments(msg.get("payload").unwrap_or(&Value::Null));
            row.body_text = text;
            row.body_html = html;
            {
                let conn = self.state.db.conn();
                if let Err(e) = emails_db::upsert_email(&conn, &row) {
                    tracing::error!(error = %e, id = row.id, "[Gmail] upsert failed");
                }
                if folder == "inbox" {
                    // Ensure this email is not archived (in case it was moved back to INBOX)
                    let _ = conn.execute("UPDATE emails SET is_archived = 0 WHERE id = ?", [&row.id]);
                }
                if let Some(lids) = msg.get("labelIds").and_then(Value::as_array) {
                    self.associate_email_labels(&conn, &row.id, lids);
                }
            }
            // Fetch and store inline images (with contentId for cid: references)
            for att in atts {
                let Some(cid) = att.content_id.as_deref() else { continue };
                if !att.mime_type.starts_with("image/") {
                    continue;
                }
                let url = format!("{API}/messages/{}/attachments/{}", row.id, att.attachment_id);
                match self.get_json(&url, &token).await {
                    Ok((s, data)) if (200..300).contains(&s) => {
                        let bytes = decode_b64(data.get("data").and_then(Value::as_str).unwrap_or(""));
                        let conn = self.state.db.conn();
                        let _ = emails_db::insert_attachment(
                            &conn,
                            &format!("{}:{cid}", row.id),
                            &row.id,
                            Some(cid),
                            &att.filename,
                            &att.mime_type,
                            &bytes,
                        );
                    }
                    Ok(_) => {}
                    Err(e) => tracing::error!(error = e, cid, "Failed to fetch attachment"),
                }
            }
            synced += 1;
        }
        Ok((synced, ids.len() as i64, seen, has_more, server_total))
    }

    fn reconcile_archived(&self, seen: &HashSet<String>) -> usize {
        let conn = self.state.db.conn();
        let ids: Vec<String> = conn
            .prepare("SELECT id FROM emails WHERE account_id = ? AND is_archived = 0 AND is_trashed = 0")
            .and_then(|mut s| s.query_map([&self.account_id], |r| r.get(0))?.collect())
            .unwrap_or_default();
        let mut n = 0;
        for id in ids.iter().filter(|id| !seen.contains(*id)) {
            let _ = conn.execute("UPDATE emails SET is_archived = 1 WHERE id = ?", [id]);
            n += 1;
        }
        n
    }

    async fn modify(&self, id: &str, body: Value) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(
            self.http
                .post(format!("{API}/messages/{id}/modify"))
                .bearer_auth(token)
                .json(&body),
        )
        .await
    }
}

#[async_trait]
impl EmailProvider for GmailProvider {
    async fn sync(&self, options: SyncOptions) -> SyncResult {
        let tr = self.token().await;
        if tr.token.is_none() {
            return SyncResult {
                error: Some(tr.error.unwrap_or_else(|| "Not authenticated".into())),
                needs_reauth: tr.needs_reauth.then_some(true),
                ..Default::default()
            };
        }
        // Sync labels first so we can associate them with emails
        self.sync_labels().await;
        match self
            .sync_label("INBOX", "inbox", &options, "Failed to fetch messages")
            .await
        {
            Err(r) => r,
            Ok((synced, total, seen, has_more, server_total)) => {
                let archived = self.reconcile_archived(&seen);
                if archived > 0 {
                    tracing::info!(
                        archived,
                        account_id = self.account_id,
                        "[Gmail] Reconciled archived emails"
                    );
                }
                if let Some(st) = server_total.filter(|n| *n != 0) {
                    options.report_progress(synced, st);
                }
                SyncResult {
                    synced,
                    total,
                    has_more: Some(has_more),
                    server_total,
                    ..Default::default()
                }
            }
        }
    }

    async fn sync_sent(&self, options: SyncOptions) -> SyncResult {
        match self
            .sync_label("SENT", "sent", &options, "Failed to fetch sent messages")
            .await
        {
            Err(r) => r,
            Ok((synced, total, ..)) => SyncResult {
                synced,
                total,
                ..Default::default()
            },
        }
    }

    async fn sync_drafts(&self, options: SyncOptions) -> SyncResult {
        let tr = self.token().await;
        let Some(token) = tr.token else {
            return SyncResult {
                error: Some(tr.error.unwrap_or_else(|| "Not authenticated".into())),
                needs_reauth: tr.needs_reauth.then_some(true),
                ..Default::default()
            };
        };
        let max = options.max_messages.filter(|n| *n != 0).unwrap_or(50);
        let (status, list) = match self.get_json(&format!("{API}/drafts?maxResults={max}"), &token).await {
            Ok(v) => v,
            Err(e) => return SyncResult::error(e),
        };
        if !(200..300).contains(&status) {
            return SyncResult {
                error: Some(api_error(&list).unwrap_or_else(|| "Failed to fetch drafts".into())),
                needs_reauth: Some(status == 401 || status == 403),
                ..Default::default()
            };
        }
        let ids: Vec<String> = list
            .get("drafts")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|d| d.get("id").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let urls = ids.iter().map(|id| format!("{API}/drafts/{id}?format=full")).collect();
        let full = self.fetch_full(urls, &token).await;
        let mut synced = 0;
        let conn = self.state.db.conn();
        for draft in full {
            if draft.get("error").is_some_and(|e| !e.is_null()) {
                continue;
            }
            let msg = draft.get("message").cloned().unwrap_or(Value::Null);
            let parsed = parse_gmail_message(&msg, &self.account_id, "drafts");
            let (text, html, _) = extract_body_and_attachments(msg.get("payload").unwrap_or(&Value::Null));
            let draft_id = draft.get("id").and_then(Value::as_str).unwrap_or_default();
            let body = if html.is_empty() { text } else { html };
            let _ = emails_db::upsert_draft(
                &conn,
                &format!("gmail-draft:{draft_id}"),
                &self.account_id,
                Some(draft_id),
                &parsed.to_addresses,
                parsed.cc_addresses.as_deref().unwrap_or(""),
                parsed.bcc_addresses.as_deref().unwrap_or(""),
                &parsed.subject,
                &body,
            );
            synced += 1;
        }
        SyncResult {
            synced,
            total: ids.len() as i64,
            ..Default::default()
        }
    }

    async fn mark_read(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "removeLabelIds": ["UNREAD"] })).await
    }
    async fn mark_unread(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "addLabelIds": ["UNREAD"] })).await
    }
    async fn star(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "addLabelIds": ["STARRED"] })).await
    }
    async fn unstar(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "removeLabelIds": ["STARRED"] })).await
    }
    async fn archive(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "removeLabelIds": ["INBOX"] })).await
    }
    async fn unarchive(&self, id: &str) -> ProviderResult<()> {
        self.modify(id, json!({ "addLabelIds": ["INBOX"] })).await
    }
    async fn trash(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(self.http.post(format!("{API}/messages/{id}/trash")).bearer_auth(token))
            .await
    }
    async fn untrash(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(
            self.http
                .post(format!("{API}/messages/{id}/untrash"))
                .bearer_auth(token),
        )
        .await
    }
    async fn permanent_delete(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(self.http.delete(format!("{API}/messages/{id}")).bearer_auth(token))
            .await
    }
    async fn delete_draft(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(self.http.delete(format!("{API}/drafts/{id}")).bearer_auth(token))
            .await
    }

    async fn send(&self, p: SendParams) -> SendResult {
        let fail = |e: String| SendResult {
            success: false,
            error: Some(e),
            ..Default::default()
        };
        let (email, name) = {
            let conn = self.state.db.conn();
            let Some(email) = emails_db::account_field(&conn, &self.account_id, "email") else {
                return fail("Account not found".into());
            };
            (email, emails_db::account_field(&conn, &self.account_id, "name"))
        };
        let tr = self.token().await;
        let Some(token) = tr.token else {
            return fail(tr.error.unwrap_or_else(|| "Not authenticated".into()));
        };
        let from = format!(
            "{} <{email}>",
            name.filter(|n| !n.is_empty()).unwrap_or_else(|| email.clone())
        );
        let raw = build_raw_email(&RawEmail {
            from: &from,
            to: &p.to,
            cc: p.cc.as_deref(),
            bcc: p.bcc.as_deref(),
            subject: &p.subject,
            body: &p.body,
            in_reply_to: p.in_reply_to.as_deref(),
            references: p.references.as_deref(),
            attachments: &p.attachments,
        });
        let mut payload = json!({ "raw": raw });
        if let Some(t) = p.thread_id.filter(|t| !t.is_empty()) {
            payload["threadId"] = json!(t);
        }
        let r = match self
            .http
            .post(format!("{API}/messages/send"))
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return fail(e.to_string()),
        };
        let ok = r.status().is_success();
        let v: Value = r.json().await.unwrap_or(Value::Null);
        if !ok {
            return fail(api_error(&v).unwrap_or_else(|| "Failed to send email".into()));
        }
        SendResult {
            success: true,
            message_id: v.get("id").and_then(Value::as_str).map(str::to_string),
            thread_id: v.get("threadId").and_then(Value::as_str).map(str::to_string),
            error: None,
        }
    }

    async fn validate_credentials(&self) -> bool {
        self.token().await.token.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64url(s: &str) -> String {
        URL_SAFE_NO_PAD.encode(s)
    }

    #[test]
    fn parses_gmail_message_fixture() {
        let msg = json!({
            "id": "18abc", "threadId": "18aaa", "snippet": "Hello there",
            "labelIds": ["INBOX", "UNREAD", "Label_1"], "internalDate": "1700000000123",
            "payload": {
                "mimeType": "multipart/related",
                "headers": [
                    {"name": "From", "value": "\"Jane Doe\" <jane@example.com>"},
                    {"name": "To", "value": "me@example.com"},
                    {"name": "Subject", "value": "Hi"},
                    {"name": "Message-Id", "value": "<abc@mail>"}
                ],
                "parts": [
                    {"mimeType": "multipart/alternative", "parts": [
                        {"mimeType": "text/plain", "body": {"data": b64url("plain body")}},
                        {"mimeType": "text/html", "body": {"data": b64url("<p>html ü</p>")}}
                    ]},
                    {"mimeType": "image/png", "filename": "logo.png",
                     "headers": [{"name": "Content-ID", "value": "<img1>"}],
                     "body": {"attachmentId": "ATT1", "size": 42}}
                ]
            }
        });
        let row = parse_gmail_message(&msg, "acc", "inbox");
        assert_eq!(row.id, "18abc");
        assert_eq!(row.thread_id.as_deref(), Some("18aaa"));
        assert_eq!(row.message_id.as_deref(), Some("<abc@mail>"));
        assert_eq!(row.from_name, "Jane Doe");
        assert_eq!(row.from_email, "jane@example.com");
        assert_eq!(row.labels, r#"["INBOX","UNREAD","Label_1"]"#);
        assert!(!row.is_read);
        assert!(!row.is_starred);
        assert_eq!(row.received_at, 1_700_000_000);
        assert_eq!(row.cc_addresses.as_deref(), Some(""));

        let (text, html, atts) = extract_body_and_attachments(&msg["payload"]);
        assert_eq!(text, "plain body");
        assert_eq!(html, "<p>html ü</p>");
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].content_id.as_deref(), Some("img1"));
        assert_eq!(atts[0].attachment_id, "ATT1");
        assert_eq!(atts[0].size, 42);
    }

    #[test]
    fn from_header_variants() {
        assert_eq!(parse_from("bob@x.com"), ("".into(), "bob@x.com".into()));
        assert_eq!(parse_from("Bob <bob@x.com>"), ("Bob".into(), "bob@x.com".into()));
        assert_eq!(parse_from("\"Doe, J\" <j@x.com>"), ("Doe, J".into(), "j@x.com".into()));
        assert_eq!(parse_from("<j@x.com>"), ("".into(), "j@x.com".into()));
    }

    #[test]
    fn raw_mime_simple_and_multipart() {
        let simple = build_raw_mime(
            &RawEmail {
                from: "A <a@x>",
                to: "b@x",
                subject: "S",
                body: "<b>hi</b>",
                cc: Some(""),
                in_reply_to: Some("<m1>"),
                ..Default::default()
            },
            "B",
        );
        assert_eq!(
            simple,
            "From: A <a@x>\r\nTo: b@x\r\nSubject: S\r\nIn-Reply-To: <m1>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=\"UTF-8\"\r\n\r\n<b>hi</b>"
        );
        let atts = vec![Attachment {
            filename: "f.txt".into(),
            mime_type: "text/plain".into(),
            content: "aGk=".into(),
        }];
        let multi = build_raw_mime(
            &RawEmail {
                from: "a",
                to: "b",
                subject: "S",
                body: "hi",
                attachments: &atts,
                ..Default::default()
            },
            "B",
        );
        assert!(multi.contains("Content-Type: multipart/mixed; boundary=\"B\"\r\n\r\n--B\r\n"));
        assert!(multi.contains("\r\naGk=\r\n"));
        assert!(multi.contains(&STANDARD.encode("hi")));
        assert!(multi.ends_with("--B--"));
        let enc = build_raw_email(&RawEmail {
            from: "a",
            to: "b",
            subject: "S",
            body: "hi",
            ..Default::default()
        });
        assert!(!enc.contains('=') && !enc.contains('+') && !enc.contains('/'));
    }
}
