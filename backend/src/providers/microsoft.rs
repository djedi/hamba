//! Microsoft Graph provider (port of backend/src/services/providers/microsoft.ts).
use super::*;
use crate::emails_db::{self, EmailRow};
use crate::services::token::{get_microsoft_access_token, TokenResult};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashSet;

const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const MSG_SELECT: &str = "id,conversationId,internetMessageId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,body,categories,isRead,flag,receivedDateTime,hasAttachments";

/// System folders that should not be synced as labels
const SYSTEM_FOLDERS: &[&str] = &[
    "inbox",
    "sentitems",
    "drafts",
    "deleteditems",
    "junkemail",
    "archive",
    "outbox",
    "scheduled",
];

fn sv<'a>(v: &'a Value, ptr: &str) -> &'a str {
    v.pointer(ptr).and_then(Value::as_str).unwrap_or("")
}

pub fn join_recipients(v: Option<&Value>) -> String {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    r.pointer("/emailAddress/address")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                })
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

/// Parse an ISO-8601 timestamp (Graph `receivedDateTime`) to unix seconds.
pub fn parse_iso(s: &str) -> Option<i64> {
    mail_parser::DateTime::parse_rfc3339(s).map(|d| d.to_timestamp())
}

pub fn parse_microsoft_message(msg: &Value, account_id: &str, folder: &str) -> EmailRow {
    let id = sv(msg, "/id").to_string();
    let content_type = sv(msg, "/body/contentType");
    let content = sv(msg, "/body/content").to_string();
    let categories = msg
        .get("categories")
        .cloned()
        .filter(Value::is_array)
        .unwrap_or(json!([]));
    EmailRow {
        thread_id: Some(
            Some(sv(msg, "/conversationId"))
                .filter(|s| !s.is_empty())
                .unwrap_or(&id)
                .to_string(),
        ),
        message_id: Some(
            Some(sv(msg, "/internetMessageId"))
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("<{id}@outlook.com>")),
        ),
        subject: sv(msg, "/subject").to_string(),
        snippet: sv(msg, "/bodyPreview").to_string(),
        from_name: sv(msg, "/from/emailAddress/name").to_string(),
        from_email: sv(msg, "/from/emailAddress/address").to_string(),
        to_addresses: join_recipients(msg.get("toRecipients")),
        cc_addresses: Some(join_recipients(msg.get("ccRecipients"))),
        bcc_addresses: Some(join_recipients(msg.get("bccRecipients"))),
        body_text: if content_type == "text" {
            content.clone()
        } else {
            String::new()
        },
        body_html: if content_type == "html" { content } else { String::new() },
        labels: categories.to_string(),
        is_read: msg.get("isRead").and_then(Value::as_bool).unwrap_or(false),
        is_starred: sv(msg, "/flag/flagStatus") == "flagged",
        received_at: parse_iso(sv(msg, "/receivedDateTime")).unwrap_or_else(crate::db::now),
        folder: folder.to_string(),
        account_id: account_id.to_string(),
        id,
    }
}

fn recipients(list: &str) -> Value {
    Value::Array(
        list.split(',')
            .map(|e| json!({ "emailAddress": { "address": e.trim() } }))
            .collect(),
    )
}

/// Build the Graph `sendMail` message object.
pub fn build_graph_message(p: &SendParams) -> Value {
    let mut m = json!({
        "subject": p.subject,
        "body": { "contentType": "html", "content": p.body },
        "toRecipients": recipients(&p.to),
    });
    if let Some(cc) = p.cc.as_deref().filter(|s| !s.is_empty()) {
        m["ccRecipients"] = recipients(cc);
    }
    if let Some(bcc) = p.bcc.as_deref().filter(|s| !s.is_empty()) {
        m["bccRecipients"] = recipients(bcc);
    }
    if !p.attachments.is_empty() {
        m["attachments"] = p
            .attachments
            .iter()
            .map(|a| json!({ "@odata.type": "#microsoft.graph.fileAttachment", "name": a.filename, "contentType": a.mime_type, "contentBytes": a.content }))
            .collect();
    }
    if let Some(irt) = p.in_reply_to.as_deref().filter(|s| !s.is_empty()) {
        let mut h = vec![json!({ "name": "In-Reply-To", "value": irt })];
        if let Some(r) = p.references.as_deref().filter(|s| !s.is_empty()) {
            h.push(json!({ "name": "References", "value": r }));
        }
        m["internetMessageHeaders"] = Value::Array(h);
    }
    m
}

fn token_fail(tr: TokenResult) -> SyncResult {
    SyncResult {
        error: Some(tr.error.unwrap_or_else(|| "Not authenticated".into())),
        needs_reauth: tr.needs_reauth.then_some(true),
        ..Default::default()
    }
}

pub struct MicrosoftProvider {
    state: AppState,
    account_id: String,
    http: reqwest::Client,
}

impl MicrosoftProvider {
    pub fn new(state: AppState, account_id: String) -> Self {
        Self {
            state,
            account_id,
            http: reqwest::Client::new(),
        }
    }

    async fn token(&self) -> TokenResult {
        get_microsoft_access_token(&self.state, &self.account_id).await
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

    async fn exec(&self, req: reqwest::RequestBuilder) -> ProviderResult<()> {
        let r = req.send().await.map_err(|e| e.to_string())?;
        let status = r.status().as_u16();
        if r.status().is_success() || status == 204 {
            return Ok(());
        }
        let v: Value = r.json().await.unwrap_or(Value::Null);
        Err(v
            .pointer("/error/message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("Microsoft API error: {status}")))
    }

    /// Sync mail folders to local database as labels
    pub async fn sync_labels(&self) {
        let Some(token) = self.token().await.token else { return };
        let Ok((status, data)) = self.get_json(&format!("{GRAPH}/me/mailFolders?$top=100"), &token).await else {
            tracing::error!("[Microsoft] Error syncing labels");
            return;
        };
        if !(200..300).contains(&status) {
            return;
        }
        let conn = self.state.db.conn();
        for f in data.get("value").and_then(Value::as_array).into_iter().flatten() {
            let name = sv(f, "/displayName");
            let lower: String = name.to_lowercase().split_whitespace().collect();
            if SYSTEM_FOLDERS.contains(&lower.as_str()) || f.get("isHidden").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            let fid = sv(f, "/id");
            let local = format!("microsoft:{}:{fid}", self.account_id);
            let _ = emails_db::upsert_label(
                &conn,
                &local,
                &self.account_id,
                name,
                Some("#6366f1"),
                "user",
                Some(fid),
            );
        }
    }

    fn associate_email_labels(&self, conn: &rusqlite::Connection, email_id: &str, categories: &[Value]) {
        let _ = conn.execute("DELETE FROM email_labels WHERE email_id = ?", [email_id]);
        for c in categories.iter().filter_map(Value::as_str) {
            let label: Option<String> = conn
                .query_row(
                    "SELECT id FROM labels WHERE account_id = ? AND name = ?",
                    [&self.account_id, c],
                    |r| r.get(0),
                )
                .ok();
            if let Some(lid) = label {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO email_labels (email_id, label_id) VALUES (?, ?)",
                    [email_id, &lid],
                );
            }
        }
    }

    async fn fetch_attachments(&self, email_id: &str, token: &str) {
        let url = format!("{GRAPH}/me/messages/{email_id}/attachments");
        let (status, data) = match self.get_json(&url, token).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = e, email_id, "[Microsoft] Failed to fetch attachments");
                return;
            }
        };
        if !(200..300).contains(&status) {
            return;
        }
        let conn = self.state.db.conn();
        for att in data.get("value").and_then(Value::as_array).into_iter().flatten() {
            let cid = sv(att, "/contentId");
            let ct = sv(att, "/contentType");
            if cid.is_empty() || !ct.starts_with("image/") {
                continue;
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(sv(att, "/contentBytes"))
                .unwrap_or_default();
            let name = Some(sv(att, "/name")).filter(|s| !s.is_empty()).unwrap_or("attachment");
            // Note: TS stored att.size || length; insert_attachment always uses data length.
            let _ = emails_db::insert_attachment(
                &conn,
                &format!("{email_id}:{cid}"),
                email_id,
                Some(cid),
                name,
                ct,
                &bytes,
            );
        }
    }

    async fn sync_folder(
        &self,
        folder_path: &str,
        folder: &str,
        options: &SyncOptions,
        err_default: &str,
    ) -> Result<(i64, i64, HashSet<String>), SyncResult> {
        let tr = self.token().await;
        let Some(token) = tr.token.clone() else {
            return Err(token_fail(tr));
        };
        let max = options.max_messages.filter(|n| *n != 0).unwrap_or(100);
        let url = format!("{GRAPH}/me/mailFolders/{folder_path}/messages?$top={max}&$orderby=receivedDateTime desc&$select={MSG_SELECT}");
        let (status, list) = self.get_json(&url, &token).await.map_err(SyncResult::error)?;
        if !(200..300).contains(&status) {
            return Err(SyncResult {
                error: Some(
                    list.pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or(err_default)
                        .to_string(),
                ),
                needs_reauth: Some(status == 401 || status == 403),
                ..Default::default()
            });
        }
        let messages = list.get("value").and_then(Value::as_array).cloned().unwrap_or_default();
        let mut seen = HashSet::new();
        let mut synced = 0;
        for msg in &messages {
            let row = parse_microsoft_message(msg, &self.account_id, folder);
            seen.insert(row.id.clone());
            {
                let conn = self.state.db.conn();
                let _ = emails_db::upsert_email(&conn, &row);
                if folder == "inbox" {
                    let _ = conn.execute("UPDATE emails SET is_archived = 0 WHERE id = ?", [&row.id]);
                }
                if let Some(cats) = msg
                    .get("categories")
                    .and_then(Value::as_array)
                    .filter(|a| !a.is_empty())
                {
                    self.associate_email_labels(&conn, &row.id, cats);
                }
            }
            if msg.get("hasAttachments").and_then(Value::as_bool).unwrap_or(false) {
                self.fetch_attachments(&row.id, &token).await;
            }
            synced += 1;
        }
        Ok((synced, messages.len() as i64, seen))
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

    async fn update_message(&self, id: &str, body: Value) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(
            self.http
                .patch(format!("{GRAPH}/me/messages/{id}"))
                .bearer_auth(token)
                .json(&body),
        )
        .await
    }

    async fn move_message(&self, id: &str, dest: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(
            self.http
                .post(format!("{GRAPH}/me/messages/{id}/move"))
                .bearer_auth(token)
                .json(&json!({ "destinationId": dest })),
        )
        .await
    }
}

#[async_trait]
impl EmailProvider for MicrosoftProvider {
    async fn sync(&self, options: SyncOptions) -> SyncResult {
        let tr = self.token().await;
        if tr.token.is_none() {
            return token_fail(tr);
        }
        self.sync_labels().await;
        match self
            .sync_folder("inbox", "inbox", &options, "Failed to fetch messages")
            .await
        {
            Err(r) => r,
            Ok((synced, total, seen)) => {
                let archived = self.reconcile_archived(&seen);
                if archived > 0 {
                    tracing::info!(
                        archived,
                        account_id = self.account_id,
                        "[Microsoft] Reconciled archived emails"
                    );
                }
                SyncResult {
                    synced,
                    total,
                    ..Default::default()
                }
            }
        }
    }

    async fn sync_sent(&self, options: SyncOptions) -> SyncResult {
        match self
            .sync_folder("sentitems", "sent", &options, "Failed to fetch sent messages")
            .await
        {
            Err(r) => r,
            Ok((synced, total, _)) => SyncResult {
                synced,
                total,
                ..Default::default()
            },
        }
    }

    async fn sync_drafts(&self, options: SyncOptions) -> SyncResult {
        let tr = self.token().await;
        let Some(token) = tr.token.clone() else {
            return token_fail(tr);
        };
        let max = options.max_messages.filter(|n| *n != 0).unwrap_or(50);
        let url = format!("{GRAPH}/me/mailFolders/drafts/messages?$top={max}&$orderby=lastModifiedDateTime desc&$select=id,subject,bodyPreview,toRecipients,ccRecipients,bccRecipients,body");
        let (status, list) = match self.get_json(&url, &token).await {
            Ok(v) => v,
            Err(e) => return SyncResult::error(e),
        };
        if !(200..300).contains(&status) {
            return SyncResult {
                error: Some(
                    list.pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("Failed to fetch drafts")
                        .to_string(),
                ),
                needs_reauth: Some(status == 401 || status == 403),
                ..Default::default()
            };
        }
        let drafts = list.get("value").and_then(Value::as_array).cloned().unwrap_or_default();
        let conn = self.state.db.conn();
        for d in &drafts {
            let id = sv(d, "/id");
            let _ = emails_db::upsert_draft(
                &conn,
                &format!("microsoft-draft:{id}"),
                &self.account_id,
                Some(id),
                &join_recipients(d.get("toRecipients")),
                &join_recipients(d.get("ccRecipients")),
                &join_recipients(d.get("bccRecipients")),
                sv(d, "/subject"),
                sv(d, "/body/content"),
            );
        }
        SyncResult {
            synced: drafts.len() as i64,
            total: drafts.len() as i64,
            ..Default::default()
        }
    }

    async fn mark_read(&self, id: &str) -> ProviderResult<()> {
        self.update_message(id, json!({ "isRead": true })).await
    }
    async fn mark_unread(&self, id: &str) -> ProviderResult<()> {
        self.update_message(id, json!({ "isRead": false })).await
    }
    async fn star(&self, id: &str) -> ProviderResult<()> {
        self.update_message(id, json!({ "flag": { "flagStatus": "flagged" } }))
            .await
    }
    async fn unstar(&self, id: &str) -> ProviderResult<()> {
        self.update_message(id, json!({ "flag": { "flagStatus": "notFlagged" } }))
            .await
    }
    async fn archive(&self, id: &str) -> ProviderResult<()> {
        self.move_message(id, "archive").await
    }
    async fn unarchive(&self, id: &str) -> ProviderResult<()> {
        self.move_message(id, "inbox").await
    }
    async fn trash(&self, id: &str) -> ProviderResult<()> {
        self.move_message(id, "deleteditems").await
    }
    async fn untrash(&self, id: &str) -> ProviderResult<()> {
        self.move_message(id, "inbox").await
    }
    async fn permanent_delete(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(self.http.delete(format!("{GRAPH}/me/messages/{id}")).bearer_auth(token))
            .await
    }
    async fn delete_draft(&self, id: &str) -> ProviderResult<()> {
        let token = self.require_token().await?;
        self.exec(self.http.delete(format!("{GRAPH}/me/messages/{id}")).bearer_auth(token))
            .await
    }

    async fn send(&self, p: SendParams) -> SendResult {
        let fail = |e: String| SendResult {
            success: false,
            error: Some(e),
            ..Default::default()
        };
        if emails_db::account_field(&self.state.db.conn(), &self.account_id, "id").is_none() {
            return fail("Account not found".into());
        }
        let tr = self.token().await;
        let Some(token) = tr.token else {
            return fail(tr.error.unwrap_or_else(|| "Not authenticated".into()));
        };
        let message = build_graph_message(&p);
        let r = match self
            .http
            .post(format!("{GRAPH}/me/sendMail"))
            .bearer_auth(token)
            .json(&json!({ "message": message }))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => return fail(e.to_string()),
        };
        if !r.status().is_success() {
            let v: Value = r.json().await.unwrap_or(Value::Null);
            return fail(
                v.pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Failed to send email")
                    .to_string(),
            );
        }
        // Microsoft sendMail doesn't return the message ID
        SendResult {
            success: true,
            ..Default::default()
        }
    }

    async fn validate_credentials(&self) -> bool {
        let Some(token) = self.token().await.token else {
            return false;
        };
        matches!(self.http.get(format!("{GRAPH}/me")).bearer_auth(token).send().await, Ok(r) if r.status().is_success())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_graph_message() {
        let msg = json!({
            "id": "AAMk1", "conversationId": "conv1", "subject": "Hi", "bodyPreview": "prev",
            "from": {"emailAddress": {"name": "Jane", "address": "jane@x.com"}},
            "toRecipients": [{"emailAddress": {"address": "a@x.com"}}, {"emailAddress": {}}, {"emailAddress": {"address": "b@x.com"}}],
            "body": {"contentType": "html", "content": "<p>x</p>"},
            "categories": ["Work"], "isRead": true, "flag": {"flagStatus": "flagged"},
            "receivedDateTime": "2023-11-14T22:13:20Z"
        });
        let r = parse_microsoft_message(&msg, "acc", "inbox");
        assert_eq!(r.thread_id.as_deref(), Some("conv1"));
        assert_eq!(r.message_id.as_deref(), Some("<AAMk1@outlook.com>"));
        assert_eq!(r.to_addresses, "a@x.com, b@x.com");
        assert_eq!(r.body_html, "<p>x</p>");
        assert_eq!(r.body_text, "");
        assert_eq!(r.labels, r#"["Work"]"#);
        assert!(r.is_read && r.is_starred);
        assert_eq!(r.received_at, 1_700_000_000);
    }

    #[test]
    fn builds_graph_send_message() {
        let p = SendParams {
            to: "a@x, b@x".into(),
            subject: "S".into(),
            body: "B".into(),
            in_reply_to: Some("<m>".into()),
            ..Default::default()
        };
        let m = build_graph_message(&p);
        assert_eq!(m["toRecipients"][1]["emailAddress"]["address"], "b@x");
        assert!(m.get("ccRecipients").is_none());
        assert_eq!(m["internetMessageHeaders"][0]["name"], "In-Reply-To");
    }
}
