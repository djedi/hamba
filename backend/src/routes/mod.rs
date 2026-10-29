pub mod ai;
pub mod auth;
pub mod contacts;
pub mod drafts;
pub mod emails;
pub mod labels;
pub mod signatures;
pub mod snippets;

use axum::Json;
use serde_json::{json, Value};
use std::collections::HashMap;

pub use axum::extract::Query;
pub type QueryMap = Query<HashMap<String, String>>;
pub type JsonResult = Json<Value>;

pub fn ok(v: Value) -> JsonResult {
    Json(v)
}

/// `{ success: false, error }` in the same shape the TypeScript routes returned
pub fn fail(msg: impl std::fmt::Display) -> JsonResult {
    Json(json!({ "success": false, "error": msg.to_string() }))
}

pub fn opt(v: Option<Value>) -> JsonResult {
    Json(v.unwrap_or(Value::Null))
}

/// Read a non-empty string field from a JSON body
pub fn str_field<'a>(body: &'a Value, key: &str) -> Option<&'a str> {
    body.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

pub fn parse_i64(q: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    q.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

pub fn is_unique_violation(e: &rusqlite::Error) -> bool {
    e.to_string().contains("UNIQUE constraint failed")
}
