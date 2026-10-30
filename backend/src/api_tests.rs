//! HTTP-level tests against an in-memory database (ported from the TS route tests).

use crate::{build_app, db, realtime, AppState};
use axum::body::Body;
use axum::http::{Method, Request};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

const ACCOUNT: &str = "acct-1";

fn state() -> AppState {
    let db = db::Db::open(":memory:").unwrap();
    db.conn()
        .execute(
            "INSERT INTO accounts (id, email, name, provider_type) VALUES (?, 'me@example.com', 'Me', 'imap')",
            [ACCOUNT],
        )
        .unwrap();
    AppState {
        db,
        realtime: realtime::Realtime::default(),
        auth: false,
    }
}

async fn call(state: &AppState, method: Method, uri: &str, body: Option<Value>) -> Value {
    let mut req = Request::builder().method(method).uri(uri);
    let body = match body {
        Some(b) => {
            req = req.header("content-type", "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let res = build_app(state.clone()).oneshot(req.body(body).unwrap()).await.unwrap();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn insert_email(state: &AppState, id: &str, subject: &str, extra: &str) {
    state
        .db
        .conn()
        .execute(
            &format!(
                "INSERT INTO emails (id, account_id, message_id, subject, snippet, from_email, from_name, to_addresses, body_text, received_at{})
                 VALUES (?, ?, ?, ?, '', 'alice@example.com', 'Alice', 'me@example.com', 'hello world', 1700000000{})",
                if extra.is_empty() { "" } else { ", folder" },
                if extra.is_empty() { String::new() } else { format!(", '{extra}'") }
            ),
            (id, ACCOUNT, format!("<{id}@x>"), subject),
        )
        .unwrap();
}

#[tokio::test]
async fn health() {
    assert_eq!(
        call(&state(), Method::GET, "/health", None).await,
        json!({ "status": "ok" })
    );
}

#[tokio::test]
async fn snippets_crud_and_validation() {
    let s = state();
    let bad = call(
        &s,
        Method::POST,
        "/snippets",
        Some(json!({ "accountId": ACCOUNT, "name": "n", "shortcut": "has space", "content": "c" })),
    )
    .await;
    assert_eq!(bad["success"], false);

    let created = call(
        &s,
        Method::POST,
        "/snippets",
        Some(json!({ "accountId": ACCOUNT, "name": "Thanks", "shortcut": "ty", "content": "Thank you!" })),
    )
    .await;
    assert_eq!(created["success"], true);
    let id = created["id"].as_str().unwrap();

    let dup = call(
        &s,
        Method::POST,
        "/snippets",
        Some(json!({ "accountId": ACCOUNT, "name": "x", "shortcut": "ty", "content": "x" })),
    )
    .await;
    assert_eq!(dup["error"], "A snippet with this shortcut already exists");

    let found = call(
        &s,
        Method::GET,
        &format!("/snippets/by-shortcut/ty?accountId={ACCOUNT}"),
        None,
    )
    .await;
    assert_eq!(found["content"], "Thank you!");

    call(
        &s,
        Method::PUT,
        &format!("/snippets/{id}"),
        Some(json!({ "content": "Thanks!" })),
    )
    .await;
    let list = call(&s, Method::GET, &format!("/snippets?accountId={ACCOUNT}"), None).await;
    assert_eq!(list[0]["content"], "Thanks!");
    assert_eq!(list[0]["shortcut"], "ty");

    assert_eq!(
        call(&s, Method::DELETE, &format!("/snippets/{id}"), None).await["success"],
        true
    );
    assert_eq!(
        call(&s, Method::DELETE, &format!("/snippets/{id}"), None).await["error"],
        "Snippet not found"
    );
    assert_eq!(
        call(&s, Method::GET, "/snippets", None).await["error"],
        "accountId required"
    );
}

#[tokio::test]
async fn signatures_default_handling() {
    let s = state();
    let a = call(
        &s,
        Method::POST,
        "/signatures",
        Some(json!({ "accountId": ACCOUNT, "name": "A", "content": "a", "isDefault": true })),
    )
    .await;
    let b = call(
        &s,
        Method::POST,
        "/signatures",
        Some(json!({ "accountId": ACCOUNT, "name": "B", "content": "", "isDefault": true })),
    )
    .await;
    let default = call(&s, Method::GET, &format!("/signatures/default/{ACCOUNT}"), None).await;
    assert_eq!(default["id"], b["id"]);

    call(
        &s,
        Method::POST,
        &format!("/signatures/{}/default", a["id"].as_str().unwrap()),
        None,
    )
    .await;
    let default = call(&s, Method::GET, &format!("/signatures/default/{ACCOUNT}"), None).await;
    assert_eq!(default["id"], a["id"]);

    call(
        &s,
        Method::DELETE,
        &format!("/signatures/{}/default", a["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(
        call(&s, Method::GET, &format!("/signatures/default/{ACCOUNT}"), None).await,
        Value::Null
    );
}

#[tokio::test]
async fn labels_and_email_links() {
    let s = state();
    insert_email(&s, "e1", "Hi", "");
    let label = call(
        &s,
        Method::POST,
        "/labels",
        Some(json!({ "accountId": ACCOUNT, "name": "Work" })),
    )
    .await;
    let id = label["id"].as_str().unwrap();
    assert_eq!(
        call(
            &s,
            Method::POST,
            "/labels",
            Some(json!({ "accountId": ACCOUNT, "name": "Work" }))
        )
        .await["error"],
        "Label already exists"
    );

    call(&s, Method::POST, &format!("/labels/{id}/emails/e1"), None).await;
    assert_eq!(
        call(&s, Method::GET, &format!("/labels/{id}/count"), None).await["count"],
        1
    );
    assert_eq!(
        call(&s, Method::GET, &format!("/labels/{id}/emails"), None).await[0]["id"],
        "e1"
    );
    assert_eq!(
        call(&s, Method::GET, "/labels/email/e1", None).await[0]["color"],
        "#6366f1"
    );

    call(&s, Method::DELETE, &format!("/labels/{id}/emails/e1"), None).await;
    assert_eq!(
        call(&s, Method::GET, &format!("/labels/{id}/count"), None).await["count"],
        0
    );
}

#[tokio::test]
async fn contacts_populate_and_search() {
    let s = state();
    insert_email(&s, "e1", "Hi", "");
    s.db.conn()
        .execute(
            "UPDATE emails SET cc_addresses = 'Bob Smith <BOB@example.com>, carol@example.com'",
            [],
        )
        .unwrap();
    let result = call(
        &s,
        Method::POST,
        &format!("/contacts/populate?accountId={ACCOUNT}"),
        None,
    )
    .await;
    assert_eq!(result["count"], 4);

    let found = call(
        &s,
        Method::GET,
        &format!("/contacts/search?accountId={ACCOUNT}&q=bob"),
        None,
    )
    .await;
    assert_eq!(found[0]["email"], "bob@example.com");
    assert_eq!(found[0]["name"], "Bob Smith");

    let recent = call(
        &s,
        Method::GET,
        &format!("/contacts/search?accountId={ACCOUNT}&limit=2"),
        None,
    )
    .await;
    assert_eq!(recent.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn drafts_upsert() {
    let s = state();
    call(
        &s,
        Method::POST,
        "/drafts",
        Some(json!({ "id": "d1", "accountId": ACCOUNT, "subject": "First" })),
    )
    .await;
    call(
        &s,
        Method::POST,
        "/drafts",
        Some(json!({ "id": "d1", "accountId": ACCOUNT, "subject": "Second", "to": "x@y.z" })),
    )
    .await;
    let drafts = call(&s, Method::GET, &format!("/drafts?accountId={ACCOUNT}"), None).await;
    assert_eq!(drafts.as_array().unwrap().len(), 1);
    assert_eq!(drafts[0]["subject"], "Second");
    assert_eq!(drafts[0]["to_addresses"], "x@y.z");
    assert_eq!(
        call(&s, Method::POST, "/drafts", Some(json!({ "id": "d2" }))).await["error"],
        "id and accountId are required"
    );
}

#[tokio::test]
async fn email_listing_by_folder() {
    let s = state();
    insert_email(&s, "inbox1", "Inbox", "");
    insert_email(&s, "sent1", "Sent", "sent");
    let inbox = call(&s, Method::GET, &format!("/emails?accountId={ACCOUNT}"), None).await;
    assert_eq!(inbox.as_array().unwrap().len(), 1);
    assert_eq!(inbox[0]["id"], "inbox1");
    let sent = call(&s, Method::GET, &format!("/emails/sent?accountId={ACCOUNT}"), None).await;
    assert_eq!(sent[0]["id"], "sent1");
    assert_eq!(call(&s, Method::GET, "/emails/inbox1", None).await["subject"], "Inbox");
}

#[tokio::test]
async fn snooze_and_reminders() {
    let s = state();
    insert_email(&s, "e1", "Hi", "");
    assert_eq!(
        call(&s, Method::POST, "/emails/e1/snooze", Some(json!({}))).await["error"],
        "snoozedUntil timestamp required"
    );
    call(
        &s,
        Method::POST,
        "/emails/e1/snooze",
        Some(json!({ "snoozedUntil": 4000000000i64 })),
    )
    .await;
    assert_eq!(
        call(&s, Method::GET, &format!("/emails?accountId={ACCOUNT}"), None).await,
        json!([])
    );
    assert_eq!(
        call(&s, Method::GET, &format!("/emails/snoozed?accountId={ACCOUNT}"), None).await[0]["id"],
        "e1"
    );
    call(&s, Method::POST, "/emails/e1/unsnooze", None).await;

    call(
        &s,
        Method::POST,
        "/emails/e1/reminder",
        Some(json!({ "remindAt": 4000000000i64 })),
    )
    .await;
    assert_eq!(
        call(&s, Method::GET, &format!("/emails/reminders?accountId={ACCOUNT}"), None).await[0]["id"],
        "e1"
    );
    call(&s, Method::DELETE, "/emails/e1/reminder", None).await;
    assert_eq!(
        call(&s, Method::GET, &format!("/emails/reminders?accountId={ACCOUNT}"), None).await,
        json!([])
    );
    assert_eq!(
        call(&s, Method::POST, "/emails/nope/unsnooze", None).await["error"],
        "Email not found"
    );
}

#[tokio::test]
async fn search_with_operators() {
    let s = state();
    insert_email(&s, "e1", "Budget review", "");
    insert_email(&s, "e2", "Lunch", "");
    s.db.conn()
        .execute("UPDATE emails SET is_starred = 1 WHERE id = 'e2'", [])
        .unwrap();
    let r = call(
        &s,
        Method::GET,
        &format!("/emails/search?q=subject:budget&accountId={ACCOUNT}"),
        None,
    )
    .await;
    assert_eq!(r.as_array().unwrap().len(), 1);
    assert_eq!(r[0]["id"], "e1");
    let r = call(&s, Method::GET, "/emails/search?q=is:starred", None).await;
    assert_eq!(r[0]["id"], "e2");
    assert_eq!(
        call(&s, Method::GET, "/emails/search", None).await["error"],
        "Search query required"
    );
}

#[tokio::test]
async fn queue_and_cancel_send() {
    let s = state();
    let missing = call(
        &s,
        Method::POST,
        "/emails/queue-send",
        Some(json!({ "accountId": ACCOUNT })),
    )
    .await;
    assert_eq!(missing["success"], false);
    let queued = call(
        &s,
        Method::POST,
        "/emails/queue-send",
        Some(json!({ "accountId": ACCOUNT, "to": "x@y.z", "subject": "Hi", "body": "b" })),
    )
    .await;
    assert_eq!(queued["undoWindowSeconds"], 5);
    let id = queued["pendingId"].as_str().unwrap();
    assert_eq!(
        call(&s, Method::DELETE, &format!("/emails/pending/{id}"), None).await["success"],
        true
    );
    assert_eq!(
        call(&s, Method::DELETE, &format!("/emails/pending/{id}"), None).await["error"],
        "Pending send not found"
    );
}

#[tokio::test]
async fn schedule_lifecycle() {
    let s = state();
    let past = call(
        &s,
        Method::POST,
        "/emails/schedule",
        Some(json!({ "accountId": ACCOUNT, "to": "x@y.z", "subject": "Hi", "body": "b", "sendAt": 1 })),
    )
    .await;
    assert_eq!(past["error"], "Scheduled time must be in the future");
    let created = call(&s, Method::POST, "/emails/schedule", Some(json!({ "accountId": ACCOUNT, "to": "x@y.z", "cc": "c@y.z", "subject": "Hi", "body": "b", "sendAt": 4000000000i64 }))).await;
    let id = created["scheduledId"].as_str().unwrap();

    // cc: "" clears it; subject omitted keeps the old value
    call(
        &s,
        Method::PUT,
        &format!("/emails/scheduled/{id}"),
        Some(json!({ "cc": "", "body": "new" })),
    )
    .await;
    let row = call(&s, Method::GET, &format!("/emails/scheduled/{id}"), None).await;
    assert_eq!(row["cc_addresses"], Value::Null);
    assert_eq!(row["subject"], "Hi");
    assert_eq!(row["body"], "new");

    assert_eq!(
        call(&s, Method::GET, &format!("/emails/scheduled?accountId={ACCOUNT}"), None)
            .await
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&s, Method::DELETE, &format!("/emails/scheduled/{id}"), None).await["success"],
        true
    );
}

#[tokio::test]
async fn batch_validation() {
    let s = state();
    assert_eq!(
        call(
            &s,
            Method::POST,
            "/emails/batch/archive",
            Some(json!({ "emailIds": [] }))
        )
        .await["error"],
        "emailIds array required"
    );
    let many: Vec<String> = (0..101).map(|i| i.to_string()).collect();
    assert_eq!(
        call(
            &s,
            Method::POST,
            "/emails/batch/trash",
            Some(json!({ "emailIds": many }))
        )
        .await["error"],
        "Maximum 100 emails per batch"
    );
}

#[tokio::test]
async fn unread_counts_per_account() {
    let s = state();
    s.db.conn()
        .execute(
            "INSERT INTO accounts (id, email, name, provider_type) VALUES ('acct-2', 'you@example.com', 'You', 'imap')",
            [],
        )
        .unwrap();
    // (id, account, folder, is_read, is_archived)
    let rows = [
        ("u1", ACCOUNT, "inbox", 0, 0),
        ("u2", ACCOUNT, "inbox", 0, 0),
        ("r1", ACCOUNT, "inbox", 1, 0),
        ("a1", ACCOUNT, "inbox", 0, 1),
        ("u3", "acct-2", "inbox", 0, 0),
    ];
    for (id, account, folder, is_read, is_archived) in rows {
        s.db.conn()
            .execute(
                "INSERT INTO emails (id, account_id, message_id, subject, snippet, from_email, from_name, to_addresses, body_text, received_at, folder, is_read, is_archived)
                 VALUES (?, ?, ?, 's', '', 'alice@example.com', 'Alice', 'me@example.com', 'hello', 1700000000, ?, ?, ?)",
                (id, account, format!("<{id}@x>"), folder, is_read, is_archived),
            )
            .unwrap();
    }

    assert_eq!(
        call(&s, Method::GET, "/emails/unread-counts", None).await,
        json!({ "acct-1": 2, "acct-2": 1 })
    );

    let accounts = call(&s, Method::GET, "/auth/accounts", None).await;
    let count = |id: &str| {
        accounts
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == id)
            .map(|a| a["unread_count"].clone())
    };
    assert_eq!(count("acct-1"), Some(json!(2)));
    assert_eq!(count("acct-2"), Some(json!(1)));
}

#[tokio::test]
async fn account_color_validation() {
    let s = state();
    let put = |c: &str| call(&s, Method::PUT, "/auth/accounts/acct-1", Some(json!({ "color": c })));
    assert!(put("red").await["error"].is_string());
    assert!(put("#12345").await["error"].is_string());
    assert_eq!(put("#A1B2C3").await["success"], true);
    let accounts = call(&s, Method::GET, "/auth/accounts", None).await;
    assert_eq!(accounts[0]["color"], "#a1b2c3");
    assert_eq!(accounts[0]["has_avatar"], false);
    assert!(accounts[0].get("avatar").is_none());
}

#[tokio::test]
async fn account_avatar_upload_get_delete() {
    use base64::Engine;
    let s = state();
    let bytes = vec![137u8, 80, 78, 71, 1, 2, 3];
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let url = "/auth/accounts/acct-1/avatar";

    let get = |s: &AppState| {
        let req = Request::builder().uri(url).body(Body::empty()).unwrap();
        build_app(s.clone()).oneshot(req)
    };
    assert_eq!(get(&s).await.unwrap().status(), 404);

    let bad = call(&s, Method::POST, url, Some(json!({ "data": b64, "mimeType": "image/svg+xml" }))).await;
    assert!(bad["error"].is_string());
    let big = base64::engine::general_purpose::STANDARD.encode(vec![0u8; 2 * 1024 * 1024 + 1]);
    let too_big = call(&s, Method::POST, url, Some(json!({ "data": big, "mimeType": "image/png" }))).await;
    assert!(too_big["error"].is_string());

    let up = call(&s, Method::POST, url, Some(json!({ "data": b64, "mimeType": "image/png" }))).await;
    assert_eq!(up["success"], true);

    let res = get(&s).await.unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.headers()["content-type"], "image/png");
    assert!(res.headers()["cache-control"].to_str().unwrap().contains("max-age=31536000"));
    assert_eq!(res.into_body().collect().await.unwrap().to_bytes().to_vec(), bytes);

    let accounts = call(&s, Method::GET, "/auth/accounts", None).await;
    assert_eq!(accounts[0]["has_avatar"], true);
    assert!(accounts[0]["avatar_updated_at"].is_i64());

    assert_eq!(call(&s, Method::DELETE, url, None).await["success"], true);
    assert_eq!(get(&s).await.unwrap().status(), 404);
}

// ---------- Public API (/api/v1) ----------

async fn raw(state: &AppState, method: Method, uri: &str, key: Option<&str>, body: Option<Value>) -> (u16, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(k) = key {
        req = req.header("authorization", format!("Bearer {k}"));
    }
    let body = match body {
        Some(b) => {
            req = req.header("content-type", "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let res = build_app(state.clone()).oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status().as_u16();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn make_key(s: &AppState, name: &str) -> Value {
    call(s, Method::POST, "/api-keys", Some(json!({ "name": name }))).await
}

#[tokio::test]
async fn api_keys_shown_once_and_never_listed() {
    let s = state();
    let created = make_key(&s, "agent").await;
    let key = created["key"].as_str().unwrap();
    assert!(key.starts_with("hamba_") && key.len() >= 38);
    assert_eq!(created["keyPrefix"], &key[..12]);

    let list = call(&s, Method::GET, "/api-keys", None).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["name"], "agent");
    assert!(!list.to_string().contains(key));
    assert!(list[0].get("key").is_none() && list[0].get("keyHash").is_none() && list[0].get("key_hash").is_none());

    // Only the hash is stored
    let stored: String = s.db.conn().query_row("SELECT key_hash FROM api_keys", [], |r| r.get(0)).unwrap();
    assert_ne!(stored, key);
    assert_eq!(make_key(&s, " ").await["success"], false);
}

#[tokio::test]
async fn v1_requires_valid_key() {
    let s = state();
    let (st, body) = raw(&s, Method::GET, "/api/v1/accounts", None, None).await;
    assert_eq!(st, 401);
    assert_eq!(body["error"]["code"], "unauthorized");
    assert_eq!(raw(&s, Method::GET, "/api/v1/accounts", Some("hamba_nope"), None).await.0, 401);

    let created = make_key(&s, "k").await;
    let key = created["key"].as_str().unwrap();
    assert_eq!(raw(&s, Method::GET, "/api/v1/accounts", Some(key), None).await.0, 200);
    let used: Option<i64> = s.db.conn().query_row("SELECT last_used_at FROM api_keys", [], |r| r.get(0)).unwrap();
    assert!(used.is_some());

    let id = created["id"].as_str().unwrap();
    assert_eq!(call(&s, Method::DELETE, &format!("/api-keys/{id}"), None).await["success"], true);
    assert_eq!(raw(&s, Method::GET, "/api/v1/accounts", Some(key), None).await.0, 401);
    assert_eq!(raw(&s, Method::GET, "/api/v1/emails", Some(key), None).await.0, 401);
    assert_eq!(call(&s, Method::GET, "/api-keys", None).await, json!([]));
}

#[tokio::test]
async fn v1_reads_accounts_emails_threads_search() {
    let s = state();
    insert_email(&s, "e1", "Quarterly report", "");
    insert_email(&s, "e2", "Lunch plans", "");
    {
        let c = s.db.conn();
        c.execute(
            "UPDATE emails SET thread_id = 't1', to_addresses = '\"Doe, Me\" <me@example.com>, b@x.com', labels = '[\"INBOX\"]' WHERE id = 'e1'",
            [],
        )
        .unwrap();
        c.execute("UPDATE emails SET thread_id = 't1', received_at = 1700000500 WHERE id = 'e2'", []).unwrap();
        crate::emails_db::insert_attachment(&c, "att1", "e1", None, "a.txt", "text/plain", b"hi").unwrap();
    }
    let key = make_key(&s, "k").await["key"].as_str().unwrap().to_string();
    let k = Some(key.as_str());

    let (_, accts) = raw(&s, Method::GET, "/api/v1/accounts", k, None).await;
    assert_eq!(accts["data"][0]["email"], "me@example.com");
    assert_eq!(accts["data"][0]["unreadCount"], 2);
    assert!(!accts.to_string().contains("token"));

    let (st, list) = raw(&s, Method::GET, "/api/v1/emails?unread=true&limit=1", k, None).await;
    assert_eq!(st, 200);
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    assert_eq!(list["pagination"]["hasMore"], true);
    assert_eq!(list["data"][0]["id"], "e2");
    assert_eq!(list["data"][0]["receivedAt"], "2023-11-14T22:21:40Z");

    let (_, list) = raw(&s, Method::GET, "/api/v1/emails?q=quarterly&since=2023-01-01", k, None).await;
    assert_eq!(list["data"][0]["id"], "e1");
    assert_eq!(list["data"][0]["to"], json!(["\"Doe, Me\" <me@example.com>", "b@x.com"]));
    assert_eq!(list["data"][0]["hasAttachments"], true);
    assert_eq!(list["data"][0]["labels"], json!(["INBOX"]));
    assert_eq!(raw(&s, Method::GET, "/api/v1/emails?since=garbage", k, None).await.0, 400);

    let (st, one) = raw(&s, Method::GET, "/api/v1/emails/e1", k, None).await;
    assert_eq!(st, 200);
    assert_eq!(one["bodyText"], "hello world");
    assert_eq!(one["attachments"][0]["filename"], "a.txt");
    assert_eq!(raw(&s, Method::GET, "/api/v1/emails/nope", k, None).await.0, 404);

    let (_, th) = raw(&s, Method::GET, "/api/v1/threads/t1", k, None).await;
    let ids: Vec<&str> = th["messages"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["e1", "e2"]);
    assert_eq!(raw(&s, Method::GET, "/api/v1/threads/zzz", k, None).await.0, 404);

    // FTS index is empty here, so this exercises the LIKE fallback
    let (_, found) = raw(&s, Method::GET, "/api/v1/search?q=lunch&accountId=acct-1", k, None).await;
    assert_eq!(found["data"].as_array().unwrap().len(), 1);
    assert_eq!(found["data"][0]["id"], "e2");
    assert_eq!(raw(&s, Method::GET, "/api/v1/search", k, None).await.0, 400);

    let res = build_app(s.clone())
        .oneshot(
            Request::builder()
                .uri("/api/v1/emails/e1/attachments/att1")
                .header("authorization", format!("Bearer {key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(res.into_body().collect().await.unwrap().to_bytes().as_ref(), b"hi");
}

#[tokio::test]
async fn docs_serve_scalar_and_spec() {
    let s = state();
    let (st, spec) = raw(&s, Method::GET, "/docs/openapi.json", None, None).await;
    assert_eq!(st, 200);
    assert_eq!(spec["openapi"], "3.1.0");
}

#[tokio::test]
async fn thread_scoped_to_account() {
    let s = state();
    {
        let conn = s.db.conn();
        conn.execute(
            "INSERT INTO accounts (id, email, name, provider_type) VALUES ('acct-b', 'b@example.com', 'B', 'imap')",
            [],
        )
        .unwrap();
        // Same message seen by two local accounts: sent copy and received copy
        for (id, acct, folder) in [("t-sent", ACCOUNT, "sent"), ("t-recv", "acct-b", "inbox")] {
            conn.execute(
                "INSERT INTO emails (id, account_id, message_id, thread_id, subject, received_at, folder)
                 VALUES (?, ?, '<m1@x>', '<m1@x>', 'Hi', 1700000000, ?)",
                (id, acct, folder),
            )
            .unwrap();
        }
    }
    let all = call(&s, Method::GET, "/emails/thread/%3Cm1%40x%3E", None).await;
    assert_eq!(all.as_array().unwrap().len(), 2);
    let scoped = call(&s, Method::GET, "/emails/thread/%3Cm1%40x%3E?accountId=acct-b", None).await;
    assert_eq!(scoped.as_array().unwrap().len(), 1);
    assert_eq!(scoped[0]["id"], "t-recv");
}

// ---------- Tracking ----------

async fn raw_get(state: &AppState, uri: &str) -> (u16, axum::http::HeaderMap, Vec<u8>) {
    let req = Request::builder().method(Method::GET).uri(uri).body(Body::empty()).unwrap();
    let res = build_app(state.clone()).oneshot(req).await.unwrap();
    let (status, headers) = (res.status().as_u16(), res.headers().clone());
    (status, headers, res.into_body().collect().await.unwrap().to_bytes().to_vec())
}

fn seed_tracking(state: &AppState, email_id: &str, age_secs: i64) {
    let conn = state.db.conn();
    conn.execute(
        "INSERT INTO email_tracking (id, token, account_id, email_id, subject, recipients, created_at)
         VALUES ('trk1', 'tok1', ?, ?, 'Hello', 'bob@example.com', unixepoch() - ?)",
        (ACCOUNT, email_id, age_secs),
    )
    .unwrap();
    conn.execute(
        "INSERT INTO tracking_links (id, tracking_id, url) VALUES ('lnk1', 'trk1', 'https://example.org/page?a=1')",
        [],
    )
    .unwrap();
}

fn event_count(state: &AppState, kind: &str) -> i64 {
    state
        .db
        .conn()
        .query_row("SELECT COUNT(*) FROM tracking_events WHERE type = ?", [kind], |r| r.get(0))
        .unwrap()
}

#[tokio::test]
async fn open_pixel_records_event_and_returns_gif() {
    let s = state();
    insert_email(&s, "sent1", "Hello", "sent");
    seed_tracking(&s, "sent1", 3600);

    let (status, headers, body) = raw_get(&s, "/t/o/tok1.gif").await;
    assert_eq!(status, 200);
    assert_eq!(headers["content-type"], "image/gif");
    assert!(headers["cache-control"].to_str().unwrap().contains("no-store"));
    assert_eq!(&body[..6], b"GIF89a");
    assert_eq!(event_count(&s, "open"), 1);

    // Unknown token still gets the GIF but records nothing
    let (status, _, body) = raw_get(&s, "/t/o/nope.gif").await;
    assert_eq!((status, &body[..3]), (200, &b"GIF"[..]));
    assert_eq!(event_count(&s, "open"), 1);
}

#[tokio::test]
async fn opens_right_after_sending_are_ignored() {
    let s = state();
    insert_email(&s, "sent1", "Hello", "sent");
    seed_tracking(&s, "sent1", 2);
    raw_get(&s, "/t/o/tok1.gif").await;
    assert_eq!(event_count(&s, "open"), 0);
}

#[tokio::test]
async fn click_redirects_only_to_stored_url() {
    let s = state();
    insert_email(&s, "sent1", "Hello", "sent");
    seed_tracking(&s, "sent1", 3600);

    let (status, headers, _) = raw_get(&s, "/t/c/lnk1").await;
    assert_eq!(status, 302);
    assert_eq!(headers["location"], "https://example.org/page?a=1");
    assert_eq!(event_count(&s, "click"), 1);

    // Not an open redirect: arbitrary tokens/URLs are rejected
    let (status, headers, _) = raw_get(&s, "/t/c/https%3A%2F%2Fevil.com").await;
    assert_eq!(status, 404);
    assert!(headers.get("location").is_none());
    assert_eq!(raw_get(&s, "/t/c/unknown").await.0, 404);
    assert_eq!(event_count(&s, "click"), 1);
}

#[tokio::test]
async fn sent_list_includes_tracking_summary() {
    let s = state();
    insert_email(&s, "sent1", "Hello", "sent");
    insert_email(&s, "sent2", "Untracked", "sent");
    seed_tracking(&s, "sent1", 3600);
    raw_get(&s, "/t/o/tok1.gif").await;
    raw_get(&s, "/t/o/tok1.gif").await;
    raw_get(&s, "/t/c/lnk1").await;

    let sent = call(&s, Method::GET, &format!("/emails/sent?accountId={ACCOUNT}"), None).await;
    let tracked = sent.as_array().unwrap().iter().find(|e| e["id"] == "sent1").unwrap();
    assert_eq!(tracked["tracking"]["opens"], 2);
    assert_eq!(tracked["tracking"]["clicks"], 1);
    assert!(tracked["tracking"]["lastOpenedAt"].is_i64());
    let plain = sent.as_array().unwrap().iter().find(|e| e["id"] == "sent2").unwrap();
    assert!(plain.get("tracking").is_none());

    let events = call(&s, Method::GET, "/emails/sent1/tracking", None).await;
    assert_eq!(events.as_array().unwrap().len(), 3);
    let one = call(&s, Method::GET, "/emails/sent1", None).await;
    assert_eq!(one["tracking"]["opens"], 2);
}

#[tokio::test]
async fn prepare_rewrites_body_and_keeps_local_copy() {
    use crate::providers::SendParams;
    use crate::services::{send::OutgoingEmail, tracking};
    std::env::set_var("PUBLIC_URL", "https://mail.example.com/");
    let s = state();
    let email = OutgoingEmail {
        account_id: ACCOUNT.into(),
        to: "bob@example.com".into(),
        subject: "Hi".into(),
        track_opens: true,
        track_links: true,
        ..Default::default()
    };
    let original = r#"<p><a href="https://example.org/x">x</a> <a href="mailto:a@b.c">m</a></p>"#;
    let mut params = SendParams {
        body: original.into(),
        ..Default::default()
    };
    let id = tracking::prepare(&s, &email, &mut params).expect("tracking enabled");
    assert_eq!(params.local_body.as_deref(), Some(original));
    assert!(params.body.contains("https://mail.example.com/t/c/"));
    assert!(!params.body.contains("https://example.org/x"));
    assert!(params.body.contains("mailto:a@b.c"));
    assert!(params.body.contains("https://mail.example.com/t/o/") && params.body.contains(".gif"));
    let links: i64 = s
        .db
        .conn()
        .query_row("SELECT COUNT(*) FROM tracking_links WHERE tracking_id = ?", [&id], |r| r.get(0))
        .unwrap();
    assert_eq!(links, 1);

    // Nothing enabled -> body untouched
    let off = OutgoingEmail { track_opens: false, track_links: false, ..email };
    let mut p2 = SendParams { body: original.into(), ..Default::default() };
    assert!(tracking::prepare(&s, &off, &mut p2).is_none());
    assert_eq!(p2.body, original);
}

async fn auth_call(state: &AppState, method: Method, uri: &str, body: Option<Value>, cookie: Option<&str>) -> (u16, Option<String>, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    let body = match body {
        Some(b) => {
            req = req.header("content-type", "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let res = build_app(state.clone()).oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status().as_u16();
    let set_cookie = res
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap().to_string());
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, set_cookie, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn app_login_flow() {
    let s = AppState { auth: true, ..state() };

    // Locked before setup; public routes stay open
    assert_eq!(auth_call(&s, Method::GET, "/auth/accounts", None, None).await.0, 401);
    assert_eq!(auth_call(&s, Method::GET, "/health", None, None).await.0, 200);
    let (_, _, st) = auth_call(&s, Method::GET, "/session/status", None, None).await;
    assert_eq!(st["setupRequired"], true);

    // Setup rejects short passwords, then signs in
    let (_, _, r) = auth_call(&s, Method::POST, "/session/setup", Some(json!({"username":"dustin","password":"short"})), None).await;
    assert_eq!(r["success"], false);
    let (_, cookie, r) = auth_call(&s, Method::POST, "/session/setup", Some(json!({"username":"dustin","password":"correct horse"})), None).await;
    assert_eq!(r["success"], true);
    let cookie = cookie.unwrap();
    assert_eq!(auth_call(&s, Method::GET, "/auth/accounts", None, Some(&cookie)).await.0, 200);

    // Second setup refused
    let (_, _, r) = auth_call(&s, Method::POST, "/session/setup", Some(json!({"username":"evil","password":"whatever123"})), None).await;
    assert_eq!(r["success"], false);

    // Wrong password fails; right one (any case username) works
    let (_, c, r) = auth_call(&s, Method::POST, "/session/login", Some(json!({"username":"dustin","password":"nope nope"})), None).await;
    assert!(c.is_none());
    assert_eq!(r["success"], false);
    let (_, c, r) = auth_call(&s, Method::POST, "/session/login", Some(json!({"username":"Dustin","password":"correct horse"})), None).await;
    assert_eq!(r["success"], true);
    let c2 = c.unwrap();

    // Logout invalidates that session only
    auth_call(&s, Method::POST, "/session/logout", None, Some(&c2)).await;
    assert_eq!(auth_call(&s, Method::GET, "/auth/accounts", None, Some(&c2)).await.0, 401);
    assert_eq!(auth_call(&s, Method::GET, "/auth/accounts", None, Some(&cookie)).await.0, 200);

    // Change password
    let (_, _, r) = auth_call(&s, Method::POST, "/session/password", Some(json!({"currentPassword":"wrong one","newPassword":"new password 1"})), Some(&cookie)).await;
    assert_eq!(r["success"], false);
    let (_, _, r) = auth_call(&s, Method::POST, "/session/password", Some(json!({"currentPassword":"correct horse","newPassword":"new password 1"})), Some(&cookie)).await;
    assert_eq!(r["success"], true);
    let (_, _, r) = auth_call(&s, Method::POST, "/session/login", Some(json!({"username":"dustin","password":"new password 1"})), None).await;
    assert_eq!(r["success"], true);
}
