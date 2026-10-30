//! Web Push for new mail: VAPID keypair + subscriptions live in the DB (migration 017);
//! sending happens in a spawned task so it never blocks sync.

use crate::routes::*;
use crate::{frontend_url, AppState};
use axum::extract::State;
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use serde_json::{json, Value};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::elliptic_curve::rand_core::OsRng;
use p256::SecretKey;
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient, WebPushError,
    WebPushMessageBuilder,
};

use crate::routes::session::AuthUser;

const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/key", get(public_key))
        .route("/subscribe", post(subscribe))
        .route("/unsubscribe", delete(unsubscribe).post(unsubscribe))
}

/// (public, private) VAPID keys as base64url, generated on first use
fn vapid_keys(state: &AppState) -> rusqlite::Result<(String, String)> {
    let conn = state.db.conn();
    let existing = conn.query_row("SELECT public_key, private_key FROM push_vapid WHERE id = 1", [], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    });
    if let Ok(keys) = existing {
        return Ok(keys);
    }
    let secret = SecretKey::random(&mut OsRng);
    let private = URL_SAFE_NO_PAD.encode(secret.to_bytes());
    let public = URL_SAFE_NO_PAD.encode(secret.public_key().to_sec1_bytes());
    // OR IGNORE: a concurrent first call may have won; read back whatever is stored
    conn.execute(
        "INSERT OR IGNORE INTO push_vapid (id, public_key, private_key) VALUES (1, ?, ?)",
        (&public, &private),
    )?;
    conn.query_row("SELECT public_key, private_key FROM push_vapid WHERE id = 1", [], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
}

/// VAPID `sub` claim: `PUSH_CONTACT` (mailto:/https: or a bare address), else the frontend origin
fn vapid_subject() -> String {
    let contact = std::env::var("PUSH_CONTACT").unwrap_or_default();
    let contact = contact.trim();
    if contact.starts_with("mailto:") || contact.starts_with("https://") {
        contact.to_string()
    } else if !contact.is_empty() {
        format!("mailto:{contact}")
    } else if frontend_url().starts_with("https://") {
        frontend_url()
    } else {
        "mailto:admin@example.com".to_string()
    }
}

async fn public_key(State(s): State<AppState>) -> JsonResult {
    match vapid_keys(&s) {
        Ok((public, _)) => ok(json!({ "publicKey": public })),
        Err(e) => fail(e),
    }
}

async fn subscribe(
    State(s): State<AppState>,
    user: Option<Extension<AuthUser>>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Value>,
) -> JsonResult {
    let keys = body.get("keys").cloned().unwrap_or(Value::Null);
    let (Some(endpoint), Some(p256dh), Some(auth)) =
        (str_field(&body, "endpoint"), str_field(&keys, "p256dh"), str_field(&keys, "auth"))
    else {
        return fail("endpoint and keys required");
    };
    let user_id = user.map(|Extension(AuthUser(id))| id);
    let session_hash = crate::routes::session::session_token(&headers).map(|t| crate::routes::api_keys::hash_key(&t));
    let res = s.db.conn().execute(
        "INSERT INTO push_subscriptions (id, user_id, session_hash, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash,
           p256dh = excluded.p256dh, auth = excluded.auth",
        (uuid::Uuid::new_v4().to_string(), user_id, session_hash, endpoint, p256dh, auth),
    );
    match res {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn unsubscribe(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let Some(endpoint) = str_field(&body, "endpoint") else { return fail("endpoint required") };
    match s.db.conn().execute("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

/// Fire-and-forget push to every subscribed device
/// Cut to at most `max` chars (push payloads are capped at ~3KB after encryption)
fn clip(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

pub fn notify_new_mail(state: &AppState, account_id: &str, email_id: &str, title: &str, body: &str) {
    // 120 + 300 chars is under 1.7KB even at 4 bytes per char, leaving room for ids and the URL
    let (title, body) = (clip(title, 120), clip(body, 300));
    let payload = json!({
        "title": title, "body": body, "accountId": account_id, "emailId": email_id,
        "url": format!("/?email={}&account={}", urlencoding::encode(email_id), urlencoding::encode(account_id)),
        "tag": format!("mail-{email_id}"),
    })
    .to_string();
    let state = state.clone();
    tokio::spawn(async move { send_all(&state, payload).await });
}

async fn send_all(state: &AppState, payload: String) {
    let subs: Vec<(String, String, String)> = {
        let conn = state.db.conn();
        // With app login on, only devices whose subscribing session is still signed in
        let sql = if state.auth {
            "SELECT endpoint, p256dh, auth FROM push_subscriptions p WHERE EXISTS
               (SELECT 1 FROM app_sessions s WHERE s.token_hash = p.session_hash AND s.expires_at > unixepoch())"
        } else {
            "SELECT endpoint, p256dh, auth FROM push_subscriptions"
        };
        let Ok(mut stmt) = conn.prepare(sql) else { return };
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)));
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => return,
        }
    };
    if subs.is_empty() {
        return;
    }
    let Ok((_, private)) = vapid_keys(state) else { return };
    let client = HyperWebPushClient::new();
    let subject = vapid_subject();
    // Concurrently, with a timeout each, so one stalled endpoint can't hold up the rest
    let sends = subs.into_iter().map(|(endpoint, p256dh, auth)| {
        let (client, subject, private, payload) = (&client, &subject, &private, &payload);
        async move {
            let info = SubscriptionInfo::new(&endpoint, &p256dh, &auth);
            let send = async {
                let mut sig = VapidSignatureBuilder::from_base64(private, &info)?;
                sig.add_claim("sub", subject.as_str());
                let mut msg = WebPushMessageBuilder::new(&info);
                msg.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
                msg.set_vapid_signature(sig.build()?);
                msg.set_ttl(60 * 60);
                client.send(msg.build()?).await
            };
            // None = timed out
            let result: Option<Result<(), WebPushError>> = tokio::time::timeout(SEND_TIMEOUT, send).await.ok();
            (endpoint, result)
        }
    });
    for (endpoint, result) in futures::future::join_all(sends).await {
        match result {
            None => tracing::warn!(service = "push", "Push send timed out"),
            Some(Ok(())) => {}
            Some(Err(WebPushError::EndpointNotValid(_) | WebPushError::EndpointNotFound(_))) => {
                let _ = state.db.conn().execute("DELETE FROM push_subscriptions WHERE endpoint = ?", [&endpoint]);
                tracing::info!(service = "push", "Removed expired push subscription");
            }
            Some(Err(e)) => tracing::warn!(service = "push", error = %e, "Push send failed"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::clip;

    #[test]
    fn clip_bounds_payload_fields() {
        assert_eq!(clip("short", 10), "short");
        let long = "é".repeat(5000);
        let c = clip(&long, 300);
        assert_eq!(c.chars().count(), 301); // 300 + ellipsis
        assert!(c.len() < 3052);
    }
}
