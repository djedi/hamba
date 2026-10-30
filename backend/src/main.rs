mod db;
mod emails_db;
mod jobs;
mod openapi;
mod providers;
mod realtime;
mod routes;
mod services;

use axum::extract::{State, WebSocketUpgrade};
use axum::http::{header, HeaderValue, Method};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub realtime: realtime::Realtime,
}

async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| state.realtime.clone().handle_socket(socket))
}

fn init_logging() {
    let filter = EnvFilter::new(std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into()));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        builder.json().init();
    } else {
        builder.init();
    }
}

/// Origin of the web frontend (CORS + post-OAuth redirect). Set by `make up` for random dev ports.
pub fn frontend_url() -> String {
    // No trailing slash: browsers send Origin without one, and redirects append "/?..."
    std::env::var("FRONTEND_URL")
        .ok()
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "http://localhost:8878".into())
}

/// Build the full router (shared by `main` and the HTTP tests)
pub fn build_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            HeaderValue::from_str(&frontend_url()).unwrap_or(HeaderValue::from_static("http://localhost:8878")),
        )
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    Router::new()
        .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
        .route("/ws", get(ws_handler))
        // IMAP IDLE status endpoint
        .route(
            "/realtime/status",
            get(|State(s): State<AppState>| async move {
                Json(json!({ "idle": services::imap_idle::get_idle_status(&s) }))
            }),
        )
        .nest("/snippets", routes::snippets::router())
        .nest("/signatures", routes::signatures::router())
        .nest("/labels", routes::labels::router())
        .nest("/contacts", routes::contacts::router())
        .nest("/drafts", routes::drafts::router())
        .nest("/emails", routes::emails::router())
        .nest("/ai", routes::ai::router())
        .nest("/auth", routes::auth::router())
        .merge(services::metrics::router())
        .merge(openapi::router())
        .layer(axum::middleware::from_fn(services::metrics::logging_middleware))
        .layer(cors)
        .with_state(state)
}

#[cfg(test)]
mod api_tests;

#[tokio::main]
async fn main() {
    // Load the repo-root .env (the TS backend used `bun --env-file=../.env`); real env vars win
    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::dotenv();
    init_logging();

    // Support DATABASE_PATH env var for Docker / Tauri deployments
    let db_path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| "hamba.db".into());
    let db = db::Db::open(&db_path).expect("Failed to open database");

    // `hamba-backend migrate [status]`: migrations already ran in `Db::open`, so just report
    if std::env::args().nth(1).as_deref() == Some("migrate") {
        for (version, name, applied_at) in db.migration_status().expect("Failed to read migrations") {
            let status = applied_at.map_or("pending".to_string(), |t| format!("applied at {t}"));
            println!("{version:03}_{name}: {status}");
        }
        return;
    }

    let state = AppState {
        db,
        realtime: realtime::Realtime::default(),
    };

    let app = build_app(state.clone());

    // Start IMAP IDLE connections for all IMAP accounts
    services::imap_idle::start_all_idle(state.clone());
    jobs::start(state.clone());
    services::send::start_processors(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8877);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("Failed to bind port");
    tracing::info!(port, url = format!("http://localhost:{port}"), "Hamba API started");
    axum::serve(listener, app).await.expect("Server error");
}
