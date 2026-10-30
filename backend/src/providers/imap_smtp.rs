//! IMAP/SMTP provider (port of backend/src/services/providers/imap-smtp.ts).
use super::imap_common::{self, ImapConfig, ImapCore, ImapKind, SmtpAuth, SmtpConfig};
use super::*;
use crate::emails_db;

pub struct ImapSmtpProvider {
    core: ImapCore,
}

impl ImapSmtpProvider {
    pub fn new(state: AppState, account_id: String) -> Self {
        Self {
            core: ImapCore {
                state,
                account_id,
                kind: ImapKind::Imap,
            },
        }
    }

    fn cfg(&self) -> Result<ImapConfig, String> {
        ImapConfig::from_account(&self.core.state, &self.core.account_id).map_err(|e| e.message)
    }

    fn smtp_cfg(&self) -> Result<SmtpConfig, String> {
        let conn = self.core.state.db.conn();
        let f = |c: &str| emails_db::account_field(&conn, &self.core.account_id, c);
        let host = f("smtp_host").ok_or("SMTP host not configured")?;
        let port = f("smtp_port")
            .and_then(|p| p.parse::<u16>().ok())
            .filter(|p| *p != 0)
            .unwrap_or(587);
        let user = f("username")
            .filter(|u| !u.is_empty())
            .or_else(|| f("email"))
            .unwrap_or_default();
        let pass = f("password").unwrap_or_default();
        let require_tls = f("smtp_use_tls").map(|v| v != "0" && !v.is_empty()).unwrap_or(true);
        Ok(SmtpConfig {
            host,
            port,
            secure: port == 465,
            require_tls,
            auth: SmtpAuth::Password { user, pass },
        })
    }
}

macro_rules! with_cfg {
    ($self:ident, |$c:ident| $body:expr) => {
        match $self.cfg() {
            Ok($c) => $body,
            Err(e) => Err(e),
        }
    };
}

#[async_trait]
impl EmailProvider for ImapSmtpProvider {
    async fn sync(&self, o: SyncOptions) -> SyncResult {
        match self.cfg() {
            Ok(c) => self.core.sync(&c, &o).await,
            Err(e) => SyncResult::error(e),
        }
    }
    async fn sync_sent(&self, o: SyncOptions) -> SyncResult {
        match self.cfg() {
            Ok(c) => self.core.sync_sent(&c, &o).await,
            Err(e) => SyncResult::error(e),
        }
    }
    async fn sync_drafts(&self, o: SyncOptions) -> SyncResult {
        match self.cfg() {
            Ok(c) => self.core.sync_drafts(&c, &o).await,
            Err(e) => SyncResult::error(e),
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
        let cfg = match self.smtp_cfg() {
            Ok(c) => c,
            Err(e) => {
                return SendResult {
                    success: false,
                    error: Some(e),
                    ..Default::default()
                }
            }
        };
        match imap_common::smtp_send(&cfg, &p).await {
            Ok(message_id) => {
                // Save sent email directly to database (avoids needing syncSent which opens another IMAP connection)
                self.core.save_sent(&p, &message_id);
                SendResult {
                    success: true,
                    message_id: Some(message_id),
                    ..Default::default()
                }
            }
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
        match self.cfg() {
            Ok(c) => self.core.validate(&c).await,
            Err(_) => false,
        }
    }
}
