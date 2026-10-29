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
