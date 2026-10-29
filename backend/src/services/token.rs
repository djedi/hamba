//! OAuth token refresh (port of backend/src/services/token.ts).

use crate::db::{self, query_one};
use crate::AppState;
use base64::Engine;
use serde_json::Value;

/// Seconds before expiry at which a token is considered stale.
const BUFFER_SECONDS: i64 = 300;

#[derive(Debug, Clone, Default)]
pub struct TokenResult {
    pub token: Option<String>,
    pub error: Option<String>,
    pub needs_reauth: bool,
}

impl TokenResult {
    fn ok(token: Option<String>) -> Self {
        TokenResult {
            token,
            ..Default::default()
        }
    }
    fn err(msg: &str) -> Self {
        TokenResult {
            error: Some(msg.into()),
            ..Default::default()
        }
    }
    fn reauth(msg: &str) -> Self {
        TokenResult {
            error: Some(msg.into()),
            needs_reauth: true,
            ..Default::default()
        }
    }
}

fn env(key: &str) -> String {
    std::env::var(key).unwrap_or_default()
}

/// Pure expiry check shared by refresh + status: true if token is missing/expired/expiring soon.
pub fn is_expiring(token_expires_at: Option<i64>, now: i64) -> bool {
    match token_expires_at {
        Some(exp) if exp != 0 => exp <= now + BUFFER_SECONDS,
        _ => true,
    }
}

fn load_account(state: &AppState, account_id: &str) -> Option<Value> {
    let conn = state.db.conn();
    query_one(&conn, "SELECT * FROM accounts WHERE id = ?", [account_id])
        .ok()
        .flatten()
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}

/// Persist refreshed tokens (same statement as `accountQueries.upsert`).
pub fn save_tokens(
    state: &AppState,
    id: &str,
    email: &str,
    name: Option<&str>,
    access_token: Option<&str>,
    refresh_token: Option<&str>,
    expires_at: i64,
) -> rusqlite::Result<usize> {
    state.db.conn().execute(
        "INSERT INTO accounts (id, email, name, access_token, refresh_token, token_expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(email) DO UPDATE SET
           name = excluded.name,
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           token_expires_at = excluded.token_expires_at,
           updated_at = unixepoch()",
        rusqlite::params![id, email, name, access_token, refresh_token, expires_at],
    )
}

enum Kind {
    Google,
    Microsoft,
    Yahoo,
}

async fn refresh(state: &AppState, account_id: &str, kind: Kind) -> TokenResult {
    let Some(account) = load_account(state, account_id) else {
        return TokenResult::err("Account not found");
    };
    let provider_type = s(&account, "provider_type");
    let label = match kind {
        Kind::Google => "",
        Kind::Microsoft => {
            if provider_type.as_deref() != Some("microsoft") {
                return TokenResult::err("Not a Microsoft account");
            }
            "Microsoft "
        }
        Kind::Yahoo => {
            if provider_type.as_deref() != Some("yahoo") {
                return TokenResult::err("Not a Yahoo account");
            }
            "Yahoo "
        }
    };

    let email = s(&account, "email").unwrap_or_default();
    if !is_expiring(account.get("token_expires_at").and_then(Value::as_i64), db::now()) {
        return TokenResult::ok(s(&account, "access_token"));
    }

    tracing::info!(email, "Refreshing {label}token");
    let Some(refresh_token) = s(&account, "refresh_token").filter(|t| !t.is_empty()) else {
        return TokenResult::reauth("No refresh token available");
    };

    let client = reqwest::Client::new();
    let req = match kind {
        Kind::Google => client.post("https://oauth2.googleapis.com/token").form(&[
            ("client_id", env("GOOGLE_CLIENT_ID")),
            ("client_secret", env("GOOGLE_CLIENT_SECRET")),
            ("refresh_token", refresh_token.clone()),
            ("grant_type", "refresh_token".into()),
        ]),
        Kind::Microsoft => client
            .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
            .form(&[
                ("client_id", env("MICROSOFT_CLIENT_ID")),
                ("client_secret", env("MICROSOFT_CLIENT_SECRET")),
                ("refresh_token", refresh_token.clone()),
                ("grant_type", "refresh_token".into()),
                ("scope", MICROSOFT_SCOPES.into()),
            ]),
        Kind::Yahoo => {
            let basic = base64::engine::general_purpose::STANDARD.encode(format!(
                "{}:{}",
                env("YAHOO_CLIENT_ID"),
                env("YAHOO_CLIENT_SECRET")
            ));
            client
                .post("https://api.login.yahoo.com/oauth2/get_token")
                .header("Authorization", format!("Basic {basic}"))
                .form(&[
                    ("refresh_token", refresh_token.clone()),
                    ("grant_type", "refresh_token".into()),
                ])
        }
    };

    let tokens: Value = match req.send().await {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "{label}Token refresh error");
                return TokenResult::err("Network error during token refresh");
            }
        },
        Err(e) => {
            tracing::error!(error = %e, "{label}Token refresh error");
            return TokenResult::err("Network error during token refresh");
        }
    };

    if let Some(err) = tokens.get("error").filter(|e| !e.is_null()) {
        let desc = s(&tokens, "error_description");
        tracing::error!(description = ?desc, "{label}Token refresh failed");
        let code = err.as_str().unwrap_or_default();
        if code == "invalid_grant" || code == "invalid_token" {
            return TokenResult::reauth("Session expired. Please re-authenticate.");
        }
        return TokenResult::err(
            desc.as_deref()
                .filter(|d| !d.is_empty())
                .unwrap_or("Token refresh failed"),
        );
    }

    let access = s(&tokens, "access_token");
    let expires_in = tokens
        .get("expires_in")
        .and_then(Value::as_i64)
        .filter(|n| *n != 0)
        .unwrap_or(3600);
    let expires_at = db::now() + expires_in;
    // Google keeps the existing refresh token; Microsoft/Yahoo may rotate it.
    let new_refresh = match kind {
        Kind::Google => Some(refresh_token),
        _ => s(&tokens, "refresh_token")
            .filter(|t| !t.is_empty())
            .or(Some(refresh_token)),
    };
    if let Err(e) = save_tokens(
        state,
        account_id,
        &email,
        s(&account, "name").as_deref(),
        access.as_deref(),
        new_refresh.as_deref(),
        expires_at,
    ) {
        tracing::error!(error = %e, "Failed to persist refreshed token");
    }
    tracing::info!(email, "{label}Token refreshed");
    TokenResult::ok(access)
}

pub const MICROSOFT_SCOPES: &str = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access";

/// Get a valid Google access token, refreshing if needed.
pub async fn get_valid_access_token(state: &AppState, account_id: &str) -> TokenResult {
    refresh(state, account_id, Kind::Google).await
}

/// Get a valid Microsoft access token, refreshing if needed.
pub async fn get_microsoft_access_token(state: &AppState, account_id: &str) -> TokenResult {
    refresh(state, account_id, Kind::Microsoft).await
}

/// Get a valid Yahoo access token, refreshing if needed.
pub async fn get_yahoo_access_token(state: &AppState, account_id: &str) -> TokenResult {
    refresh(state, account_id, Kind::Yahoo).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_logic() {
        let now = 1_000_000;
        assert!(is_expiring(None, now));
        assert!(is_expiring(Some(0), now));
        assert!(is_expiring(Some(now), now));
        assert!(is_expiring(Some(now + 300), now));
        assert!(!is_expiring(Some(now + 301), now));
    }
}
