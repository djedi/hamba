use super::*;
use crate::{db, AppState};
use axum::extract::{Path, State};
use axum::routing::{delete, get, post};
use axum::Router;
use regex::Regex;
use rusqlite::Connection;
use std::collections::HashSet;
use std::sync::LazyLock;

static NAMED_ADDR_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(.+?)\s*<([^>]+)>$").unwrap());

const UPSERT_SQL: &str = "INSERT INTO contacts (id, account_id, email, name, last_contacted, contact_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(account_id, email) DO UPDATE SET
      name = COALESCE(excluded.name, contacts.name),
      last_contacted = MAX(excluded.last_contacted, contacts.last_contacted),
      contact_count = contacts.contact_count + 1";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/search", get(search))
        .route("/populate", post(populate))
        .route("/{id}", delete(remove))
}

/// Parse comma-separated addresses like `name@email.com` or `Name <name@email.com>`
pub fn parse_email_addresses(addresses: Option<&str>) -> Vec<(String, Option<String>)> {
    let Some(addresses) = addresses else { return vec![] };
    addresses
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|addr| {
            if let Some(c) = NAMED_ADDR_RE.captures(addr) {
                let name = c[1].trim();
                Some((c[2].to_lowercase(), (!name.is_empty()).then(|| name.to_string())))
            } else {
                let email = addr.to_lowercase();
                email.contains('@').then_some((email, None))
            }
        })
        .collect()
}

fn upsert(
    conn: &Connection,
    account_id: &str,
    email: &str,
    name: Option<&str>,
    timestamp: i64,
) -> rusqlite::Result<usize> {
    conn.prepare_cached(UPSERT_SQL)?
        .execute((uuid::Uuid::new_v4().to_string(), account_id, email, name, timestamp))
}

/// Record contacts for recipients of an outgoing email
#[allow(dead_code)]
pub fn add_contact_from_send(conn: &Connection, account_id: &str, to: &str, cc: Option<&str>, bcc: Option<&str>) {
    let now = db::now();
    for list in [Some(to), cc, bcc] {
        for (email, name) in parse_email_addresses(list) {
            let _ = upsert(conn, account_id, &email, name.as_deref(), now);
        }
    }
}

/// Record the sender of an incoming email as a contact
#[allow(dead_code)]
pub fn add_contact_from_receive(
    conn: &Connection,
    account_id: &str,
    from_email: &str,
    from_name: Option<&str>,
    received_at: i64,
) {
    if from_email.contains('@') {
        let _ = upsert(conn, account_id, &from_email.to_lowercase(), from_name, received_at);
    }
}

fn populate_contacts_from_emails(conn: &Connection, account_id: &str) -> rusqlite::Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT from_email, from_name, to_addresses, cc_addresses, received_at FROM emails WHERE account_id = ?",
    )?;
    let rows = stmt
        .query_map([account_id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut count = 0;
    let mut seen = HashSet::new();
    for (from_email, from_name, to, cc, received_at) in rows {
        let mut contacts: Vec<(String, Option<String>)> = Vec::new();
        if let Some(from) = from_email.filter(|f| !f.is_empty()) {
            contacts.push((from.to_lowercase(), from_name.filter(|n| !n.is_empty())));
        }
        contacts.extend(parse_email_addresses(to.as_deref()));
        contacts.extend(parse_email_addresses(cc.as_deref()));

        for (email, name) in contacts {
            if !email.contains('@') || !seen.insert(email.clone()) {
                continue;
            }
            if upsert(conn, account_id, &email, name.as_deref(), received_at).is_ok() {
                count += 1;
            }
        }
    }
    Ok(count)
}

const LIST_SQL: &str = "SELECT * FROM contacts WHERE account_id = ? ORDER BY last_contacted DESC, contact_count DESC";

async fn list(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    match db::query_all(&s.db.conn(), LIST_SQL, [account_id]) {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn search(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return ok(json!({ "error": "accountId required" }));
    };
    let limit = parse_i64(&q, "limit", 10);
    let conn = s.db.conn();
    let result = match q.get("q").filter(|q| !q.is_empty()) {
        // Return recent contacts if no query
        None => db::query_all(&conn, LIST_SQL, [account_id])
            .map(|rows| rows.into_iter().take(limit.max(0) as usize).collect()),
        Some(query) => {
            let pattern = format!("%{query}%");
            db::query_all(
                &conn,
                "SELECT * FROM contacts WHERE account_id = ? AND (email LIKE ? OR name LIKE ?)
                 ORDER BY last_contacted DESC, contact_count DESC LIMIT ?",
                (account_id, &pattern, &pattern, limit),
            )
        }
    };
    match result {
        Ok(rows) => ok(json!(rows)),
        Err(e) => fail(e),
    }
}

async fn populate(State(s): State<AppState>, Query(q): QueryMap) -> JsonResult {
    let Some(account_id) = q.get("accountId") else {
        return fail("accountId required");
    };
    let conn = s.db.conn();
    if db::query_one(&conn, "SELECT id FROM accounts WHERE id = ?", [account_id])
        .ok()
        .flatten()
        .is_none()
    {
        return fail("Account not found");
    }
    match populate_contacts_from_emails(&conn, account_id) {
        Ok(count) => ok(json!({ "success": true, "count": count })),
        Err(e) => {
            tracing::error!(error = %e, "Error populating contacts");
            fail("Failed to populate contacts")
        }
    }
}

async fn create(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let (Some(account_id), Some(email)) = (str_field(&body, "accountId"), str_field(&body, "email")) else {
        return fail("accountId and email required");
    };
    let id = uuid::Uuid::new_v4().to_string();
    match s.db.conn().prepare_cached(UPSERT_SQL).and_then(|mut stmt| {
        stmt.execute((
            &id,
            account_id,
            email.to_lowercase(),
            str_field(&body, "name"),
            db::now(),
        ))
    }) {
        Ok(_) => ok(json!({ "success": true, "id": id })),
        Err(e) => {
            tracing::error!(error = %e, "Error adding contact");
            fail("Failed to add contact")
        }
    }
}

async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> JsonResult {
    match s.db.conn().execute("DELETE FROM contacts WHERE id = ?", [&id]) {
        Ok(_) => ok(json!({ "success": true })),
        Err(e) => {
            tracing::error!(error = %e, "Error deleting contact");
            fail("Failed to delete contact")
        }
    }
}
