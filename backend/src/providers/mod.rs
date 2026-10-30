//! Email provider abstraction (mirrors backend/src/services/providers/types.ts).
//!
//! Each provider owns its sync logic and writes to SQLite via `crate::emails_db`.

pub mod gmail;
pub mod imap_common;
pub mod imap_smtp;
pub mod microsoft;
pub mod yahoo;

use crate::AppState;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub type ProviderResult<T> = Result<T, String>;

/// Progress callback `(synced, total)`, equivalent to TS `onProgress`
#[derive(Clone)]
pub struct ProgressCallback(pub std::sync::Arc<dyn Fn(i64, i64) + Send + Sync>);

impl std::fmt::Debug for ProgressCallback {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ProgressCallback")
    }
}

#[derive(Debug, Clone, Default)]
pub struct SyncOptions {
    pub max_messages: Option<i64>,
    pub folder: Option<String>,
    /// If true, sync continues in background until all messages are fetched
    /// (the route drives batching; providers currently ignore it, as in the TS)
    #[allow(dead_code)]
    pub sync_all: bool,
    /// Called with `(synced, total)` as the sync progresses
    pub on_progress: Option<ProgressCallback>,
}

impl SyncOptions {
    pub fn report_progress(&self, synced: i64, total: i64) {
        if let Some(cb) = &self.on_progress {
            (cb.0)(synced, total);
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub synced: i64,
    pub total: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub needs_reauth: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_total: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
}

impl SyncResult {
    pub fn error(msg: impl Into<String>) -> Self {
        SyncResult {
            error: Some(msg.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub filename: String,
    pub mime_type: String,
    /// Base64-encoded content (as sent by the frontend)
    pub content: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendParams {
    pub from: String,
    pub to: String,
    pub cc: Option<String>,
    pub bcc: Option<String>,
    pub subject: String,
    pub body: String,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub thread_id: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    /// Body to keep in the local Sent copy when `body` was rewritten for tracking
    #[serde(default, skip)]
    pub local_body: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[async_trait]
pub trait EmailProvider: Send + Sync {
    async fn sync(&self, options: SyncOptions) -> SyncResult;
    async fn sync_sent(&self, options: SyncOptions) -> SyncResult;
    async fn sync_drafts(&self, options: SyncOptions) -> SyncResult;
    async fn mark_read(&self, email_id: &str) -> ProviderResult<()>;
    async fn mark_unread(&self, email_id: &str) -> ProviderResult<()>;
    async fn star(&self, email_id: &str) -> ProviderResult<()>;
    async fn unstar(&self, email_id: &str) -> ProviderResult<()>;
    async fn archive(&self, email_id: &str) -> ProviderResult<()>;
    async fn unarchive(&self, email_id: &str) -> ProviderResult<()>;
    async fn trash(&self, email_id: &str) -> ProviderResult<()>;
    async fn untrash(&self, email_id: &str) -> ProviderResult<()>;
    async fn permanent_delete(&self, email_id: &str) -> ProviderResult<()>;
    async fn send(&self, params: SendParams) -> SendResult;
    async fn delete_draft(&self, draft_id: &str) -> ProviderResult<()>;
    async fn validate_credentials(&self) -> bool;
}

/// Return the provider for an account based on `accounts.provider_type`
pub fn get_provider(state: &AppState, account_id: &str) -> ProviderResult<Box<dyn EmailProvider>> {
    let provider_type: Option<String> = state
        .db
        .conn()
        .query_row("SELECT provider_type FROM accounts WHERE id = ?", [account_id], |r| {
            r.get(0)
        })
        .map_err(|_| "Account not found".to_string())?;
    let (state, id) = (state.clone(), account_id.to_string());
    Ok(match provider_type.as_deref() {
        Some("imap") => Box::new(imap_smtp::ImapSmtpProvider::new(state, id)),
        Some("microsoft") => Box::new(microsoft::MicrosoftProvider::new(state, id)),
        Some("yahoo") => Box::new(yahoo::YahooProvider::new(state, id)),
        // Default to Gmail
        _ => Box::new(gmail::GmailProvider::new(state, id)),
    })
}
