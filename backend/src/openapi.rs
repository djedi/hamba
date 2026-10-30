//! API docs: Scalar at `/docs`, OpenAPI 3.1 spec for the public `/api/v1` at `/docs/openapi.json`.
//! The spec is hand-written in `openapi_v1.json`; keep it in sync with `routes/v1.rs`.

use axum::http::header;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;

const SPEC: &str = include_str!("../openapi_v1.json");
const SCALAR_VERSION: &str = "1.76.3";

pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new().route("/docs", get(ui)).route("/docs/openapi.json", get(spec))
}

async fn spec() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], SPEC)
}

fn ui_html() -> String {
    format!(
        r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hamba Email API</title>
</head>
<body>
  <script id="api-reference" data-url="/docs/openapi.json"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@{SCALAR_VERSION}"></script>
</body>
</html>"##
    )
}

async fn ui() -> Html<String> {
    Html(ui_html())
}

#[cfg(test)]
mod tests {
    #[test]
    fn spec_is_valid_json() {
        let v: serde_json::Value = serde_json::from_str(super::SPEC).unwrap();
        assert_eq!(v["openapi"], "3.1.0");
        assert_eq!(v["info"]["title"], "Hamba Email API");
        assert!(v["paths"]["/api/v1/emails"]["get"].is_object());
        assert!(v["components"]["securitySchemes"]["bearerAuth"].is_object());
        let html = super::ui_html();
        assert!(html.contains("@scalar/api-reference@1."));
        assert!(!html.contains("swagger"));
    }
}
