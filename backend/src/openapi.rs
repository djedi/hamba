//! OpenAPI docs: Swagger UI at `/docs`, spec at `/docs/json`.
//! `openapi.json` is generated from the TS backend's Elysia swagger output.

use axum::http::header;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::Router;

const SPEC: &str = include_str!("../openapi.json");
const SWAGGER_UI_VERSION: &str = "5.17.14";

pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new().route("/docs", get(ui)).route("/docs/json", get(spec))
}

async fn spec() -> impl IntoResponse {
    ([(header::CONTENT_TYPE, "application/json")], SPEC)
}

fn ui_html() -> String {
    let cdn = format!("https://cdn.jsdelivr.net/npm/swagger-ui-dist@{SWAGGER_UI_VERSION}");
    format!(
        r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hamba Email API</title>
  <link rel="stylesheet" href="{cdn}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="{cdn}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {{
      window.ui = SwaggerUIBundle({{ url: "/docs/json", dom_id: "#swagger-ui" }});
    }};
  </script>
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
        assert_eq!(v["info"]["title"], "Hamba Email API");
        assert!(v["paths"]["/ai/compose"]["post"].is_object());
        assert!(super::ui_html().contains("swagger-ui-dist@"));
    }
}
