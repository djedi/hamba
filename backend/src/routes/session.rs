//! Login for the app itself: username/password and passkeys (WebAuthn), cookie sessions.
//! Distinct from `routes/auth.rs`, which connects mail accounts (OAuth/IMAP).
//!
//! Every route except the exemptions in `is_public` requires a session once auth is enabled
//! (`HAMBA_AUTH=off` disables it, e.g. for the local Tauri app). With no user yet, the app
//! is locked and `/session/setup` creates the first one.

use super::*;
use crate::routes::api_keys::hash_key;
use crate::{db, frontend_url, AppState};
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Router};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use webauthn_rs::prelude::*;

const COOKIE: &str = "hamba_session";
const SESSION_DAYS: i64 = 30;
const MIN_PASSWORD_LEN: usize = 8;
const CEREMONY_TTL: Duration = Duration::from_secs(300);
const MAX_FAILURES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

/// The signed-in user's id, added to request extensions by `require_auth`
#[derive(Clone)]
pub struct AuthUser(pub String);

pub fn auth_enabled() -> bool {
    !matches!(
        std::env::var("HAMBA_AUTH").as_deref().map(str::to_ascii_lowercase).as_deref(),
        Ok("off" | "false" | "0")
    )
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/setup", post(setup))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/password", post(change_password))
        .route("/passkeys", get(list_passkeys))
        .route("/passkeys/{id}", delete(delete_passkey))
        .route("/passkeys/register/start", post(register_start))
        .route("/passkeys/register/finish", post(register_finish))
        .route("/passkeys/login/start", post(passkey_login_start))
        .route("/passkeys/login/finish", post(passkey_login_finish))
}

/// Routes reachable without a session
fn is_public(path: &str) -> bool {
    const EXACT: &[&str] = &[
        "/health",
        "/session/status",
        "/session/setup",
        "/session/login",
        "/session/logout",
        "/session/passkeys/login/start",
        "/session/passkeys/login/finish",
    ];
    EXACT.contains(&path)
        // Bearer-key API and its docs, tracking pixels/redirects hit by recipients
        || path.starts_with("/api/v1/")
        || path.starts_with("/docs")
        || path.starts_with("/t/")
}

pub async fn require_auth(State(s): State<AppState>, mut req: Request, next: Next) -> Response {
    if !s.auth || req.method() == axum::http::Method::OPTIONS || is_public(req.uri().path()) {
        return next.run(req).await;
    }
    match session_user(&s, req.headers()) {
        Some(user_id) => {
            req.extensions_mut().insert(AuthUser(user_id));
            next.run(req).await
        }
        None => (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response(),
    }
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))
        .filter(|t| !t.is_empty())
}

/// User id for a valid session cookie; slides the expiry forward when past half its life
fn session_user(s: &AppState, headers: &HeaderMap) -> Option<String> {
    let hash = hash_key(&session_token(headers)?);
    let conn = s.db.conn();
    let (user_id, expires_at): (String, i64) = conn
        .query_row(
            "SELECT user_id, expires_at FROM app_sessions WHERE token_hash = ? AND expires_at > unixepoch()",
            [&hash],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    let now = db::now();
    if expires_at - now < SESSION_DAYS * 86400 / 2 {
        let _ = conn.execute(
            "UPDATE app_sessions SET expires_at = ? WHERE token_hash = ?",
            (now + SESSION_DAYS * 86400, &hash),
        );
    }
    Some(user_id)
}

fn secure_cookies() -> bool {
    frontend_url().starts_with("https://")
}

fn cookie(value: &str, max_age: i64) -> HeaderValue {
    let secure = if secure_cookies() { "; Secure" } else { "" };
    HeaderValue::from_str(&format!(
        "{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"
    ))
    .expect("valid cookie")
}

/// Create a session and return the response that sets its cookie
fn start_session(s: &AppState, user_id: &str, username: &str) -> Response {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let res = s.db.conn().execute(
        "INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (hash_key(&token), user_id, db::now() + SESSION_DAYS * 86400),
    );
    if let Err(e) = res {
        return fail(e).into_response();
    }
    let mut resp = ok(json!({ "success": true, "username": username })).into_response();
    resp.headers_mut().insert(header::SET_COOKIE, cookie(&token, SESSION_DAYS * 86400));
    resp
}

fn user_count(s: &AppState) -> i64 {
    s.db.conn().query_row("SELECT COUNT(*) FROM app_users", [], |r| r.get(0)).unwrap_or(0)
}

fn username_of(s: &AppState, user_id: &str) -> Option<String> {
    s.db.conn()
        .query_row("SELECT username FROM app_users WHERE id = ?", [user_id], |r| r.get(0))
        .ok()
}

// ---------- passwords ----------

async fn hash_password(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use argon2::password_hash::{PasswordHasher, SaltString};
        // v4 UUIDs come from the OS CSPRNG
        let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes()).map_err(|e| e.to_string())?;
        argon2::Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn verify_password(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        use argon2::password_hash::{PasswordHash, PasswordVerifier};
        PasswordHash::new(&hash)
            .map(|h| argon2::Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false)
}

fn validate_password(p: &str) -> Result<(), String> {
    if p.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!("Password must be at least {MIN_PASSWORD_LEN} characters"));
    }
    Ok(())
}

/// Create or reset a user's password (also used by the `set-password` CLI command)
pub async fn set_password(s: &AppState, username: &str, password: &str) -> Result<String, String> {
    validate_password(password)?;
    let hash = hash_password(password.to_string()).await?;
    let conn = s.db.conn();
    let existing: Option<String> = conn
        .query_row("SELECT id FROM app_users WHERE username = ?", [username], |r| r.get(0))
        .ok();
    match existing {
        Some(id) => {
            conn.execute("UPDATE app_users SET password_hash = ? WHERE id = ?", (&hash, &id))
                .map_err(|e| e.to_string())?;
            // A reset signs out every existing session
            conn.execute("DELETE FROM app_sessions WHERE user_id = ?", [&id]).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO app_users (id, username, password_hash) VALUES (?, ?, ?)",
                (&id, username, &hash),
            )
            .map_err(|e| e.to_string())?;
            Ok(id)
        }
    }
}

/// Per-username failed-login counter: `MAX_FAILURES` misses locks the name for `LOCKOUT`
static FAILURES: LazyLock<Mutex<HashMap<String, (u32, Instant)>>> = LazyLock::new(Default::default);

fn locked_out(username: &str) -> bool {
    let map = FAILURES.lock().unwrap();
    matches!(map.get(username), Some((n, at)) if *n >= MAX_FAILURES && at.elapsed() < LOCKOUT)
}

fn record_failure(username: &str) {
    let mut map = FAILURES.lock().unwrap();
    let entry = map.entry(username.to_string()).or_insert((0, Instant::now()));
    if entry.1.elapsed() >= LOCKOUT {
        *entry = (0, Instant::now());
    }
    entry.0 += 1;
    entry.1 = Instant::now();
}

// ---------- handlers ----------

async fn status(State(s): State<AppState>, headers: HeaderMap) -> JsonResult {
    let user = if s.auth { session_user(&s, &headers) } else { None };
    let passkey_count: i64 =
        s.db.conn().query_row("SELECT COUNT(*) FROM app_passkeys", [], |r| r.get(0)).unwrap_or(0);
    ok(json!({
        "authEnabled": s.auth,
        "authenticated": !s.auth || user.is_some(),
        "setupRequired": s.auth && user_count(&s) == 0,
        "username": user.as_deref().and_then(|id| username_of(&s, id)),
        "passkeysSupported": webauthn().is_some(),
        "hasPasskeys": passkey_count > 0,
    }))
}

fn credentials(body: &Value) -> Result<(String, String), &'static str> {
    let username = str_field(body, "username").map(str::trim).filter(|u| !u.is_empty());
    let password = str_field(body, "password");
    match (username, password) {
        (Some(u), Some(p)) => Ok((u.chars().take(100).collect(), p.to_string())),
        _ => Err("Username and password required"),
    }
}

async fn setup(State(s): State<AppState>, Json(body): Json<Value>) -> Response {
    if user_count(&s) > 0 {
        return fail("Setup already complete").into_response();
    }
    let (username, password) = match credentials(&body) {
        Ok(c) => c,
        Err(e) => return fail(e).into_response(),
    };
    match set_password(&s, &username, &password).await {
        Ok(id) => start_session(&s, &id, &username),
        Err(e) => fail(e).into_response(),
    }
}

async fn login(State(s): State<AppState>, Json(body): Json<Value>) -> Response {
    let (username, password) = match credentials(&body) {
        Ok(c) => c,
        Err(e) => return fail(e).into_response(),
    };
    let key = username.to_lowercase();
    if locked_out(&key) {
        return fail("Too many attempts. Try again in a minute.").into_response();
    }
    let row: Option<(String, String, String)> = s
        .db
        .conn()
        .query_row(
            "SELECT id, username, password_hash FROM app_users WHERE username = ?",
            [&username],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    // Verify against a throwaway hash for unknown users so timing doesn't reveal which names exist
    let hash = match &row {
        Some(r) => r.2.clone(),
        None => hash_password(Uuid::new_v4().to_string()).await.unwrap_or_default(),
    };
    if verify_password(password, hash).await {
        if let Some((id, name, _)) = row {
            FAILURES.lock().unwrap().remove(&key);
            return start_session(&s, &id, &name);
        }
    }
    record_failure(&key);
    fail("Invalid username or password").into_response()
}

async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = session_token(&headers) {
        let _ = s.db.conn().execute("DELETE FROM app_sessions WHERE token_hash = ?", [hash_key(&token)]);
    }
    let mut resp = ok(json!({ "success": true })).into_response();
    resp.headers_mut().insert(header::SET_COOKIE, cookie("", 0));
    resp
}

async fn change_password(
    State(s): State<AppState>,
    user: Option<Extension<AuthUser>>,
    Json(body): Json<Value>,
) -> JsonResult {
    let Some(Extension(AuthUser(user_id))) = user else {
        return fail("Not signed in");
    };
    let (Some(current), Some(new)) = (str_field(&body, "currentPassword"), str_field(&body, "newPassword")) else {
        return fail("Current and new password required");
    };
    if let Err(e) = validate_password(new) {
        return fail(e);
    }
    let stored: Option<String> = s
        .db
        .conn()
        .query_row("SELECT password_hash FROM app_users WHERE id = ?", [&user_id], |r| r.get(0))
        .ok();
    let Some(stored) = stored else { return fail("Not signed in") };
    if !verify_password(current.to_string(), stored).await {
        return fail("Current password is incorrect");
    }
    let hash = match hash_password(new.to_string()).await {
        Ok(h) => h,
        Err(e) => return fail(e),
    };
    match s.db.conn().execute("UPDATE app_users SET password_hash = ? WHERE id = ?", (&hash, &user_id)) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

// ---------- passkeys ----------

/// WebAuthn needs a secure context: an https origin, or localhost. None otherwise.
fn webauthn() -> Option<&'static Webauthn> {
    static INSTANCE: LazyLock<Option<Webauthn>> = LazyLock::new(|| {
        let origin = Url::parse(&frontend_url()).ok()?;
        let host = origin.host_str()?.to_string();
        if origin.scheme() != "https" && host != "localhost" {
            return None;
        }
        WebauthnBuilder::new(&host, &origin)
            .ok()?
            .rp_name("Hamba")
            .allow_any_port(true)
            .build()
            .ok()
    });
    INSTANCE.as_ref()
}

enum Ceremony {
    Register { user_id: String, state: PasskeyRegistration },
    Login(DiscoverableAuthentication),
}

/// In-flight registration/login ceremonies, keyed by an id handed to the client
static CEREMONIES: LazyLock<Mutex<HashMap<String, (Instant, Ceremony)>>> = LazyLock::new(Default::default);

fn put_ceremony(c: Ceremony) -> String {
    let id = Uuid::new_v4().to_string();
    let mut map = CEREMONIES.lock().unwrap();
    map.retain(|_, (at, _)| at.elapsed() < CEREMONY_TTL);
    map.insert(id.clone(), (Instant::now(), c));
    id
}

fn take_ceremony(body: &Value) -> Option<Ceremony> {
    let id = str_field(body, "ceremonyId")?;
    let (at, c) = CEREMONIES.lock().unwrap().remove(id)?;
    (at.elapsed() < CEREMONY_TTL).then_some(c)
}

fn load_passkeys(s: &AppState, user_id: Option<&str>) -> Vec<(String, String, Passkey)> {
    let conn = s.db.conn();
    let sql = "SELECT id, user_id, passkey FROM app_passkeys WHERE ?1 IS NULL OR user_id = ?1";
    let Ok(mut stmt) = conn.prepare(sql) else { return vec![] };
    stmt.query_map([user_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .map(|rows| {
            rows.filter_map(Result::ok)
                .filter_map(|(id, uid, pk)| Some((id, uid, serde_json::from_str(&pk).ok()?)))
                .collect()
        })
        .unwrap_or_default()
}

fn cred_key(id: &CredentialID) -> String {
    serde_json::to_value(id).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

async fn list_passkeys(State(s): State<AppState>, user: Option<Extension<AuthUser>>) -> JsonResult {
    let Some(Extension(AuthUser(user_id))) = user else { return ok(json!([])) };
    match db::query_all(
        &s.db.conn(),
        "SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt
         FROM app_passkeys WHERE user_id = ? ORDER BY created_at DESC",
        [&user_id],
    ) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn delete_passkey(
    State(s): State<AppState>,
    user: Option<Extension<AuthUser>>,
    Path(id): Path<String>,
) -> JsonResult {
    let Some(Extension(AuthUser(user_id))) = user else { return fail("Not signed in") };
    match s.db.conn().execute("DELETE FROM app_passkeys WHERE id = ? AND user_id = ?", (&id, &user_id)) {
        Ok(0) => fail("Passkey not found"),
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => fail(e),
    }
}

async fn register_start(State(s): State<AppState>, user: Option<Extension<AuthUser>>) -> JsonResult {
    let Some(wa) = webauthn() else { return fail("Passkeys need an https origin (or localhost)") };
    let Some(Extension(AuthUser(user_id))) = user else { return fail("Not signed in") };
    let Ok(uuid) = Uuid::parse_str(&user_id) else { return fail("Invalid user") };
    let Some(username) = username_of(&s, &user_id) else { return fail("Not signed in") };
    let exclude: Vec<CredentialID> =
        load_passkeys(&s, Some(&user_id)).iter().map(|(_, _, pk)| pk.cred_id().clone()).collect();
    match wa.start_passkey_registration(uuid, &username, &username, Some(exclude)) {
        Ok((options, state)) => {
            let ceremony_id = put_ceremony(Ceremony::Register { user_id, state });
            ok(json!({ "ceremonyId": ceremony_id, "options": options }))
        }
        Err(e) => fail(e),
    }
}

async fn register_finish(
    State(s): State<AppState>,
    user: Option<Extension<AuthUser>>,
    Json(body): Json<Value>,
) -> JsonResult {
    let Some(wa) = webauthn() else { return fail("Passkeys unavailable") };
    let Some(Extension(AuthUser(user_id))) = user else { return fail("Not signed in") };
    let Some(Ceremony::Register { user_id: started_by, state }) = take_ceremony(&body) else {
        return fail("Passkey setup expired; try again");
    };
    if started_by != user_id {
        return fail("Passkey setup expired; try again");
    }
    let Some(cred) = body.get("credential").and_then(|c| serde_json::from_value(c.clone()).ok()) else {
        return fail("Invalid credential");
    };
    let passkey = match wa.finish_passkey_registration(&cred, &state) {
        Ok(pk) => pk,
        Err(e) => return fail(format!("Passkey verification failed: {e}")),
    };
    let name: String = str_field(&body, "name").unwrap_or("Passkey").trim().chars().take(100).collect();
    let id = cred_key(passkey.cred_id());
    let res = s.db.conn().execute(
        "INSERT INTO app_passkeys (id, user_id, name, passkey) VALUES (?, ?, ?, ?)",
        (&id, &user_id, &name, serde_json::to_string(&passkey).unwrap_or_default()),
    );
    match res {
        Ok(_) => ok(json!({ "success": true, "id": id, "name": name })),
        Err(e) if is_unique_violation(&e) => fail("This passkey is already registered"),
        Err(e) => fail(e),
    }
}

async fn passkey_login_start() -> JsonResult {
    let Some(wa) = webauthn() else { return fail("Passkeys unavailable") };
    match wa.start_discoverable_authentication() {
        Ok((options, state)) => {
            let ceremony_id = put_ceremony(Ceremony::Login(state));
            ok(json!({ "ceremonyId": ceremony_id, "options": options }))
        }
        Err(e) => fail(e),
    }
}

async fn passkey_login_finish(State(s): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(wa) = webauthn() else { return fail("Passkeys unavailable").into_response() };
    let Some(Ceremony::Login(state)) = take_ceremony(&body) else {
        return fail("Sign-in expired; try again").into_response();
    };
    let Some(cred) = body
        .get("credential")
        .and_then(|c| serde_json::from_value::<PublicKeyCredential>(c.clone()).ok())
    else {
        return fail("Invalid credential").into_response();
    };
    let Ok((_, cred_id)) = wa.identify_discoverable_authentication(&cred) else {
        return fail("Unknown passkey").into_response();
    };
    let key = cred_key(&CredentialID::from(cred_id.to_vec()));
    let Some((id, user_id, mut passkey)) = load_passkeys(&s, None).into_iter().find(|(id, _, _)| *id == key) else {
        return fail("Unknown passkey").into_response();
    };
    let result = match wa.finish_discoverable_authentication(&cred, state, &[DiscoverableKey::from(&passkey)]) {
        Ok(r) => r,
        Err(_) => return fail("Passkey verification failed").into_response(),
    };
    passkey.update_credential(&result);
    let _ = s.db.conn().execute(
        "UPDATE app_passkeys SET passkey = ?, last_used_at = unixepoch() WHERE id = ?",
        (serde_json::to_string(&passkey).unwrap_or_default(), &id),
    );
    let Some(username) = username_of(&s, &user_id) else {
        return fail("Unknown passkey").into_response();
    };
    start_session(&s, &user_id, &username)
}
