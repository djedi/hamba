//! Port of backend/src/services/logger.ts (metrics + error tracking) and
//! backend/src/services/logging-middleware.ts (request logging + monitoring endpoints).

use crate::AppState;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures::FutureExt;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::panic::AssertUnwindSafe;
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAX_ERROR_BUFFER: usize = 100;
const MAX_METRICS_BUFFER: usize = 1000;

static START: LazyLock<Instant> = LazyLock::new(Instant::now);

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceMetric {
    pub name: String,
    pub duration: f64,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregation {
    pub count: u64,
    pub total_duration: f64,
    pub min_duration: f64,
    pub max_duration: f64,
    pub avg_duration: f64,
}

#[derive(Debug, Clone)]
pub struct ErrorRecord {
    pub timestamp: String,
    pub name: String,
    pub message: String,
    pub context: Value,
    pub fingerprint: String,
}

#[derive(Default)]
pub struct Metrics {
    recent: VecDeque<PerformanceMetric>,
    aggregated: HashMap<String, Aggregation>,
    errors: VecDeque<ErrorRecord>,
}

impl Metrics {
    pub fn timing(&mut self, name: &str, duration: f64, tags: Option<BTreeMap<String, String>>) {
        if duration > 1000.0 {
            tracing::warn!(duration, tags = ?tags, "Slow operation: {name}");
        }
        self.recent.push_back(PerformanceMetric {
            name: name.into(),
            duration,
            timestamp: iso_now(),
            tags,
        });
        if self.recent.len() > MAX_METRICS_BUFFER {
            self.recent.pop_front();
        }
        let a = self.aggregated.entry(name.to_string()).or_insert(Aggregation {
            count: 0,
            total_duration: 0.0,
            min_duration: duration,
            max_duration: duration,
            avg_duration: 0.0,
        });
        a.count += 1;
        a.total_duration += duration;
        a.min_duration = a.min_duration.min(duration);
        a.max_duration = a.max_duration.max(duration);
        a.avg_duration = a.total_duration / a.count as f64;
    }

    #[allow(dead_code)]
    pub fn increment(&mut self, name: &str, value: u64, tags: Option<&BTreeMap<String, String>>) {
        let key = match tags {
            Some(t) => format!("{name}:{}", serde_json::to_string(t).unwrap_or_default()),
            None => name.to_string(),
        };
        self.aggregated.entry(key).or_default().count += value;
    }

    pub fn aggregated(&self) -> Map<String, Value> {
        self.aggregated.iter().map(|(k, v)| (k.clone(), json!(v))).collect()
    }

    pub fn recent(&self, limit: usize) -> Vec<PerformanceMetric> {
        self.recent
            .iter()
            .skip(self.recent.len().saturating_sub(limit))
            .cloned()
            .collect()
    }

    pub fn track_error(&mut self, name: &str, message: &str, context: Value) {
        self.errors.push_back(ErrorRecord {
            timestamp: iso_now(),
            name: name.into(),
            message: message.into(),
            context,
            fingerprint: format!("{name}:{message}"),
        });
        if self.errors.len() > MAX_ERROR_BUFFER {
            self.errors.pop_front();
        }
    }

    pub fn recent_errors(&self, limit: usize) -> Vec<ErrorRecord> {
        self.errors
            .iter()
            .skip(self.errors.len().saturating_sub(limit))
            .cloned()
            .collect()
    }

    pub fn error_counts(&self) -> Map<String, Value> {
        let mut counts: BTreeMap<String, u64> = BTreeMap::new();
        for e in &self.errors {
            *counts.entry(e.fingerprint.clone()).or_default() += 1;
        }
        counts.into_iter().map(|(k, v)| (k, json!(v))).collect()
    }
}

static GLOBAL: LazyLock<Mutex<Metrics>> = LazyLock::new(|| Mutex::new(Metrics::default()));

fn global() -> std::sync::MutexGuard<'static, Metrics> {
    GLOBAL.lock().unwrap_or_else(|p| p.into_inner())
}

/// Record a timing metric (ms) in the global store.
pub fn timing(name: &str, duration_ms: f64, tags: Option<BTreeMap<String, String>>) {
    global().timing(name, duration_ms, tags);
}

/// Increment a counter metric in the global store.
#[allow(dead_code)]
pub fn increment(name: &str, value: u64, tags: Option<&BTreeMap<String, String>>) {
    global().increment(name, value, tags);
}

/// Log an error and add it to the /errors/recent ring buffer.
#[allow(dead_code)] // used by other modules once wired
pub fn record_error(msg: &str, context: Value) {
    tracing::error!(context = %context, "{msg}");
    global().track_error("Error", msg, context);
}

// ---------- time helpers ----------

fn iso_now() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    iso_from_millis(d.as_millis() as i64)
}

/// Format epoch millis like JS `Date.toISOString()`.
fn iso_from_millis(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

fn to_base36(mut n: u128) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

/// `req_<base36 ms>_<6 random base36 chars>`, matching the TS generateRequestId.
pub fn generate_request_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let rand = to_base36(uuid::Uuid::new_v4().as_u128());
    format!("req_{}_{}", to_base36(ms), &rand[..6.min(rand.len())])
}

// ---------- middleware ----------

/// Request logging middleware. Attach with `axum::middleware::from_fn(metrics::logging_middleware)`.
pub async fn logging_middleware(req: Request, next: Next) -> Response {
    LazyLock::force(&START);
    let request_id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(generate_request_id);
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let user_agent = req
        .headers()
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    tracing::debug!(request_id, method, path, user_agent, "Request received");

    let start = Instant::now();
    let response = match AssertUnwindSafe(next.run(req)).catch_unwind().await {
        Ok(r) => r,
        Err(panic) => {
            let msg = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic".into());
            let ctx = json!({ "requestId": request_id, "method": method, "path": path });
            tracing::error!(context = %ctx, error = %msg, "Unhandled error in request");
            global().track_error("Error", &msg, ctx);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Internal server error", "requestId": request_id })),
            )
                .into_response()
        }
    };
    let duration = start.elapsed().as_secs_f64() * 1000.0;
    let status = response.status().as_u16();

    let tags = BTreeMap::from([
        ("method".to_string(), method.clone()),
        ("path".to_string(), path.clone()),
        ("status".to_string(), status.to_string()),
    ]);
    timing("http.request", duration, Some(tags));

    let ms = duration.round() as u64;
    if status >= 500 {
        tracing::error!(
            request_id,
            method,
            path,
            status,
            duration = ms,
            "Request completed with error"
        );
    } else if status >= 400 {
        tracing::warn!(
            request_id,
            method,
            path,
            status,
            duration = ms,
            "Request completed with client error"
        );
    } else if duration > 1000.0 {
        tracing::warn!(request_id, method, path, status, duration = ms, "Slow request");
    } else {
        tracing::info!(request_id, method, path, status, duration = ms, "Request completed");
    }
    response
}

// ---------- endpoints ----------

pub fn router() -> Router<AppState> {
    LazyLock::force(&START);
    Router::new()
        .route("/metrics", get(metrics_handler))
        .route("/health/detailed", get(health_detailed))
        .route("/errors/recent", get(errors_recent))
}

async fn metrics_handler() -> Json<Value> {
    let m = global();
    Json(json!({ "timestamp": iso_now(), "aggregated": m.aggregated(), "recent": m.recent(50) }))
}

fn health_detailed_json(m: &Metrics) -> Value {
    let http = m.aggregated.get("http.request").cloned().unwrap_or_default();
    let rss = memory_stats::memory_stats().map(|s| s.physical_mem).unwrap_or(0);
    json!({
        "status": "ok",
        "timestamp": iso_now(),
        "uptime": START.elapsed().as_secs_f64(),
        // Shape of Node's process.memoryUsage(); only rss is meaningful outside a JS heap.
        "memory": { "rss": rss, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 },
        "metrics": {
            "totalRequests": http.count,
            "avgResponseTime": http.avg_duration,
            "maxResponseTime": http.max_duration,
        },
        "errors": { "recentCount": m.recent_errors(100).len(), "byType": m.error_counts() },
    })
}

async fn health_detailed() -> Json<Value> {
    Json(health_detailed_json(&global()))
}

fn errors_json(m: &Metrics) -> Value {
    let errors: Vec<Value> = m
        .recent_errors(50)
        .into_iter()
        .map(|e| {
            let mut o = json!({ "timestamp": e.timestamp, "error": e.name, "message": e.message });
            if !e.context.is_null() {
                o["context"] = e.context;
            }
            o
        })
        .collect();
    json!({ "count": errors.len(), "errors": errors })
}

async fn errors_recent() -> Json<Value> {
    Json(errors_json(&global()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_timings() {
        let mut m = Metrics::default();
        m.timing("op", 10.0, None);
        m.timing("op", 30.0, None);
        m.timing("op", 20.0, None);
        let a = &m.aggregated["op"];
        assert_eq!(a.count, 3);
        assert_eq!(a.total_duration, 60.0);
        assert_eq!(a.min_duration, 10.0);
        assert_eq!(a.max_duration, 30.0);
        assert_eq!(a.avg_duration, 20.0);
        let j = m.aggregated();
        assert_eq!(j["op"]["avgDuration"], 20.0);
        assert_eq!(j["op"]["totalDuration"], 60.0);
    }

    #[test]
    fn recent_buffer_is_bounded() {
        let mut m = Metrics::default();
        for i in 0..(MAX_METRICS_BUFFER + 5) {
            m.timing("x", i as f64, None);
        }
        assert_eq!(m.recent.len(), MAX_METRICS_BUFFER);
        let last = m.recent(2);
        assert_eq!(last.len(), 2);
        assert_eq!(last[1].duration, (MAX_METRICS_BUFFER + 4) as f64);
    }

    #[test]
    fn increment_uses_tag_key() {
        let mut m = Metrics::default();
        let tags = BTreeMap::from([("a".to_string(), "b".to_string())]);
        m.increment("c", 2, Some(&tags));
        m.increment("c", 1, Some(&tags));
        m.increment("c", 1, None);
        assert_eq!(m.aggregated[r#"c:{"a":"b"}"#].count, 3);
        assert_eq!(m.aggregated["c"].count, 1);
    }

    #[test]
    fn errors_ring_and_counts() {
        let mut m = Metrics::default();
        for i in 0..(MAX_ERROR_BUFFER + 3) {
            m.track_error("Error", if i % 2 == 0 { "even" } else { "odd" }, json!({ "i": i }));
        }
        assert_eq!(m.errors.len(), MAX_ERROR_BUFFER);
        let j = errors_json(&m);
        assert_eq!(j["count"], 50);
        assert_eq!(j["errors"][49]["context"]["i"], MAX_ERROR_BUFFER + 2);
        let counts = m.error_counts();
        assert_eq!(
            counts["Error:even"].as_u64().unwrap() + counts["Error:odd"].as_u64().unwrap(),
            100
        );
    }

    #[test]
    fn health_shape() {
        let mut m = Metrics::default();
        m.timing("http.request", 5.0, None);
        m.timing("http.request", 15.0, None);
        let h = health_detailed_json(&m);
        assert_eq!(h["status"], "ok");
        assert_eq!(h["metrics"]["totalRequests"], 2);
        assert_eq!(h["metrics"]["avgResponseTime"], 10.0);
        assert_eq!(h["metrics"]["maxResponseTime"], 15.0);
        assert_eq!(h["errors"]["recentCount"], 0);
    }

    #[test]
    fn iso_and_ids() {
        assert_eq!(iso_from_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_millis(1_709_251_199_123), "2024-02-29T23:59:59.123Z");
        let id = generate_request_id();
        assert!(id.starts_with("req_"));
        assert_eq!(id.rsplit('_').next().unwrap().len(), 6);
    }
}
