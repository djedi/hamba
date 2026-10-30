//! Yahoo Mail provider: IMAP/SMTP with XOAUTH2 (port of backend/src/services/providers/yahoo.ts).
use super::imap_common::{self, ImapAuth, ImapConfig, ImapCore, ImapKind, SmtpAuth, SmtpConfig};
use super::*;
use crate::emails_db;
use crate::services::token::get_yahoo_access_token;

pub struct YahooProvider {
    core: ImapCore,
}

impl YahooProvider {
    pub fn new(state: AppState, account_id: String) -> Self {
        Self {
            core: ImapCore {
                state,
                account_id,
                kind: ImapKind::Yahoo,
            },
        }
    }

    fn email(&self) -> String {
        emails_db::account_field(&self.core.state.db.conn(), &self.core.account_id, "email").unwrap_or_default()
    }

    fn imap_cfg(&self, token: String) -> ImapConfig {
        ImapConfig {
            host: "imap.mail.yahoo.com".into(),
            port: 993,
            secure: true,
            auth: ImapAuth::XOAuth2 {
                user: self.email(),
                token,
            },
        }
    }

    /// Token for actions: errors become "Not authenticated" (as `getToken()` returning null in TS)
    async fn action_cfg(&self) -> Result<ImapConfig, String> {
        let t = get_yahoo_access_token(&self.core.state, &self.core.account_id).await;
        t.token
            .filter(|t| !t.is_empty())
            .map(|t| self.imap_cfg(t))
            .ok_or_else(|| "Not authenticated".to_string())
    }

    /// Token for syncs: surfaces the token error and needs_reauth
    async fn sync_cfg(&self) -> Result<ImapConfig, SyncResult> {
        let t = get_yahoo_access_token(&self.core.state, &self.core.account_id).await;
        match t.token.filter(|t| !t.is_empty()) {
            Some(tok) => Ok(self.imap_cfg(tok)),
            None => Err(SyncResult {
                error: Some(t.error.unwrap_or_else(|| "Not authenticated".into())),
                needs_reauth: Some(t.needs_reauth),
                ..Default::default()
            }),
        }
    }
}

macro_rules! with_cfg {
    ($self:ident, |$c:ident| $body:expr) => {
        match $self.action_cfg().await {
            Ok($c) => $body,
            Err(e) => Err(e),
        }
    };
}

#[async_trait]
impl EmailProvider for YahooProvider {
    async fn sync(&self, o: SyncOptions) -> SyncResult {
        match self.sync_cfg().await {
            Ok(c) => self.core.sync(&c, &o).await,
            Err(r) => r,
        }
    }
    async fn sync_sent(&self, o: SyncOptions) -> SyncResult {
        match self.sync_cfg().await {
            Ok(c) => self.core.sync_sent(&c, &o).await,
            Err(r) => r,
        }
    }
    async fn sync_drafts(&self, o: SyncOptions) -> SyncResult {
        match self.sync_cfg().await {
            Ok(c) => self.core.sync_drafts(&c, &o).await,
            Err(r) => r,
        }
    }
    async fn mark_read(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.set_flag(&c, id, "\\Seen", true).await)
    }
    async fn mark_unread(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.set_flag(&c, id, "\\Seen", false).await)
    }
    async fn star(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.set_flag(&c, id, "\\Flagged", true).await)
    }
    async fn unstar(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.set_flag(&c, id, "\\Flagged", false).await)
    }
    async fn archive(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.archive(&c, id).await)
    }
    async fn unarchive(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.unarchive(&c, id).await)
    }
    async fn trash(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.trash(&c, id).await)
    }
    async fn untrash(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.untrash(&c, id).await)
    }
    async fn permanent_delete(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.permanent_delete(&c, id).await)
    }
    async fn send(&self, p: SendParams) -> SendResult {
        let token = match self.action_cfg().await {
            Ok(ImapConfig {
                auth: ImapAuth::XOAuth2 { token, .. },
                ..
            }) => token,
            Ok(_) => unreachable!(),
            Err(e) => {
                return SendResult {
                    success: false,
                    error: Some(e),
                    ..Default::default()
                }
            }
        };
        let cfg = SmtpConfig {
            host: "smtp.mail.yahoo.com".into(),
            port: 465,
            secure: true,
            require_tls: true,
            auth: SmtpAuth::XOAuth2 {
                user: self.email(),
                token,
            },
        };
        // yahoo.ts does not save the sent message locally (it appears on the next syncSent)
        match imap_common::smtp_send(&cfg, &p).await {
            Ok(message_id) => SendResult {
                success: true,
                message_id: Some(message_id),
                ..Default::default()
            },
            Err(e) => SendResult {
                success: false,
                error: Some(e),
                ..Default::default()
            },
        }
    }
    async fn delete_draft(&self, id: &str) -> ProviderResult<()> {
        with_cfg!(self, |c| self.core.delete_draft(&c, id).await)
    }
    async fn validate_credentials(&self) -> bool {
        match self.action_cfg().await {
            Ok(c) => self.core.validate(&c).await,
            Err(_) => false,
        }
    }
}
