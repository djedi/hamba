//! OAuth + account routes (port of backend/src/routes/auth.ts). Nest at `/auth`.

use super::{ok, JsonResult, QueryMap};
use crate::db::{now, query_all, query_one};
use crate::providers::get_provider;
use crate::services::token::{get_valid_access_token, save_tokens, MICROSOFT_SCOPES};
use crate::AppState;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const GOOGLE_SCOPES: &str = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const YAHOO_SCOPES: &str = "openid email profile mail-w";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const YAHOO_TOKEN_URL: &str = "https://api.login.yahoo.com/oauth2/get_token";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_default()
}
fn env_or(k: &str, d: &str) -> String {
    std::env::var(k)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| d.to_string())
}
fn google_redirect() -> String {
    env_or("REDIRECT_URI", "http://localhost:8877/auth/callback")
}
fn ms_redirect() -> String {
    env_or(
        "MICROSOFT_REDIRECT_URI",
        "http://localhost:8877/auth/microsoft/callback",
    )
}
fn yahoo_redirect() -> String {
    env_or("YAHOO_REDIRECT_URI", "http://localhost:8877/auth/yahoo/callback")
}
fn yahoo_basic() -> String {
    let creds = format!("{}:{}", env("YAHOO_CLIENT_ID"), env("YAHOO_CLIENT_SECRET"));
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(creds))
}

/// 302 redirect (Elysia's `redirect()` default)
fn redirect(url: String) -> Response {
    (StatusCode::FOUND, [(header::LOCATION, url)]).into_response()
}

fn err(msg: impl Into<String>) -> Response {
    Json(json!({ "error": msg.into() })).into_response()
}

pub fn encode_query(params: &[(&str, &str)]) -> String {
    // URLSearchParams uses form encoding (space => '+')
    params
        .iter()
        .map(|(k, v)| {
            format!(
                "{}={}",
                urlencoding::encode(k),
                urlencoding::encode(v).replace("%20", "+")
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn success_redirect(email: &str) -> Response {
    redirect(format!(
        "{}/?auth=success&email={}",
        crate::frontend_url(),
        urlencoding::encode(email)
    ))
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn expires_at(tokens: &Value) -> i64 {
    now()
        + tokens
            .get("expires_in")
            .and_then(Value::as_i64)
            .filter(|n| *n != 0)
            .unwrap_or(3600)
}

async fn post_form(url: &str, auth: Option<String>, form: &[(&str, String)]) -> Result<Value, String> {
    let mut req = reqwest::Client::new().post(url).form(form);
    if let Some(a) = auth {
        req = req.header("Authorization", a);
    }
    let r = req.send().await.map_err(|e| e.to_string())?;
    r.json().await.map_err(|e| e.to_string())
}

async fn get_bearer(url: &str, token: &str) -> Result<Value, String> {
    let r = reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    r.json().await.map_err(|e| e.to_string())
}

fn has_error(v: &Value) -> bool {
    v.get("error").is_some_and(|e| !e.is_null() && e != "")
}

/// OAuth error text: error_description || error (stringified)
fn oauth_error(v: &Value) -> String {
    s(v, "error_description")
        .map(str::to_string)
        .or_else(|| {
            v.get("error")
                .map(|e| e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string()))
        })
        .unwrap_or_else(|| "Failed to get access token".into())
}

// ---------- Google ----------

async fn login() -> Response {
    let q = encode_query(&[
        ("client_id", &env("GOOGLE_CLIENT_ID")),
        ("redirect_uri", &google_redirect()),
        ("response_type", "code"),
        ("scope", GOOGLE_SCOPES),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    redirect(format!("https://accounts.google.com/o/oauth2/v2/auth?{q}"))
}

async fn callback(State(state): State<AppState>, q: QueryMap) -> Response {
    let Some(code) = q.get("code").filter(|c| !c.is_empty()).cloned() else {
        return err("No authorization code provided");
    };
    let tokens = match post_form(
        GOOGLE_TOKEN_URL,
        None,
        &[
            ("client_id", env("GOOGLE_CLIENT_ID")),
            ("client_secret", env("GOOGLE_CLIENT_SECRET")),
            ("code", code),
            ("grant_type", "authorization_code".into()),
            ("redirect_uri", google_redirect()),
        ],
    )
    .await
    {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    if has_error(&tokens) {
        return Json(json!({ "error": tokens.get("error_description") })).into_response();
    }
    let access = s(&tokens, "access_token").unwrap_or("").to_string();
    let user = match get_bearer("https://www.googleapis.com/oauth2/v2/userinfo", &access).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let email = s(&user, "email").unwrap_or("").to_string();
    let id = uuid::Uuid::new_v4().to_string();
    if let Err(e) = save_tokens(
        &state,
        &id,
        &email,
        s(&user, "name"),
        Some(&access),
        Some(s(&tokens, "refresh_token").unwrap_or("")),
        expires_at(&tokens),
    ) {
        return err(e.to_string());
    }
    success_redirect(&email)
}

// ---------- Microsoft / Yahoo ----------

async fn login_microsoft() -> Response {
    let cid = env("MICROSOFT_CLIENT_ID");
    if cid.is_empty() {
        return err("Microsoft OAuth is not configured");
    }
    let q = encode_query(&[
        ("client_id", &cid),
        ("redirect_uri", &ms_redirect()),
        ("response_type", "code"),
        ("scope", MICROSOFT_SCOPES),
        ("response_mode", "query"),
    ]);
    redirect(format!(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{q}"
    ))
}

async fn login_yahoo() -> Response {
    let cid = env("YAHOO_CLIENT_ID");
    if cid.is_empty() {
        return err("Yahoo OAuth is not configured");
    }
    let q = encode_query(&[
        ("client_id", &cid),
        ("redirect_uri", &yahoo_redirect()),
        ("response_type", "code"),
        ("scope", YAHOO_SCOPES),
    ]);
    redirect(format!("https://api.login.yahoo.com/oauth2/request_auth?{q}"))
}

fn upsert_oauth_account(
    state: &AppState,
    provider: &str,
    email: &str,
    name: &str,
    tokens: &Value,
) -> rusqlite::Result<usize> {
    let id = uuid::Uuid::new_v4().to_string();
    let sql = format!(
        "INSERT INTO accounts (id, email, name, provider_type, access_token, refresh_token, token_expires_at, updated_at)
         VALUES (?, ?, ?, '{provider}', ?, ?, ?, unixepoch())
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           provider_type = '{provider}',
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           token_expires_at = excluded.token_expires_at,
           updated_at = unixepoch()"
    );
    // refresh_token ?? null: keep empty string if provider returned one
    let refresh = tokens.get("refresh_token").and_then(Value::as_str);
    state.db.conn().execute(
        &sql,
        rusqlite::params![id, email, name, s(tokens, "access_token"), refresh, expires_at(tokens)],
    )
}

fn email_local(email: &str) -> String {
    email
        .split('@')
        .next()
        .filter(|p| !p.is_empty())
        .unwrap_or(email)
        .to_string()
}

/// Shared prelude: returns Err(response) for OAuth error / missing code.
#[allow(clippy::result_large_err)]
fn callback_code(q: &HashMap<String, String>) -> Result<String, Response> {
    if let Some(e) = q.get("error").filter(|e| !e.is_empty()) {
        return Err(err(q
            .get("error_description")
            .filter(|d| !d.is_empty())
            .unwrap_or(e)
            .clone()));
    }
    q.get("code")
        .filter(|c| !c.is_empty())
        .cloned()
        .ok_or_else(|| err("No authorization code provided"))
}

async fn microsoft_callback(State(state): State<AppState>, q: QueryMap) -> Response {
    let code = match callback_code(&q) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let tokens = match post_form(
        MS_TOKEN_URL,
        None,
        &[
            ("client_id", env("MICROSOFT_CLIENT_ID")),
            ("client_secret", env("MICROSOFT_CLIENT_SECRET")),
            ("code", code),
            ("grant_type", "authorization_code".into()),
            ("redirect_uri", ms_redirect()),
            ("scope", MICROSOFT_SCOPES.into()),
        ],
    )
    .await
    {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let Some(access) = s(&tokens, "access_token").filter(|_| !has_error(&tokens)) else {
        return err(oauth_error(&tokens));
    };
    let user = match get_bearer("https://graph.microsoft.com/v1.0/me", access).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let email = s(&user, "mail")
        .or_else(|| s(&user, "userPrincipalName"))
        .unwrap_or("")
        .to_string();
    if email.is_empty() {
        return err("Could not retrieve email address from Microsoft account");
    }
    // displayName ?? local-part (?? keeps empty string)
    let name = user
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| email_local(&email));
    if let Err(e) = upsert_oauth_account(&state, "microsoft", &email, &name, &tokens) {
        return err(e.to_string());
    }
    success_redirect(&email)
}

async fn yahoo_callback(State(state): State<AppState>, q: QueryMap) -> Response {
    let code = match callback_code(&q) {
        Ok(c) => c,
        Err(r) => return r,
    };
    let tokens = match post_form(
        YAHOO_TOKEN_URL,
        Some(yahoo_basic()),
        &[
            ("code", code),
            ("grant_type", "authorization_code".into()),
            ("redirect_uri", yahoo_redirect()),
        ],
    )
    .await
    {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let Some(access) = s(&tokens, "access_token").filter(|_| !has_error(&tokens)) else {
        return err(oauth_error(&tokens));
    };
    let user = match get_bearer("https://api.login.yahoo.com/openid/v1/userinfo", access).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let email = s(&user, "email").unwrap_or("").to_string();
    if email.is_empty() {
        return err("Could not retrieve email address from Yahoo account");
    }
    let name = s(&user, "name")
        .or_else(|| s(&user, "given_name"))
        .or_else(|| s(&user, "preferred_username"))
        .map(str::to_string)
        .unwrap_or_else(|| email_local(&email));
    if let Err(e) = upsert_oauth_account(&state, "yahoo", &email, &name, &tokens) {
        return err(e.to_string());
    }
    success_redirect(&email)
}

// ---------- Accounts ----------

const SENSITIVE: &[&str] = &["access_token", "refresh_token", "token_expires_at", "password"];

fn strip_sensitive(mut a: Map<String, Value>) -> Map<String, Value> {
    for k in SENSITIVE {
        a.remove(*k);
    }
    a
}

/// Compute `tokenStatus` exactly as the TS does.
pub fn token_status(provider_type: Option<&str>, token_expires_at: Option<i64>, now: i64) -> &'static str {
    if provider_type == Some("imap") {
        return "valid";
    }
    match token_expires_at {
        Some(t) if t != 0 => {
            if t > now {
                "valid"
            } else {
                "expired"
            }
        }
        _ => "unknown",
    }
}

fn or_default(a: &Map<String, Value>, k: &str, d: Value) -> Value {
    a.get(k).filter(|v| !v.is_null()).cloned().unwrap_or(d)
}

async fn list_accounts(State(state): State<AppState>) -> JsonResult {
    let conn = state.db.conn();
    let accounts = query_all(&conn, "SELECT * FROM accounts", []).unwrap_or_default();
    let unread = crate::emails_db::unread_counts(&conn);
    drop(conn);
    let t = now();
    let out: Vec<Value> = accounts
        .into_iter()
        .filter_map(|a| match a {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .map(|m| {
            let status = token_status(
                m.get("provider_type").and_then(Value::as_str),
                m.get("token_expires_at").and_then(Value::as_i64),
                t,
            );
            let id = m.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let mut a = strip_sensitive(m);
            let display = a
                .get("display_name")
                .filter(|v| v.as_str().is_some_and(|s| !s.is_empty()))
                .cloned()
                .unwrap_or(Value::Null);
            a.insert("display_name".into(), display);
            let freq = or_default(&a, "sync_frequency_seconds", json!(60));
            a.insert("sync_frequency_seconds".into(), freq);
            let lim = or_default(&a, "initial_sync_limit", json!(100));
            a.insert("initial_sync_limit".into(), lim);
            let all = or_default(&a, "sync_all_mail", json!(0));
            a.insert("sync_all_mail".into(), all);
            for k in ["sync_progress_total", "sync_progress_synced", "last_full_sync_at"] {
                let v = or_default(&a, k, Value::Null);
                a.insert(k.into(), v);
            }
            a.insert("unread_count".into(), json!(unread.get(&id).copied().unwrap_or(0)));
            a.insert("tokenStatus".into(), json!(status));
            Value::Object(a)
        })
        .collect();
    ok(Value::Array(out))
}

fn b(body: &Value, k: &str) -> Option<bool> {
    body.get(k).and_then(Value::as_bool)
}
fn n(body: &Value, k: &str) -> Option<i64> {
    body.get(k)
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .filter(|n| *n != 0)
}

async fn add_imap_account(State(state): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let (Some(email), Some(password), Some(imap_host), Some(smtp_host)) = (
        s(&body, "email"),
        s(&body, "password"),
        s(&body, "imapHost"),
        s(&body, "smtpHost"),
    ) else {
        return ok(json!({ "error": "Missing required fields (email, password, imapHost, smtpHost)" }));
    };
    let id = uuid::Uuid::new_v4().to_string();
    // name ?? local-part (stored); name || local-part (returned)
    let raw_name = body.get("name").and_then(Value::as_str);
    let stored_name = raw_name
        .map(str::to_string)
        .unwrap_or_else(|| email.split('@').next().unwrap_or(email).to_string());
    let returned_name = raw_name
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| email.split('@').next().unwrap_or("").to_string());

    let insert = state.db.conn().execute(
        "INSERT INTO accounts (
           id, email, name, username, provider_type,
           imap_host, imap_port, imap_use_tls,
           smtp_host, smtp_port, smtp_use_tls,
           password
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            id,
            email,
            stored_name,
            s(&body, "username"),
            "imap",
            imap_host,
            n(&body, "imapPort").unwrap_or(993),
            (b(&body, "imapUseTls") != Some(false)) as i64,
            smtp_host,
            n(&body, "smtpPort").unwrap_or(587),
            (b(&body, "smtpUseTls") != Some(false)) as i64,
            password,
        ],
    );
    let delete = |state: &AppState| {
        let _ = state.db.conn().execute("DELETE FROM accounts WHERE id = ?", [&id]);
    };
    if let Err(e) = insert {
        delete(&state);
        let msg = e.to_string();
        if msg.contains("UNIQUE constraint") {
            return ok(json!({ "error": "An account with this email already exists" }));
        }
        return ok(json!({ "error": format!("Failed to add account: {msg}") }));
    }

    // Test the connection
    let valid = match get_provider(&state, &id) {
        Ok(p) => p.validate_credentials().await,
        Err(_) => false,
    };
    if !valid {
        delete(&state);
        return ok(json!({ "error": "Invalid IMAP credentials - could not connect to server" }));
    }

    // Start IMAP IDLE for real-time notifications (fire-and-forget)
    tokio::spawn(crate::services::imap_idle::start_idle(state.clone(), id.clone()));

    ok(json!({
        "success": true,
        "account": { "id": id, "email": email, "name": returned_name, "provider_type": "imap" }
    }))
}

async fn account_status(State(state): State<AppState>, Path(id): Path<String>) -> JsonResult {
    // Parity: TS uses the Google refresher for every provider here
    let r = get_valid_access_token(&state, &id).await;
    let mut out = json!({ "valid": r.token.is_some(), "needsReauth": r.needs_reauth });
    if let Some(e) = r.error {
        out["error"] = json!(e);
    }
    ok(out)
}

async fn get_account(State(state): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let row = query_one(&state.db.conn(), "SELECT * FROM accounts WHERE id = ?", [&id])
        .ok()
        .flatten();
    match row {
        Some(Value::Object(m)) => ok(Value::Object(strip_sensitive(m))),
        _ => ok(json!({ "error": "Account not found" })),
    }
}

async fn update_account(State(state): State<AppState>, Path(id): Path<String>, Json(body): Json<Value>) -> JsonResult {
    let conn = state.db.conn();
    let Some(Value::Object(acc)) = query_one(&conn, "SELECT * FROM accounts WHERE id = ?", [&id])
        .ok()
        .flatten()
    else {
        return ok(json!({ "error": "Account not found" }));
    };
    let num = |k: &str| {
        body.get(k)
            .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
    };
    let sync_freq = num("syncFrequencySeconds").map(|v| v.clamp(30, 3600));
    let sync_limit = num("initialSyncLimit").map(|v| v.clamp(10, 1000));
    let sync_all = b(&body, "syncAllMail");

    let display = body
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| acc.get("display_name").and_then(Value::as_str).map(str::to_string));
    let freq = sync_freq
        .or_else(|| acc.get("sync_frequency_seconds").and_then(Value::as_i64))
        .unwrap_or(60);
    let _ = conn.execute(
        "UPDATE accounts SET display_name = ?, sync_frequency_seconds = ?, updated_at = unixepoch() WHERE id = ?",
        rusqlite::params![display, freq, id],
    );
    if sync_limit.is_some() || sync_all.is_some() {
        let limit = sync_limit
            .or_else(|| acc.get("initial_sync_limit").and_then(Value::as_i64))
            .unwrap_or(100);
        let all = sync_all.unwrap_or_else(|| acc.get("sync_all_mail").and_then(Value::as_i64).unwrap_or(0) != 0);
        let _ = conn.execute(
            "UPDATE accounts SET initial_sync_limit = ?, sync_all_mail = ?, updated_at = unixepoch() WHERE id = ?",
            rusqlite::params![limit, all as i64, id],
        );
    }
    ok(json!({ "success": true }))
}

async fn delete_account(State(state): State<AppState>, Path(id): Path<String>) -> JsonResult {
    let _ = state.db.conn().execute("DELETE FROM accounts WHERE id = ?", [&id]);
    ok(json!({ "success": true }))
}

async fn refresh(State(state): State<AppState>, Path(account_id): Path<String>) -> JsonResult {
    let acc = query_one(&state.db.conn(), "SELECT * FROM accounts WHERE id = ?", [&account_id])
        .ok()
        .flatten();
    let Some(acc) = acc.filter(|a| s(a, "refresh_token").is_some()) else {
        return ok(json!({ "error": "Account not found or no refresh token" }));
    };
    let refresh_token = s(&acc, "refresh_token").unwrap_or_default().to_string();
    let provider = s(&acc, "provider_type").unwrap_or("");

    let tokens = match provider {
        "microsoft" => {
            post_form(
                MS_TOKEN_URL,
                None,
                &[
                    ("client_id", env("MICROSOFT_CLIENT_ID")),
                    ("client_secret", env("MICROSOFT_CLIENT_SECRET")),
                    ("refresh_token", refresh_token.clone()),
                    ("grant_type", "refresh_token".into()),
                    ("scope", MICROSOFT_SCOPES.into()),
                ],
            )
            .await
        }
        "yahoo" => {
            post_form(
                YAHOO_TOKEN_URL,
                Some(yahoo_basic()),
                &[
                    ("refresh_token", refresh_token.clone()),
                    ("grant_type", "refresh_token".into()),
                ],
            )
            .await
        }
        _ => {
            post_form(
                GOOGLE_TOKEN_URL,
                None,
                &[
                    ("client_id", env("GOOGLE_CLIENT_ID")),
                    ("client_secret", env("GOOGLE_CLIENT_SECRET")),
                    ("refresh_token", refresh_token.clone()),
                    ("grant_type", "refresh_token".into()),
                ],
            )
            .await
        }
    };
    let tokens = match tokens {
        Ok(t) => t,
        Err(e) => return ok(json!({ "error": e })),
    };
    let exp = expires_at(&tokens);
    match provider {
        "microsoft" | "yahoo" => {
            if has_error(&tokens) {
                return ok(json!({ "error": oauth_error(&tokens) }));
            }
            let new_refresh = s(&tokens, "refresh_token").unwrap_or(&refresh_token).to_string();
            let _ = state.db.conn().execute(
                "UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = unixepoch() WHERE id = ?",
                rusqlite::params![s(&tokens, "access_token"), new_refresh, exp, account_id],
            );
        }
        _ => {
            if has_error(&tokens) {
                return ok(json!({ "error": tokens.get("error_description") }));
            }
            let _ = save_tokens(
                &state,
                &account_id,
                s(&acc, "email").unwrap_or(""),
                acc.get("name").and_then(Value::as_str),
                s(&tokens, "access_token"),
                Some(&refresh_token),
                exp,
            );
        }
    }
    ok(json!({ "success": true }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/login", get(login))
        .route("/callback", get(callback))
        .route("/login/microsoft", get(login_microsoft))
        .route("/microsoft/callback", get(microsoft_callback))
        .route("/login/yahoo", get(login_yahoo))
        .route("/yahoo/callback", get(yahoo_callback))
        .route("/accounts", get(list_accounts))
        .route("/accounts/imap", post(add_imap_account))
        .route("/accounts/{id}/status", get(account_status))
        .route(
            "/accounts/{id}",
            get(get_account).put(update_account).delete(delete_account),
        )
        .route("/refresh/{account_id}", post(refresh))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_status_logic() {
        assert_eq!(token_status(Some("imap"), None, 100), "valid");
        assert_eq!(token_status(Some("gmail"), None, 100), "unknown");
        assert_eq!(token_status(None, Some(101), 100), "valid");
        assert_eq!(token_status(None, Some(100), 100), "expired");
    }

    #[test]
    fn query_encoding_matches_urlsearchparams() {
        assert_eq!(
            encode_query(&[("scope", "a b"), ("r", "http://x/y")]),
            "scope=a+b&r=http%3A%2F%2Fx%2Fy"
        );
    }
}
