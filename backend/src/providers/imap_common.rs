//! Shared IMAP/SMTP plumbing for `ImapSmtpProvider` and `YahooProvider`
//! (ports of backend/src/services/providers/imap-smtp.ts and yahoo.ts).
//!
//! The two TS providers are near-identical copies; their differences are captured
//! by [`ImapKind`] so the sync/action logic lives here once.

use super::*;
use crate::emails_db::{self, EmailRow};
use async_imap::types::{Fetch, Flag};
use futures::TryStreamExt;
use mail_parser::{MessageParser, MimeHeaders, PartType};
use std::collections::HashSet;
use std::pin::Pin;
use std::sync::{Arc, LazyLock};
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// Normalize Message-ID for consistent comparison across syncs
/// (remove one leading `<` / trailing `>`, trim, lowercase).
pub fn normalize_message_id(message_id: Option<&str>) -> String {
    let Some(id) = message_id else { return String::new() };
    let id = id.strip_prefix('<').unwrap_or(id);
    let id = id.strip_suffix('>').unwrap_or(id);
    id.trim().to_lowercase()
}

/// emailId format: "{accountId}:{uid}" (or with `sent:` / `yahoo:` segments) — the UID is the last segment.
/// Mirrors `parseInt(parts[parts.length-1] || "0", 10)`; unparsable yields 0 (TS would give NaN).
pub fn extract_uid(email_id: &str) -> u32 {
    let last = email_id.rsplit(':').next().unwrap_or("0");
    let digits: String = last.trim_start().chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().unwrap_or(0)
}

/// Port of `params.from.match(/(?:"?([^"]*)"?\s)?<?([^>]*)>?/)` → (fromName, fromEmail)
pub fn parse_from_address(from: &str) -> (String, String) {
    static RE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r#"(?:"?([^"]*)"?\s)?<?([^>]*)>?"#).unwrap());
    match RE.captures(from) {
        Some(c) => {
            let name = c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let email = c
                .get(2)
                .map(|m| m.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(from)
                .to_string();
            (name, email)
        }
        None => (String::new(), from.to_string()),
    }
}

/// An IMAP error plus the imapflow-style `authenticationFailed` flag (set when LOGIN/AUTHENTICATE was rejected).
#[derive(Debug, Clone)]
pub struct ImapErr {
    pub message: String,
    pub auth_failed: bool,
}

impl std::fmt::Display for ImapErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl ImapErr {
    pub fn new(msg: impl Into<String>) -> Self {
        Self {
            message: msg.into(),
            auth_failed: false,
        }
    }
}

impl From<async_imap::error::Error> for ImapErr {
    fn from(e: async_imap::error::Error) -> Self {
        ImapErr::new(e.to_string())
    }
}

impl From<std::io::Error> for ImapErr {
    fn from(e: std::io::Error) -> Self {
        ImapErr::new(e.to_string())
    }
}

/// Port of `isImapAuthError`. Server response codes (`[UNAVAILABLE]`, `[AUTHENTICATIONFAILED]`)
/// are detected in the error text since async-imap doesn't expose them separately.
pub fn is_imap_auth_error(err: &ImapErr) -> bool {
    let s = err.message.to_lowercase();
    // Connection limit errors are NOT auth errors, even if authenticationFailed is set
    if s.contains("maximum") && s.contains("connections") {
        return false;
    }
    if s.contains("too many") && s.contains("connections") {
        return false;
    }
    if s.contains("[unavailable]") {
        return false;
    }
    s.contains("authentication")
        || s.contains("login failed")
        || s.contains("invalid credentials")
        || s.contains("wrong password")
        || (err.auth_failed && !s.contains("connection"))
        || s.contains("authenticationfailed")
}

/// Port of `isYahooAuthError` (deliberately broader, no connection-limit exclusions).
pub fn is_yahoo_auth_error(err: &ImapErr) -> bool {
    let s = err.message.to_lowercase();
    s.contains("auth")
        || s.contains("login")
        || s.contains("credentials")
        || s.contains("invalid_grant")
        || s.contains("token")
        || err.auth_failed
        || s.contains("authenticationfailed")
}

/// Default colors for IMAP folders
pub fn folder_color(name: &str) -> &'static str {
    match name {
        "INBOX" => "#4285f4",
        "Sent" => "#34a853",
        "Drafts" => "#fbbc05",
        "Trash" => "#ea4335",
        _ => "#6366f1", // includes "Archive"
    }
}

#[derive(Debug, Clone)]
pub struct MailboxInfo {
    /// Full path (imapflow `path`)
    pub path: String,
    /// Last path segment (imapflow `name`)
    pub name: String,
}

/// Find the first candidate that matches a mailbox path or name; returns the candidate (as TS does).
pub fn find_folder(mailboxes: &[MailboxInfo], candidates: &[&str]) -> Option<String> {
    candidates
        .iter()
        .find(|c| mailboxes.iter().any(|m| m.path == **c || m.name == **c))
        .map(|c| c.to_string())
}

/// Quote a string for an IMAP command argument.
pub fn imap_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

// ---------------------------------------------------------------------------
// Provider flavor
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImapKind {
    Imap,
    Yahoo,
}

impl ImapKind {
    fn tag(self) -> &'static str {
        match self {
            ImapKind::Imap => "IMAP",
            ImapKind::Yahoo => "Yahoo",
        }
    }
    fn special_folders(self) -> &'static [&'static str] {
        match self {
            ImapKind::Imap => &[
                "INBOX",
                "Sent",
                "Sent Items",
                "Sent Mail",
                "Drafts",
                "Draft",
                "Trash",
                "Deleted",
                "Deleted Items",
                "Spam",
                "Junk",
            ],
            ImapKind::Yahoo => &[
                "INBOX",
                "Sent",
                "Sent Items",
                "Sent Mail",
                "Drafts",
                "Draft",
                "Trash",
                "Deleted",
                "Deleted Items",
                "Spam",
                "Junk",
                "Bulk Mail",
            ],
        }
    }
    fn sent_names(self) -> &'static [&'static str] {
        match self {
            ImapKind::Imap => &["Sent", "Sent Items", "Sent Mail", "[Gmail]/Sent Mail", "INBOX.Sent"],
            ImapKind::Yahoo => &["Sent", "Sent Items", "Sent Mail"],
        }
    }
    fn draft_names(self) -> &'static [&'static str] {
        match self {
            ImapKind::Imap => &["Drafts", "Draft", "[Gmail]/Drafts", "INBOX.Drafts"],
            ImapKind::Yahoo => &["Drafts", "Draft"],
        }
    }
    fn trash_names(self) -> &'static [&'static str] {
        match self {
            ImapKind::Imap => &["Trash", "Deleted", "Deleted Items", "[Gmail]/Trash", "INBOX.Trash"],
            ImapKind::Yahoo => &["Trash", "Deleted", "Deleted Items"],
        }
    }
    fn archive_names(self) -> &'static [&'static str] {
        match self {
            ImapKind::Imap => &["Archive", "Archives", "[Gmail]/All Mail", "All Mail", "INBOX.Archive"],
            ImapKind::Yahoo => &["Archive", "Archives"],
        }
    }
    /// Prefix for email ids / label ids / draft ids
    fn id_prefix(self, account_id: &str) -> String {
        match self {
            ImapKind::Imap => account_id.to_string(),
            ImapKind::Yahoo => format!("yahoo:{account_id}"),
        }
    }
    fn label_prefix(self) -> &'static str {
        match self {
            ImapKind::Imap => "imap",
            ImapKind::Yahoo => "yahoo",
        }
    }
    fn draft_prefix(self) -> &'static str {
        match self {
            ImapKind::Imap => "imap-draft",
            ImapKind::Yahoo => "yahoo-draft",
        }
    }
    pub fn is_auth_error(self, e: &ImapErr) -> bool {
        match self {
            ImapKind::Imap => is_imap_auth_error(e),
            ImapKind::Yahoo => is_yahoo_auth_error(e),
        }
    }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/// Plain or TLS TCP stream (async-imap needs a single concrete type).
pub enum ImapStream {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

impl std::fmt::Debug for ImapStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ImapStream::Plain(_) => "ImapStream::Plain",
            ImapStream::Tls(_) => "ImapStream::Tls",
        })
    }
}

impl AsyncRead for ImapStream {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            ImapStream::Plain(s) => Pin::new(s).poll_read(cx, buf),
            ImapStream::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for ImapStream {
    fn poll_write(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            ImapStream::Plain(s) => Pin::new(s).poll_write(cx, buf),
            ImapStream::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            ImapStream::Plain(s) => Pin::new(s).poll_flush(cx),
            ImapStream::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            ImapStream::Plain(s) => Pin::new(s).poll_shutdown(cx),
            ImapStream::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

pub type ImapSession = async_imap::Session<ImapStream>;

#[derive(Debug, Clone)]
pub enum ImapAuth {
    Password { user: String, pass: String },
    XOAuth2 { user: String, token: String },
}

#[derive(Debug, Clone)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    /// Implicit TLS. When false, STARTTLS is attempted (like imapflow) and plain is used if unsupported.
    pub secure: bool,
    pub auth: ImapAuth,
}

impl ImapConfig {
    /// Build from the account row (`imap_host`, `imap_port`, `imap_use_tls`, `username`, `email`, `password`).
    pub fn from_account(state: &AppState, account_id: &str) -> Result<Self, ImapErr> {
        let conn = state.db.conn();
        let f = |c: &str| emails_db::account_field(&conn, account_id, c);
        let host = f("imap_host").ok_or_else(|| ImapErr::new("IMAP host not configured"))?;
        let port = f("imap_port")
            .and_then(|p| p.parse::<u16>().ok())
            .filter(|p| *p != 0)
            .unwrap_or(993);
        let secure = f("imap_use_tls").map(|v| v != "0" && !v.is_empty()).unwrap_or(false);
        let user = f("username")
            .filter(|u| !u.is_empty())
            .or_else(|| f("email"))
            .unwrap_or_default();
        let pass = f("password").unwrap_or_default();
        Ok(ImapConfig {
            host,
            port,
            secure,
            auth: ImapAuth::Password { user, pass },
        })
    }
}

fn tls_connector() -> tokio_rustls::TlsConnector {
    static CFG: LazyLock<Arc<tokio_rustls::rustls::ClientConfig>> = LazyLock::new(|| {
        let mut roots = tokio_rustls::rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let cfg = tokio_rustls::rustls::ClientConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .expect("TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
        Arc::new(cfg)
    });
    tokio_rustls::TlsConnector::from(CFG.clone())
}

async fn tls_wrap(host: &str, tcp: TcpStream) -> Result<ImapStream, ImapErr> {
    let name = tokio_rustls::rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| ImapErr::new(format!("Invalid host name: {e}")))?;
    let tls = tls_connector().connect(name, tcp).await?;
    Ok(ImapStream::Tls(Box::new(tls)))
}

struct XOAuth2 {
    payload: String,
    sent: bool,
}

impl async_imap::Authenticator for XOAuth2 {
    type Response = String;
    fn process(&mut self, _challenge: &[u8]) -> String {
        // On failure the server sends an error challenge; reply empty to get the tagged NO.
        if self.sent {
            return String::new();
        }
        self.sent = true;
        self.payload.clone()
    }
}

const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Connect, (STARTTLS,) and authenticate.
pub async fn connect(cfg: &ImapConfig) -> Result<ImapSession, ImapErr> {
    tokio::time::timeout(CONNECT_TIMEOUT, connect_inner(cfg))
        .await
        .map_err(|_| ImapErr::new("Connection timed out"))?
}

async fn connect_inner(cfg: &ImapConfig) -> Result<ImapSession, ImapErr> {
    let tcp = TcpStream::connect((cfg.host.as_str(), cfg.port)).await?;
    tracing::debug!(host = %cfg.host, port = cfg.port, "IMAP TCP connected");
    let client = if cfg.secure {
        let stream = tls_wrap(&cfg.host, tcp).await?;
        tracing::debug!(host = %cfg.host, "IMAP TLS handshake complete");
        let mut c = async_imap::Client::new(stream);
        read_greeting(&mut c).await?;
        c
    } else {
        let mut c = async_imap::Client::new(ImapStream::Plain(tcp));
        read_greeting(&mut c).await?;
        // Opportunistic STARTTLS, like imapflow's default
        match c.run_command_and_check_ok("STARTTLS", None).await {
            Ok(()) => {
                let ImapStream::Plain(tcp) = c.into_inner() else {
                    unreachable!()
                };
                async_imap::Client::new(tls_wrap(&cfg.host, tcp).await?)
            }
            Err(_) => c,
        }
    };
    tracing::debug!(host = %cfg.host, "IMAP greeting received, logging in");
    let res = match &cfg.auth {
        ImapAuth::Password { user, pass } => client.login(user, pass).await,
        ImapAuth::XOAuth2 { user, token } => {
            let payload = format!("user={user}\x01auth=Bearer {token}\x01\x01");
            client.authenticate("XOAUTH2", XOAuth2 { payload, sent: false }).await
        }
    };
    res.map_err(|(e, _)| ImapErr {
        message: e.to_string(),
        auth_failed: true,
    })
}

async fn read_greeting(c: &mut async_imap::Client<ImapStream>) -> Result<(), ImapErr> {
    match c.read_response().await {
        Some(Ok(_)) => Ok(()),
        Some(Err(e)) => Err(e.into()),
        None => Err(ImapErr::new("Connection closed before greeting")),
    }
}

pub async fn list_mailboxes(session: &mut ImapSession) -> Result<Vec<MailboxInfo>, ImapErr> {
    let names: Vec<_> = session.list(Some(""), Some("*")).await?.try_collect().await?;
    Ok(names
        .iter()
        .map(|n| {
            let path = n.name().to_string();
            let name = match n.delimiter() {
                Some(d) if !d.is_empty() => path.rsplit(d).next().unwrap_or(&path).to_string(),
                _ => path.clone(),
            };
            MailboxInfo { path, name }
        })
        .collect())
}

pub async fn add_flags(s: &mut ImapSession, uid: u32, flags: &str) -> Result<(), ImapErr> {
    let _: Vec<_> = s
        .uid_store(uid.to_string(), format!("+FLAGS.SILENT ({flags})"))
        .await?
        .try_collect()
        .await?;
    Ok(())
}

pub async fn remove_flags(s: &mut ImapSession, uid: u32, flags: &str) -> Result<(), ImapErr> {
    let _: Vec<_> = s
        .uid_store(uid.to_string(), format!("-FLAGS.SILENT ({flags})"))
        .await?
        .try_collect()
        .await?;
    Ok(())
}

/// imapflow `messageDelete`: flag \Deleted and expunge (UID EXPUNGE when supported).
pub async fn delete_uid(s: &mut ImapSession, uid: u32) -> Result<(), ImapErr> {
    add_flags(s, uid, "\\Deleted").await?;
    let uid_expunged = match s.uid_expunge(uid.to_string()).await {
        Ok(stream) => stream.try_collect::<Vec<_>>().await.is_ok(),
        Err(_) => false,
    };
    if !uid_expunged {
        let _: Vec<_> = s.expunge().await?.try_collect().await?;
    }
    Ok(())
}

/// imapflow `messageMove`: MOVE, falling back to COPY + delete.
pub async fn move_uid(s: &mut ImapSession, uid: u32, dest: &str) -> Result<(), ImapErr> {
    if s.uid_mv(uid.to_string(), dest).await.is_ok() {
        return Ok(());
    }
    s.uid_copy(uid.to_string(), imap_quote(dest)).await?;
    delete_uid(s, uid).await
}

/// UID SEARCH by Message-ID header; returns the first match (lowest UID).
pub async fn search_message_id(s: &mut ImapSession, message_id: &str) -> Result<Option<u32>, ImapErr> {
    let uids = s
        .uid_search(format!("HEADER Message-ID {}", imap_quote(message_id)))
        .await?;
    Ok(uids.into_iter().min())
}

pub async fn select(s: &mut ImapSession, folder: &str) -> Result<u32, ImapErr> {
    Ok(s.select(folder).await?.exists)
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct InlineAttachment {
    pub content_id: String,
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedMessage {
    pub uid: u32,
    pub message_id: String,
    pub thread_id: String,
    pub subject: String,
    pub snippet: String,
    pub from_name: String,
    pub from_email: String,
    pub to_addresses: String,
    pub cc_addresses: String,
    pub body_text: String,
    pub body_html: String,
    /// Only image parts with a Content-ID (the ones the TS stores)
    pub attachments: Vec<InlineAttachment>,
    pub is_read: bool,
    pub is_starred: bool,
    pub received_at: i64,
}

fn bytes_str(b: &Option<std::borrow::Cow<'_, [u8]>>) -> String {
    b.as_ref()
        .map(|v| String::from_utf8_lossy(v).trim().to_string())
        .unwrap_or_default()
}

/// Port of `parseImapMessage`: envelope for ids, mail-parser for decoded headers/body.
pub fn parse_imap_message(fetch: &Fetch) -> ParsedMessage {
    let mut p = ParsedMessage {
        uid: fetch.uid.unwrap_or(0),
        ..Default::default()
    };
    for flag in fetch.flags() {
        match flag {
            Flag::Seen => p.is_read = true,
            Flag::Flagged => p.is_starred = true,
            _ => {}
        }
    }
    let env = fetch.envelope();
    let parsed = fetch.body().and_then(|raw| MessageParser::default().parse(raw));

    if let Some(env) = env {
        p.message_id = bytes_str(&env.message_id);
        let in_reply_to = bytes_str(&env.in_reply_to);
        p.thread_id = if in_reply_to.is_empty() {
            p.message_id.clone()
        } else {
            in_reply_to
        };
    }

    if let Some(msg) = &parsed {
        p.body_text = msg.body_text(0).map(|t| t.into_owned()).unwrap_or_default();
        // Only a real HTML part counts (mail-parser would otherwise synthesize HTML from text)
        p.body_html = msg
            .html_body
            .iter()
            .filter_map(|id| msg.parts.get(*id as usize))
            .find_map(|part| match &part.body {
                PartType::Html(h) => Some(h.to_string()),
                _ => None,
            })
            .unwrap_or_default();
        let head: String = p.body_text.chars().take(200).collect();
        p.snippet = head.split_whitespace().collect::<Vec<_>>().join(" ");

        for part in &msg.parts {
            let (Some(cid), Some(ct)) = (part.content_id(), part.content_type()) else {
                continue;
            };
            if !ct.ctype().eq_ignore_ascii_case("image") {
                continue;
            }
            let cid = cid.trim().trim_start_matches('<').trim_end_matches('>').to_string();
            if cid.is_empty() {
                continue;
            }
            let mime_type = match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub).to_lowercase(),
                None => ct.ctype().to_lowercase(),
            };
            p.attachments.push(InlineAttachment {
                content_id: cid,
                filename: part.attachment_name().unwrap_or("attachment").to_string(),
                mime_type,
                data: part.contents().to_vec(),
            });
        }

        if let Some(from) = msg.from().and_then(|a| a.first()) {
            p.from_name = from.name().unwrap_or("").to_string();
            p.from_email = from.address().unwrap_or("").to_string();
        }
        let join = |a: Option<&mail_parser::Address>| {
            a.map(|a| a.iter().filter_map(|x| x.address()).collect::<Vec<_>>().join(", "))
                .unwrap_or_default()
        };
        p.to_addresses = join(msg.to());
        p.cc_addresses = join(msg.cc());
        p.subject = msg.subject().unwrap_or("").to_string();
        if let Some(d) = msg.date() {
            p.received_at = d.to_timestamp();
        }
        if p.message_id.is_empty() {
            if let Some(id) = msg.message_id() {
                p.message_id = format!("<{id}>");
                if p.thread_id.is_empty() {
                    p.thread_id = p.message_id.clone();
                }
            }
        }
    } else if let Some(env) = env {
        p.subject = bytes_str(&env.subject);
    }

    if p.subject.is_empty() {
        p.subject = "(No subject)".into();
    }
    if p.received_at == 0 {
        p.received_at = crate::db::now();
    }
    p
}

/// Select `folder` and fetch the last `max` messages. Returns (exists, messages).
async fn fetch_recent(s: &mut ImapSession, folder: &str, max: i64) -> Result<(u32, Vec<ParsedMessage>), ImapErr> {
    let total = select(s, folder).await?;
    if total == 0 {
        return Ok((0, Vec::new()));
    }
    let start = (total as i64 - max + 1).max(1);
    let fetches: Vec<Fetch> = s
        .fetch(format!("{start}:*"), "(UID FLAGS ENVELOPE BODY.PEEK[])")
        .await?
        .try_collect()
        .await?;
    Ok((total, fetches.iter().map(parse_imap_message).collect()))
}

// ---------------------------------------------------------------------------
// Provider core (shared by ImapSmtpProvider / YahooProvider)
// ---------------------------------------------------------------------------

pub struct ImapCore {
    pub state: AppState,
    pub account_id: String,
    pub kind: ImapKind,
}

fn err_result(kind: ImapKind, e: &ImapErr) -> SyncResult {
    SyncResult {
        error: Some(e.message.clone()),
        needs_reauth: Some(kind.is_auth_error(e)),
        ..Default::default()
    }
}

impl ImapCore {
    fn store_message(
        &self,
        conn: &rusqlite::Connection,
        email_id: &str,
        m: &ParsedMessage,
        folder: &str,
    ) -> rusqlite::Result<()> {
        emails_db::upsert_email(
            conn,
            &EmailRow {
                id: email_id.to_string(),
                account_id: self.account_id.clone(),
                thread_id: Some(m.thread_id.clone()),
                message_id: Some(m.message_id.clone()),
                subject: m.subject.clone(),
                snippet: m.snippet.clone(),
                from_name: m.from_name.clone(),
                from_email: m.from_email.clone(),
                to_addresses: m.to_addresses.clone(),
                cc_addresses: Some(m.cc_addresses.clone()),
                bcc_addresses: Some(String::new()),
                body_text: m.body_text.clone(),
                body_html: m.body_html.clone(),
                labels: "[]".into(),
                is_read: m.is_read,
                is_starred: m.is_starred,
                received_at: m.received_at,
                folder: folder.into(),
            },
        )?;
        if folder == "inbox" {
            // Ensure this email is not marked as archived (in case it was un-archived elsewhere)
            conn.execute("UPDATE emails SET is_archived = 0 WHERE id = ?", [email_id])?;
        }
        for att in &m.attachments {
            // Ignore duplicate attachment errors
            let _ = emails_db::insert_attachment(
                conn,
                &format!("{email_id}:{}", att.content_id),
                email_id,
                Some(&att.content_id),
                &att.filename,
                &att.mime_type,
                &att.data,
            );
        }
        Ok(())
    }

    /// Sync IMAP folders as labels (errors are logged and swallowed, as in TS)
    async fn sync_folders(&self, s: &mut ImapSession) {
        let mailboxes = match list_mailboxes(s).await {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(account_id = %self.account_id, error = %e, "[{}] Error syncing folders", self.kind.tag());
                return;
            }
        };
        let conn = self.state.db.conn();
        for mb in &mailboxes {
            let is_special = self.kind.special_folders().iter().any(|f| {
                mb.path == *f
                    || mb.name == *f
                    || mb.path.ends_with(&format!("/{f}"))
                    || (self.kind == ImapKind::Imap && mb.path.starts_with("[Gmail]"))
            });
            if is_special {
                continue;
            }
            let local_id = format!("{}:{}:{}", self.kind.label_prefix(), self.account_id, mb.path);
            let _ = emails_db::upsert_label(
                &conn,
                &local_id,
                &self.account_id,
                &mb.name,
                Some(folder_color(&mb.name)),
                "folder",
                Some(&mb.path),
            );
        }
    }

    /// Archive local inbox emails that weren't seen in the INBOX sync.
    /// IMAP: by normalized Message-ID (stable across folder moves). Yahoo: by local email id (as in yahoo.ts).
    fn reconcile_archived(&self, seen: &HashSet<String>) -> i64 {
        let conn = self.state.db.conn();
        let rows: Vec<(String, Option<String>)> = match self.kind {
            ImapKind::Imap => conn
                .prepare("SELECT id, message_id FROM emails WHERE account_id = ? AND is_archived = 0 AND is_trashed = 0 AND folder = 'inbox'")
                .and_then(|mut st| st.query_map([&self.account_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()),
            ImapKind::Yahoo => conn
                .prepare("SELECT id FROM emails WHERE account_id = ? AND is_archived = 0 AND is_trashed = 0")
                .and_then(|mut st| st.query_map([&self.account_id], |r| Ok((r.get(0)?, None)))?.collect()),
        }
        .unwrap_or_default();
        let mut archived = 0;
        for (id, message_id) in rows {
            let archive = match self.kind {
                ImapKind::Imap => {
                    let n = normalize_message_id(message_id.as_deref());
                    !n.is_empty() && !seen.contains(&n)
                }
                ImapKind::Yahoo => !seen.contains(&id),
            };
            if archive
                && conn
                    .execute("UPDATE emails SET is_archived = 1 WHERE id = ?", [&id])
                    .is_ok()
            {
                archived += 1;
            }
        }
        archived
    }

    pub async fn sync(&self, cfg: &ImapConfig, options: &SyncOptions) -> SyncResult {
        let mut s = match connect(cfg).await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(account_id = %self.account_id, error = %e, "[{}] sync error", self.kind.tag());
                // syncFolders runs first in TS and would have swallowed the same error
                return err_result(self.kind, &e);
            }
        };
        self.sync_folders(&mut s).await;

        let folder = options.folder.clone().unwrap_or_else(|| "INBOX".into());
        let max = options.max_messages.filter(|m| *m > 0).unwrap_or(100);
        let (server_total, messages) = match fetch_recent(&mut s, &folder, max).await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!(account_id = %self.account_id, error = %e, "[{}] sync error", self.kind.tag());
                let _ = s.logout().await;
                return err_result(self.kind, &e);
            }
        };
        let _ = s.logout().await;
        let mut seen = HashSet::new();

        if server_total == 0 {
            // Empty INBOX - mark all local inbox emails as archived
            self.reconcile_archived(&seen);
            return match self.kind {
                ImapKind::Imap => SyncResult {
                    server_total: Some(0),
                    has_more: Some(false),
                    ..Default::default()
                },
                ImapKind::Yahoo => SyncResult::default(),
            };
        }
        let has_more = (server_total as i64 - max + 1) > 1;

        let prefix = self.kind.id_prefix(&self.account_id);
        let mut synced = 0i64;
        {
            let conn = self.state.db.conn();
            for m in &messages {
                let email_id = format!("{prefix}:{}", m.uid);
                match self.kind {
                    ImapKind::Imap => {
                        let n = normalize_message_id(Some(&m.message_id));
                        if !n.is_empty() {
                            seen.insert(n);
                        }
                    }
                    ImapKind::Yahoo => {
                        seen.insert(email_id.clone());
                    }
                }
                match self.store_message(&conn, &email_id, m, "inbox") {
                    Ok(()) => synced += 1,
                    Err(e) => tracing::error!(error = %e, "[{}] Error parsing message", self.kind.tag()),
                }
            }
        }

        let archived = self.reconcile_archived(&seen);
        if archived > 0 {
            tracing::info!(account_id = %self.account_id, archived, "[{}] Reconciled archived emails", self.kind.tag());
        }

        match self.kind {
            ImapKind::Imap => {
                options.report_progress(synced, server_total as i64);
                SyncResult {
                    synced,
                    total: synced,
                    server_total: Some(server_total as i64),
                    has_more: Some(has_more),
                    ..Default::default()
                }
            }
            ImapKind::Yahoo => SyncResult {
                synced,
                total: synced,
                ..Default::default()
            },
        }
    }

    pub async fn sync_sent(&self, cfg: &ImapConfig, options: &SyncOptions) -> SyncResult {
        let res: Result<SyncResult, ImapErr> = async {
            let mut s = connect(cfg).await?;
            let mailboxes = list_mailboxes(&mut s).await?;
            let Some(folder) = find_folder(&mailboxes, self.kind.sent_names()) else {
                let _ = s.logout().await;
                return Ok(SyncResult::error("Sent folder not found"));
            };
            let (total, messages) =
                fetch_recent(&mut s, &folder, options.max_messages.filter(|m| *m > 0).unwrap_or(100)).await?;
            let _ = s.logout().await;
            if total == 0 {
                return Ok(SyncResult::default());
            }
            let prefix = self.kind.id_prefix(&self.account_id);
            let conn = self.state.db.conn();
            let mut synced = 0;
            for m in &messages {
                match self.store_message(&conn, &format!("{prefix}:sent:{}", m.uid), m, "sent") {
                    Ok(()) => synced += 1,
                    Err(e) => tracing::error!(error = %e, "[{}] Error parsing sent message", self.kind.tag()),
                }
            }
            Ok(SyncResult {
                synced,
                total: synced,
                ..Default::default()
            })
        }
        .await;
        res.unwrap_or_else(|e| {
            tracing::error!(account_id = %self.account_id, error = %e, "[{}] syncSent error", self.kind.tag());
            err_result(self.kind, &e)
        })
    }

    pub async fn sync_drafts(&self, cfg: &ImapConfig, options: &SyncOptions) -> SyncResult {
        let res: Result<SyncResult, ImapErr> = async {
            let mut s = connect(cfg).await?;
            let mailboxes = list_mailboxes(&mut s).await?;
            let Some(folder) = find_folder(&mailboxes, self.kind.draft_names()) else {
                let _ = s.logout().await;
                return Ok(SyncResult::error("Drafts folder not found"));
            };
            let (total, messages) =
                fetch_recent(&mut s, &folder, options.max_messages.filter(|m| *m > 0).unwrap_or(50)).await?;
            let _ = s.logout().await;
            if total == 0 {
                return Ok(SyncResult::default());
            }
            let conn = self.state.db.conn();
            let mut synced = 0;
            for m in &messages {
                let local_id = format!("{}:{}:{}", self.kind.draft_prefix(), self.account_id, m.uid);
                let body = if m.body_html.is_empty() {
                    &m.body_text
                } else {
                    &m.body_html
                };
                match emails_db::upsert_draft(
                    &conn,
                    &local_id,
                    &self.account_id,
                    Some(&m.uid.to_string()),
                    &m.to_addresses,
                    &m.cc_addresses,
                    "",
                    &m.subject,
                    body,
                ) {
                    Ok(_) => synced += 1,
                    Err(e) => tracing::error!(error = %e, "[{}] Error parsing draft", self.kind.tag()),
                }
            }
            Ok(SyncResult {
                synced,
                total: synced,
                ..Default::default()
            })
        }
        .await;
        res.unwrap_or_else(|e| {
            tracing::error!(account_id = %self.account_id, error = %e, "[{}] syncDrafts error", self.kind.tag());
            err_result(self.kind, &e)
        })
    }

    fn local_message_id(&self, email_id: &str) -> Result<String, ImapErr> {
        let conn = self.state.db.conn();
        conn.query_row("SELECT message_id FROM emails WHERE id = ?", [email_id], |r| {
            r.get::<_, Option<String>>(0)
        })
        .ok()
        .flatten()
        .filter(|m| !m.is_empty())
        .ok_or_else(|| ImapErr::new("Email not found or has no message_id"))
    }

    async fn with_session<F>(&self, cfg: &ImapConfig, op: &str, f: F) -> ProviderResult<()>
    where
        F: for<'a> FnOnce(&'a mut ImapSession) -> futures::future::BoxFuture<'a, Result<(), ImapErr>>,
    {
        let res: Result<(), ImapErr> = async {
            let mut s = connect(cfg).await?;
            f(&mut s).await?;
            let _ = s.logout().await;
            Ok(())
        }
        .await;
        res.map_err(|e| {
            tracing::error!(account_id = %self.account_id, error = %e, "[{}] {op} error", self.kind.tag());
            e.message
        })
    }

    pub async fn set_flag(
        &self,
        cfg: &ImapConfig,
        email_id: &str,
        flag: &'static str,
        add: bool,
    ) -> ProviderResult<()> {
        let uid = extract_uid(email_id);
        self.with_session(cfg, "flag", move |s| {
            Box::pin(async move {
                select(s, "INBOX").await?;
                if add {
                    add_flags(s, uid, flag).await
                } else {
                    remove_flags(s, uid, flag).await
                }
            })
        })
        .await
    }

    pub async fn archive(&self, cfg: &ImapConfig, email_id: &str) -> ProviderResult<()> {
        let uid = extract_uid(email_id);
        let kind = self.kind;
        self.with_session(cfg, "archive", move |s| {
            Box::pin(async move {
                let mailboxes = list_mailboxes(s).await?;
                let archive = find_folder(&mailboxes, kind.archive_names());
                select(s, "INBOX").await?;
                match archive {
                    Some(folder) => {
                        move_uid(s, uid, &folder).await?;
                        tracing::info!(uid, folder, "[{}] Archived message", kind.tag());
                    }
                    None => {
                        // No archive folder found, create one
                        let r: Result<(), ImapErr> = async {
                            s.create("Archive").await?;
                            move_uid(s, uid, "Archive").await
                        }
                        .await;
                        if let Err(e) = r {
                            tracing::error!(error = %e, "[{}] Could not archive message, no archive folder available", kind.tag());
                            return Err(ImapErr::new("No archive folder available on this server"));
                        }
                        tracing::info!(uid, "[{}] Created Archive folder and archived message", kind.tag());
                    }
                }
                Ok(())
            })
        })
        .await
    }

    /// Move a message from `folder_names` back to INBOX. IMAP finds it by Message-ID; Yahoo uses the UID (as in TS).
    async fn restore(
        &self,
        cfg: &ImapConfig,
        email_id: &str,
        names: &'static [&'static str],
        what: &'static str,
    ) -> ProviderResult<()> {
        let message_id = match self.kind {
            ImapKind::Imap => Some(self.local_message_id(email_id).map_err(|e| e.message)?),
            ImapKind::Yahoo => None,
        };
        let uid = extract_uid(email_id);
        let kind = self.kind;
        self.with_session(cfg, what, move |s| {
            Box::pin(async move {
                let mailboxes = list_mailboxes(s).await?;
                let folder = find_folder(&mailboxes, names)
                    .ok_or_else(|| ImapErr::new(format!("{} folder not found", capitalize(what))))?;
                select(s, &folder).await?;
                let target = match &message_id {
                    Some(mid) => search_message_id(s, mid)
                        .await?
                        .ok_or_else(|| ImapErr::new(format!("Email not found in {what} folder")))?,
                    None => uid,
                };
                move_uid(s, target, "INBOX").await?;
                tracing::info!(folder, "[{}] Restored message from {what} to INBOX", kind.tag());
                Ok(())
            })
        })
        .await
    }

    pub async fn unarchive(&self, cfg: &ImapConfig, email_id: &str) -> ProviderResult<()> {
        self.restore(cfg, email_id, self.kind.archive_names(), "archive").await
    }

    pub async fn untrash(&self, cfg: &ImapConfig, email_id: &str) -> ProviderResult<()> {
        self.restore(cfg, email_id, self.kind.trash_names(), "trash").await
    }

    pub async fn trash(&self, cfg: &ImapConfig, email_id: &str) -> ProviderResult<()> {
        let uid = extract_uid(email_id);
        let kind = self.kind;
        self.with_session(cfg, "trash", move |s| {
            Box::pin(async move {
                let mailboxes = list_mailboxes(s).await?;
                let trash = find_folder(&mailboxes, kind.trash_names());
                select(s, "INBOX").await?;
                match trash {
                    Some(folder) => {
                        move_uid(s, uid, &folder).await?;
                        tracing::info!(uid, folder, "[{}] Trashed message", kind.tag());
                    }
                    None => {
                        // If no trash folder found, mark as deleted and expunge
                        delete_uid(s, uid).await?;
                        tracing::info!(uid, "[{}] Deleted message (no trash folder)", kind.tag());
                    }
                }
                Ok(())
            })
        })
        .await
    }

    pub async fn permanent_delete(&self, cfg: &ImapConfig, email_id: &str) -> ProviderResult<()> {
        let message_id = match self.kind {
            ImapKind::Imap => Some(self.local_message_id(email_id).map_err(|e| e.message)?),
            ImapKind::Yahoo => None,
        };
        let uid = extract_uid(email_id);
        let kind = self.kind;
        self.with_session(cfg, "permanentDelete", move |s| {
            Box::pin(async move {
                let mailboxes = list_mailboxes(s).await?;
                // Try to delete from trash folder first, then INBOX as fallback
                let folder = find_folder(&mailboxes, kind.trash_names()).unwrap_or_else(|| "INBOX".into());
                select(s, &folder).await?;
                let target = match &message_id {
                    Some(mid) => search_message_id(s, mid)
                        .await?
                        .ok_or_else(|| ImapErr::new("Email not found in folder"))?,
                    None => uid,
                };
                delete_uid(s, target).await?;
                tracing::info!(folder, "[{}] Permanently deleted message", kind.tag());
                Ok(())
            })
        })
        .await
    }

    pub async fn delete_draft(&self, cfg: &ImapConfig, draft_uid: &str) -> ProviderResult<()> {
        let uid: u32 = draft_uid.trim().parse().unwrap_or(0);
        let kind = self.kind;
        self.with_session(cfg, "deleteDraft", move |s| {
            Box::pin(async move {
                let mailboxes = list_mailboxes(s).await?;
                let folder = find_folder(&mailboxes, kind.draft_names())
                    .ok_or_else(|| ImapErr::new("Drafts folder not found"))?;
                select(s, &folder).await?;
                delete_uid(s, uid).await
            })
        })
        .await
    }

    #[allow(dead_code)] // reached via EmailProvider::validate_credentials once routes use it
    pub async fn validate(&self, cfg: &ImapConfig) -> bool {
        match connect(cfg).await {
            Ok(mut s) => {
                let _ = s.logout().await;
                true
            }
            Err(e) => {
                tracing::error!(account_id = %self.account_id, error = %e, "[{}] validation error", self.kind.tag());
                false
            }
        }
    }

    /// Persist a just-sent message with folder "sent" (IMAP only in TS).
    /// Fixes vs TS: thread_id falls back to the generated Message-ID, body_text is plain text.
    pub fn save_sent(&self, params: &SendParams, message_id: &str) {
        let email_id = format!("{}:sent:{}", self.account_id, chrono_millis());
        let (from_name, from_email) = parse_from_address(&params.from);
        let local_body = params.local_body.as_deref().unwrap_or(&params.body);
        let body_text = emails_db::html_to_text(local_body);
        let row = EmailRow {
            id: email_id,
            account_id: self.account_id.clone(),
            thread_id: Some(
                params
                    .thread_id
                    .clone()
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| message_id.to_string()),
            ),
            message_id: Some(message_id.to_string()),
            subject: params.subject.clone(),
            snippet: emails_db::snippet(&body_text),
            from_name,
            from_email,
            to_addresses: params.to.clone(),
            cc_addresses: params.cc.clone().filter(|s| !s.is_empty()),
            bcc_addresses: params.bcc.clone().filter(|s| !s.is_empty()),
            body_text,
            body_html: local_body.to_string(),
            labels: "[]".into(),
            is_read: true,
            is_starred: false,
            received_at: crate::db::now(),
            folder: "sent".into(),
        };
        if let Err(e) = emails_db::upsert_email(&self.state.db.conn(), &row) {
            tracing::error!(error = %e, "[IMAP] Failed to save sent email");
        }
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
        .unwrap_or_default()
}

fn chrono_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

pub enum SmtpAuth {
    Password { user: String, pass: String },
    XOAuth2 { user: String, token: String },
}

pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    /// Implicit TLS (port 465); otherwise STARTTLS
    pub secure: bool,
    /// For STARTTLS: fail rather than fall back to plaintext (the account's TLS setting)
    pub require_tls: bool,
    pub auth: SmtpAuth,
}

/// Generate a nodemailer-style Message-ID `<uuid@domain>`
pub fn generate_message_id(from_email: &str) -> String {
    let domain = from_email
        .rsplit_once('@')
        .map(|(_, d)| d.trim())
        .filter(|d| !d.is_empty())
        .unwrap_or("localhost");
    format!("<{}@{}>", uuid::Uuid::new_v4(), domain)
}

/// Build and send via SMTP; returns the Message-ID used.
pub async fn smtp_send(cfg: &SmtpConfig, params: &SendParams) -> Result<String, String> {
    use base64::Engine;
    use lettre::message::{header::ContentType, Attachment as LAttachment, Mailbox, Mailboxes, MultiPart, SinglePart};
    use lettre::transport::smtp::authentication::{Credentials, Mechanism};
    use lettre::transport::smtp::client::{Tls, TlsParameters};
    use lettre::{AsyncSmtpTransport, AsyncTransport, Tokio1Executor};

    let from: Mailbox = params.from.parse().map_err(|e| format!("Invalid from address: {e}"))?;
    let message_id = generate_message_id(from.email.as_ref());
    let mut b = lettre::Message::builder()
        .from(from)
        .subject(params.subject.clone())
        .message_id(Some(message_id.clone()));
    let parse_list = |s: &str| -> Result<Mailboxes, String> {
        s.parse::<Mailboxes>()
            .map_err(|e| format!("Invalid address list '{s}': {e}"))
    };
    for m in parse_list(&params.to)? {
        b = b.to(m);
    }
    if let Some(cc) = params.cc.as_deref().filter(|s| !s.trim().is_empty()) {
        for m in parse_list(cc)? {
            b = b.cc(m);
        }
    }
    if let Some(bcc) = params.bcc.as_deref().filter(|s| !s.trim().is_empty()) {
        for m in parse_list(bcc)? {
            b = b.bcc(m);
        }
    }
    if let Some(v) = params.in_reply_to.clone().filter(|s| !s.is_empty()) {
        b = b.in_reply_to(v);
    }
    if let Some(v) = params.references.clone().filter(|s| !s.is_empty()) {
        b = b.references(v);
    }
    let html = SinglePart::html(params.body.clone());
    let email = if params.attachments.is_empty() {
        b.singlepart(html)
    } else {
        let mut mp = MultiPart::mixed().singlepart(html);
        for att in &params.attachments {
            let data = base64::engine::general_purpose::STANDARD
                .decode(att.content.trim())
                .map_err(|e| format!("Invalid attachment encoding: {e}"))?;
            let ct =
                ContentType::parse(&att.mime_type).unwrap_or(ContentType::parse("application/octet-stream").unwrap());
            mp = mp.singlepart(LAttachment::new(att.filename.clone()).body(data, ct));
        }
        b.multipart(mp)
    }
    .map_err(|e| e.to_string())?;

    let tls_params = TlsParameters::new(cfg.host.clone()).map_err(|e| e.to_string())?;
    let (creds, mech) = match &cfg.auth {
        SmtpAuth::Password { user, pass } => (
            Credentials::new(user.clone(), pass.clone()),
            vec![Mechanism::Plain, Mechanism::Login],
        ),
        SmtpAuth::XOAuth2 { user, token } => (Credentials::new(user.clone(), token.clone()), vec![Mechanism::Xoauth2]),
    };
    let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(cfg.host.clone())
        .port(cfg.port)
        .tls(if cfg.secure {
            Tls::Wrapper(tls_params)
        } else if cfg.require_tls {
            Tls::Required(tls_params)
        } else {
            Tls::Opportunistic(tls_params)
        })
        .credentials(creds)
        .authentication(mech)
        .build();
    transport.send(email).await.map_err(|e| e.to_string())?;
    Ok(message_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imap_normalize_message_id() {
        assert_eq!(normalize_message_id(Some("<ABC@Example.COM>")), "abc@example.com");
        assert_eq!(normalize_message_id(Some("  abc@x  ")), "abc@x");
        assert_eq!(normalize_message_id(Some("<<a>>")), "<a>");
        assert_eq!(normalize_message_id(None), "");
        assert_eq!(normalize_message_id(Some("")), "");
    }

    #[test]
    fn imap_extract_uid() {
        assert_eq!(extract_uid("acct-1:42"), 42);
        assert_eq!(extract_uid("acct-1:sent:7"), 7);
        assert_eq!(extract_uid("yahoo:acct:sent:99"), 99);
        assert_eq!(extract_uid("12abc"), 12);
        assert_eq!(extract_uid("acct:"), 0);
        assert_eq!(extract_uid("acct:x"), 0);
    }

    #[test]
    fn imap_parse_from_address() {
        assert_eq!(
            parse_from_address("\"John Doe\" <john@x.com>"),
            ("John Doe".into(), "john@x.com".into())
        );
        assert_eq!(
            parse_from_address("Jane <jane@x.com>"),
            ("Jane".into(), "jane@x.com".into())
        );
        assert_eq!(parse_from_address("bob@x.com"), ("".into(), "bob@x.com".into()));
        assert_eq!(parse_from_address("<bob@x.com>"), ("".into(), "bob@x.com".into()));
    }

    fn e(msg: &str, auth_failed: bool) -> ImapErr {
        ImapErr {
            message: msg.into(),
            auth_failed,
        }
    }

    #[test]
    fn imap_auth_error_detection() {
        assert!(is_imap_auth_error(&e(
            "no response: [AUTHENTICATIONFAILED] Invalid credentials",
            true
        )));
        assert!(is_imap_auth_error(&e("Login failed", false)));
        assert!(is_imap_auth_error(&e("Wrong password", false)));
        assert!(is_imap_auth_error(&e("no response: bad user", true)));
        // Connection-limit exclusions
        assert!(!is_imap_auth_error(&e(
            "Maximum number of connections from user+IP exceeded",
            true
        )));
        assert!(!is_imap_auth_error(&e("Too many simultaneous connections", true)));
        assert!(!is_imap_auth_error(&e(
            "no response: [UNAVAILABLE] authentication temporarily unavailable",
            true
        )));
        // authenticationFailed flag with "connection" in message isn't auth
        assert!(!is_imap_auth_error(&e("connection reset", true)));
        assert!(!is_imap_auth_error(&e("io: connection refused", false)));
    }

    #[test]
    fn imap_yahoo_auth_error_detection() {
        assert!(is_yahoo_auth_error(&e("invalid_grant", false)));
        assert!(is_yahoo_auth_error(&e("Token expired", false)));
        assert!(is_yahoo_auth_error(&e("whatever", true)));
        assert!(!is_yahoo_auth_error(&e("connection reset", false)));
    }

    #[test]
    fn imap_find_folder_and_colors() {
        let mbs = vec![
            MailboxInfo {
                path: "INBOX".into(),
                name: "INBOX".into(),
            },
            MailboxInfo {
                path: "INBOX.Sent".into(),
                name: "Sent".into(),
            },
            MailboxInfo {
                path: "[Gmail]/All Mail".into(),
                name: "All Mail".into(),
            },
        ];
        assert_eq!(find_folder(&mbs, &["Sent", "Sent Items"]), Some("Sent".into()));
        assert_eq!(
            find_folder(&mbs, &["Archive", "[Gmail]/All Mail"]),
            Some("[Gmail]/All Mail".into())
        );
        assert_eq!(find_folder(&mbs, &["Trash"]), None);
        assert_eq!(folder_color("Drafts"), "#fbbc05");
        assert_eq!(folder_color("Custom"), "#6366f1");
    }

    #[test]
    fn imap_message_id_generation_and_quote() {
        let id = generate_message_id("a@example.org");
        assert!(id.starts_with('<') && id.ends_with("@example.org>"));
        assert_eq!(imap_quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
}
