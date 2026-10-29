//! Port of backend/src/routes/ai.ts — AI features backed by the Anthropic Messages API.

use super::*;
use crate::{db, AppState};
use axum::extract::State;
use axum::routing::{get, post};
use axum::Router;
use regex::Regex;
use std::sync::LazyLock;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// The TS used `claude-sonnet-4-20250514`, which is retired.
const MODEL: &str = "claude-sonnet-5-5";

const NOT_CONFIGURED: &str = "AI is not configured. Please add your ANTHROPIC_API_KEY to the .env file.";

const COMPOSE_SYSTEM: &str = "You are an expert email writer. Generate professional, clear, and concise email content based on the user's request.

Guidelines:
- Write in a professional but friendly tone unless otherwise specified
- Keep emails concise and to the point
- Use appropriate greeting and sign-off based on context
- Do not include the subject line in your response - only the email body
- Output plain text (no markdown formatting)
- If this is a reply, maintain appropriate context from the original email";

const SUMMARIZE_SYSTEM: &str = "You are a helpful assistant that summarizes emails concisely.

Guidelines:
- Provide a 2-3 sentence summary capturing the key points
- Focus on: what the email is about, what action (if any) is requested, and any important details
- Use clear, direct language
- Do not include greetings or sign-offs in the summary
- If the email is a newsletter or promotional, note that briefly";

const SMART_REPLIES_SYSTEM: &str = r#"You are a helpful assistant that generates smart reply suggestions for emails.

Generate exactly 3 short, contextually appropriate reply options. Each reply should be:
- Brief (1-2 sentences max)
- Different in tone/purpose: one positive/agreeable, one neutral/informative, one that asks a follow-up question or declines
- Natural and professional
- Ready to send as-is (no placeholders like [name] or [date])

Output ONLY a JSON array with exactly 3 strings, nothing else.
Example: ["Sounds great, I'm in!", "Thanks for letting me know.", "Can we discuss this further next week?"]"#;

static STYLE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap());
static SCRIPT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap());
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]+>").unwrap());
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static JSON_ARRAY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)\[.*\]").unwrap());

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/compose", post(compose))
        .route("/summarize", post(summarize))
        .route("/smart-replies", post(smart_replies))
}

fn api_key() -> Option<String> {
    std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty())
}

async fn status() -> JsonResult {
    ok(json!({ "configured": api_key().is_some() }))
}

// ---------- Anthropic client ----------

enum AiError {
    NotConfigured,
    Status(u16, String),
    Other(String),
}

/// Map errors to the same user-facing messages as the TS `catch` blocks.
fn ai_error_message(e: &AiError, fallback: &str) -> String {
    match e {
        AiError::NotConfigured => NOT_CONFIGURED.into(),
        AiError::Status(401, _) => "Invalid API key. Please check your ANTHROPIC_API_KEY.".into(),
        AiError::Status(429, _) => "Rate limit exceeded. Please try again later.".into(),
        AiError::Status(code, body) => format!("{code} {body}"),
        AiError::Other(m) if m.is_empty() => fallback.into(),
        AiError::Other(m) => m.clone(),
    }
}

fn build_request(system: &str, user: &str, max_tokens: u32) -> Value {
    json!({
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    })
}

/// First text block of a Messages API response.
fn first_text(resp: &Value) -> Option<String> {
    resp.get("content")?
        .as_array()?
        .iter()
        .find(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|b| b.get("text").and_then(Value::as_str))
        .map(str::to_string)
}

/// Returns Ok(Some(text)) / Ok(None) when the response has no text block.
async fn call_claude(system: &str, user: &str, max_tokens: u32) -> Result<Option<String>, AiError> {
    let key = api_key().ok_or(AiError::NotConfigured)?;
    let resp = HTTP
        .post(ANTHROPIC_URL)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&build_request(system, user, max_tokens))
        .send()
        .await
        .map_err(|e| AiError::Other(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AiError::Status(status.as_u16(), body));
    }
    let body: Value = resp.json().await.map_err(|e| AiError::Other(e.to_string()))?;
    Ok(first_text(&body))
}

// ---------- prompt helpers ----------

fn compose_user_message(prompt: &str, context: Option<&Value>) -> String {
    let Some(ctx) = context else { return prompt.to_string() };
    let Some(reply_to) = ctx.get("replyTo").filter(|v| v.is_object()) else {
        return prompt.to_string();
    };
    let f = |k: &str| match reply_to.get(k) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => "undefined".into(),
        Some(v) => v.to_string(),
    };
    let mode = ctx.get("mode").and_then(Value::as_str);
    let verb = if matches!(mode, Some("reply") | Some("replyAll")) {
        "a reply to"
    } else {
        "an email based on"
    };
    format!(
        "{prompt}\n\n--- Original email context ---\nFrom: {}\nSubject: {}\nBody: {}\n---\n\nPlease write {verb} the above context, following the user's instructions.",
        f("from"),
        f("subject"),
        f("body"),
    )
}

/// Plain-text body, falling back to stripped HTML (same regexes as the TS).
fn email_body_text(email: &Value) -> String {
    let text = email.get("body_text").and_then(Value::as_str).unwrap_or("");
    if !text.is_empty() {
        return text.to_string();
    }
    match email.get("body_html").and_then(Value::as_str) {
        Some(html) if !html.is_empty() => {
            let s = STYLE_RE.replace_all(html, "");
            let s = SCRIPT_RE.replace_all(&s, "");
            let s = TAG_RE.replace_all(&s, " ");
            WS_RE.replace_all(&s, " ").trim().to_string()
        }
        _ => String::new(),
    }
}

fn truncate(text: String, max: usize) -> String {
    if text.chars().count() > max {
        format!("{}...", text.chars().take(max).collect::<String>())
    } else {
        text
    }
}

fn email_user_message(lead: &str, email: &Value, body: &str) -> String {
    let s = |k: &str| email.get(k).and_then(Value::as_str).filter(|v| !v.is_empty());
    let from = s("from_name").or_else(|| s("from_email")).unwrap_or("undefined");
    let subject = s("subject").unwrap_or("(no subject)");
    format!("{lead}\n\nFrom: {from}\nSubject: {subject}\n\n{body}")
}

fn parse_smart_replies(text: &str) -> Option<Vec<String>> {
    let m = JSON_ARRAY_RE.find(text)?;
    let arr: Vec<Value> = serde_json::from_str::<Value>(m.as_str()).ok()?.as_array()?.clone();
    if arr.is_empty() {
        return None;
    }
    Some(
        arr.into_iter()
            .take(3)
            .filter_map(|v| v.as_str().filter(|s| !s.trim().is_empty()).map(str::to_string))
            .collect(),
    )
}

fn load_email(s: &AppState, id: &str) -> Option<Value> {
    db::query_one(&s.db.conn(), "SELECT * FROM emails WHERE id = ?", [id])
        .ok()
        .flatten()
}

// ---------- handlers ----------

async fn compose(Json(body): Json<Value>) -> JsonResult {
    let Some(prompt) = str_field(&body, "prompt") else {
        return fail("Prompt is required");
    };
    let user = compose_user_message(prompt, body.get("context"));
    match call_claude(COMPOSE_SYSTEM, &user, 1024).await {
        Ok(Some(text)) => ok(json!({ "success": true, "content": text })),
        Ok(None) => fail("No text content in response"),
        Err(e) => {
            let msg = ai_error_message(&e, "Failed to generate email");
            tracing::error!(error = %msg, "AI compose error");
            fail(msg)
        }
    }
}

async fn summarize(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let Some(email_id) = str_field(&body, "emailId") else {
        return fail("Email ID is required");
    };
    let regenerate = body.get("regenerate").and_then(Value::as_bool).unwrap_or(false);
    let Some(email) = load_email(&s, email_id) else {
        return fail("Email not found");
    };
    if let Some(summary) = email.get("summary").and_then(Value::as_str).filter(|v| !v.is_empty()) {
        if !regenerate {
            return ok(json!({
                "success": true,
                "summary": summary,
                "cached": true,
                "generated_at": email.get("summary_generated_at").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    let text = email_body_text(&email);
    if text.chars().count() < 50 {
        return fail("Email is too short to summarize");
    }
    let user = email_user_message("Summarize this email:", &email, &truncate(text, 8000));
    match call_claude(SUMMARIZE_SYSTEM, &user, 256).await {
        Ok(Some(text)) => {
            let summary = text.trim().to_string();
            if let Err(e) = s.db.conn().execute(
                "UPDATE emails SET summary = ?, summary_generated_at = unixepoch() WHERE id = ?",
                (&summary, email_id),
            ) {
                return fail(e);
            }
            ok(json!({ "success": true, "summary": summary, "cached": false, "generated_at": db::now() }))
        }
        Ok(None) => fail("No text content in response"),
        Err(e) => {
            let msg = ai_error_message(&e, "Failed to summarize email");
            tracing::error!(error = %msg, "AI summarize error");
            fail(msg)
        }
    }
}

async fn smart_replies(State(s): State<AppState>, Json(body): Json<Value>) -> JsonResult {
    let Some(email_id) = str_field(&body, "emailId") else {
        return fail("Email ID is required");
    };
    let Some(email) = load_email(&s, email_id) else {
        return fail("Email not found");
    };
    let text = email_body_text(&email);
    if text.chars().count() < 10 {
        return fail("Email is too short to generate replies");
    }
    let user = email_user_message(
        "Generate 3 smart reply suggestions for this email:",
        &email,
        &truncate(text, 4000),
    );
    match call_claude(SMART_REPLIES_SYSTEM, &user, 256).await {
        Ok(Some(text)) => match parse_smart_replies(&text) {
            Some(replies) => ok(json!({ "success": true, "replies": replies })),
            None => {
                tracing::error!(response = %text, "Failed to parse smart replies response");
                fail("Failed to parse AI response")
            }
        },
        Ok(None) => fail("No text content in response"),
        Err(e) => {
            let msg = ai_error_message(&e, "Failed to generate smart replies");
            tracing::error!(error = %msg, "AI smart replies error");
            fail(msg)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_message_without_context_is_prompt() {
        assert_eq!(compose_user_message("hi", None), "hi");
        assert_eq!(compose_user_message("hi", Some(&json!({ "mode": "new" }))), "hi");
    }

    #[test]
    fn compose_message_with_reply_context() {
        let ctx = json!({ "replyTo": { "subject": "S", "from": "a@b", "body": "B" }, "mode": "replyAll" });
        let m = compose_user_message("decline", Some(&ctx));
        assert_eq!(
            m,
            "decline\n\n--- Original email context ---\nFrom: a@b\nSubject: S\nBody: B\n---\n\nPlease write a reply to the above context, following the user's instructions."
        );
        let ctx = json!({ "replyTo": { "subject": "S", "from": "a@b", "body": "B" }, "mode": "forward" });
        assert!(compose_user_message("x", Some(&ctx)).contains("Please write an email based on the above"));
    }

    #[test]
    fn body_text_strips_html() {
        let e =
            json!({ "body_text": "", "body_html": "<style>p{}</style><p>Hello</p>\n<script>x()</script><b>world</b>" });
        assert_eq!(email_body_text(&e), "Hello world");
        assert_eq!(email_body_text(&json!({ "body_text": "plain" })), "plain");
    }

    #[test]
    fn truncates_with_ellipsis() {
        assert_eq!(truncate("abcdef".into(), 3), "abc...");
        assert_eq!(truncate("abc".into(), 3), "abc");
    }

    #[test]
    fn email_message_uses_fallbacks() {
        let e = json!({ "from_name": null, "from_email": "x@y", "subject": "" });
        assert_eq!(
            email_user_message("Summarize this email:", &e, "B"),
            "Summarize this email:\n\nFrom: x@y\nSubject: (no subject)\n\nB"
        );
    }

    #[test]
    fn parses_smart_replies() {
        assert_eq!(
            parse_smart_replies("```json\n[\"a\", \" \", \"b\", \"c\", \"d\"]\n```").unwrap(),
            vec!["a", "b"]
        );
        assert!(parse_smart_replies("nothing").is_none());
        assert!(parse_smart_replies("[]").is_none());
    }

    #[test]
    fn request_and_response_shapes() {
        let r = build_request("sys", "u", 256);
        assert_eq!(r["max_tokens"], 256);
        assert_eq!(r["messages"][0]["content"], "u");
        let resp = json!({ "content": [{ "type": "thinking" }, { "type": "text", "text": "hi" }] });
        assert_eq!(first_text(&resp).as_deref(), Some("hi"));
        assert_eq!(
            ai_error_message(&AiError::Status(429, String::new()), "f"),
            "Rate limit exceeded. Please try again later."
        );
        assert_eq!(ai_error_message(&AiError::Other(String::new()), "f"), "f");
    }
}
