# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hamba is a keyboard-driven email client (Superhuman alternative). It supports both Gmail API and IMAP/SMTP providers.

## Commands

**Development (run both):**
```bash
cd backend && cargo run       # API at localhost:8877 (loads ../.env)
cd frontend && bun run dev    # Web at localhost:8878
```

**Tauri desktop app:**
```bash
cd frontend && bun run tauri:dev    # Dev mode (run backend separately)
cd frontend && bun run tauri:build  # Production build with bundled backend
```

**Type checking:**
```bash
cd frontend && bun run check
```

**Testing:**
```bash
./test              # Run all tests
./test fe           # Frontend tests only
./test be           # Backend tests only
./test --report     # Run with coverage report
```

## Architecture

### Provider Abstraction

The backend is Rust (axum + tokio + rusqlite) in `backend/`. Email operations are abstracted via the `EmailProvider` trait (`backend/src/providers/mod.rs`). Implementations:
- `GmailProvider` - Gmail API with OAuth tokens
- `MicrosoftProvider` - Microsoft Graph with OAuth tokens
- `ImapSmtpProvider` / `YahooProvider` - IMAP (async-imap) + SMTP (lettre); shared logic lives in `providers/imap_common.rs`

The factory `get_provider(&state, account_id)` returns the correct provider based on `accounts.provider_type`. Shared DB writes (email/label/draft upserts) live in `backend/src/emails_db.rs`. `state.db.conn()` returns a mutex guard — never hold it across an `.await`.

### Frontend State

Svelte 5 runes are used throughout. Key stores in `frontend/src/lib/stores.ts`:
- `emails`, `selectedEmailId`, `selectedIndex` - Email list state
- `emailActions` - Optimistic update functions (archive, star, trash, etc.)
- `emailBodyCache` - Prefetched email bodies for instant opening
- `toasts` - Toast notifications

### Keyboard Navigation

All keyboard shortcuts are in `frontend/src/lib/keyboard.ts`. Handlers map to store actions. Vim-style: j/k navigate, e/y archive, s star, # trash.

### Email Rendering

Email HTML is rendered in a sandboxed iframe (`EmailView.svelte`) for CSS isolation. `cid:` embedded images are replaced with API URLs to fetch stored attachments.

### Database

SQLite via `rusqlite` (bundled, WAL mode). Tables: `accounts`, `emails`, `attachments`, `drafts`, `labels`, `snippets`, `contacts`, `signatures`, etc. FTS5 virtual table `emails_fts` for search.

**Migrations:**
```bash
cd backend && cargo run -- migrate        # Apply pending migrations and show status
```

Migrations run automatically on startup. They are SQL files in `backend/src/migrations/`, registered in the `MIGRATIONS` list in `backend/src/db.rs` (versions are tracked in the `_migrations` table, compatible with databases created by the old TypeScript backend). To add one, create `NNN_name.sql` and append it to that list. Pre-migration databases are bootstrapped automatically.

## Environment

Requires `.env` in root with:
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
REDIRECT_URI=http://localhost:8877/auth/callback

# Optional: For AI email composition (Cmd+J in compose)
ANTHROPIC_API_KEY=...

# Optional: Read receipts + link tracking (public URL of the backend, e.g. a tunnel)
PUBLIC_URL=https://mail.example.com

# Optional: Logging configuration
LOG_LEVEL=info          # debug, info, warn, error
LOG_FORMAT=json         # Set to 'json' for production, omit for human-readable
SENTRY_DSN=...          # Optional: Error tracking via Sentry
```

## Key Patterns

- Optimistic updates: UI updates immediately, API calls fire async, rollback on error
- Prefetching: Email bodies fetched on hover and j/k navigation for instant opening
- Auto-sync: Emails sync every 60 seconds; manual sync via Shift+R

## Design Philosophy

**Always optimize for speed.** This is a Superhuman clone - perceived performance is critical.

- Move expensive operations to sync time (background) rather than render time (user-facing)
- Precompute and cache aggressively (e.g., email snippets, FTS indexes)
- Use optimistic updates - never block UI waiting for API responses
- Prefetch data the user is likely to need next
- Minimize client-side processing; do heavy lifting on the backend

## Real-time Updates

### IMAP Accounts
IMAP accounts use **IDLE** for instant notifications. When new mail arrives:
1. IMAP server notifies the persistent connection (`backend/src/services/imap_idle.rs`)
2. Backend triggers a quick sync and notifies via WebSocket
3. Frontend receives WebSocket message and refreshes email list

### Gmail Accounts
Gmail uses polling (every 60s) as fallback. For true push notifications:
1. Set up Google Cloud Pub/Sub topic
2. Configure webhook URL (requires public endpoint - use ngrok for local dev)
3. Call Gmail `watch` API to register the webhook

### WebSocket Protocol
- Connect to `ws://localhost:8877/ws`
- Send `{"type": "subscribe", "accountId": "..."}` to subscribe
- Receive `{"type": "new_mail", "accountId": "..."}` on new mail
- Receive `{"type": "sync_complete", "accountId": "...", "count": N}` after sync

## Testing

- **Frontend**: Vitest with jsdom, `@testing-library/svelte`; tests live alongside files (`stores.ts` → `stores.test.ts`)
- **Backend**: `cargo test`; unit tests in `#[cfg(test)]` modules, HTTP tests against an in-memory DB in `backend/src/api_tests.rs`. CI also runs `cargo clippy --all-targets -- -D warnings`.

Run `./test --help` for all options.

## App Login

The app itself requires a login (`backend/src/routes/session.rs`): username/password (argon2) plus optional passkeys (webauthn-rs; relying party derived from `FRONTEND_URL`, so passkeys need https or localhost). Sessions are an HttpOnly `hamba_session` cookie. Middleware `require_auth` guards every route except `/health`, `/session/{status,setup,login,logout,passkeys/login/*}`, `/api/v1/*` (Bearer keys), `/docs*`, and `/t/*` (tracking). With no user yet, the frontend shows a setup screen. Reset a password with `hamba-backend set-password <username>` (password from `HAMBA_PASSWORD` or stdin). `HAMBA_AUTH=off` disables it (the Tauri sidecar does this). Tests build `AppState { auth: false }`.

Production web builds use `VITE_API_URL=/api`: the reverse proxy serves the frontend at `/` and the backend at `/api/*` with the prefix stripped (except `/api/v1/*`, passed through as-is). Set `FRONTEND_URL=https://<host>`, `REDIRECT_URI=https://<host>/api/auth/callback`, `PUBLIC_URL=https://<host>/api`.

## API Documentation

The public read-only API lives under `/api/v1` (`backend/src/routes/v1.rs`) and requires `Authorization: Bearer hamba_...`. Keys are created/revoked in Settings -> API (management routes at `/api-keys`, `routes/api_keys.rs`; only a SHA-256 hash is stored). Endpoints: accounts, emails (list/get/attachments), threads, search.

Scalar docs are served at `http://localhost:8877/docs`; the hand-written OpenAPI 3.1 spec is `backend/openapi_v1.json` (served at `/docs/openapi.json`). Update it whenever `/api/v1` changes. The internal app API (everything else) is undocumented.

## Logging & Monitoring

The backend uses `tracing` for structured logging; request metrics and the error buffer live in `backend/src/services/metrics.rs`. Key features:

**Structured Logging:**
- JSON output in production (`LOG_FORMAT=json`), human-readable in development
- Log levels: debug, info, warn, error (controlled via `LOG_LEVEL`)
- Contextual logging with service tags (e.g., `imap-idle`, `pending-send`, `scheduled-send`)
- Request/response logging middleware with request IDs

**Monitoring Endpoints:**
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed health with memory usage, metrics, error counts
- `GET /metrics` - Performance metrics (request timings, operation durations)
- `GET /errors/recent` - Recent error log for debugging

**Usage in Code:**
```rust
tracing::info!(service = "sync", account_id, count = 5, "Operation completed");
tracing::error!(error = %e, "Operation failed");

// Metrics and the /errors/recent buffer
crate::services::metrics::timing("operation.duration", duration_ms, json!({ "type": "sync" }));
crate::services::metrics::record_error("Operation failed", json!({ "context": "sync" }));
```

## Docker Deployment

The application can be run in Docker containers for production deployment or consistent development environments.

### Makefile (Recommended)

```bash
make up                  # Start in background, wait, open the browser
make down                # Stop and remove containers
make restart             # Restart (backend recompiles)
make logs                # Follow logs (SERVICE=backend|frontend for one)
make status              # Container status and URLs
make shell               # Shell in a container (SERVICE=frontend for the frontend)
make rebuild             # Rebuild with --no-cache, then start
make clean               # Remove containers and volumes (asks first)
make help                # All targets
```

**Ports:** the dev stack uses fixed, uncommon host ports (backend `56003`, frontend `5273`) so it doesn't collide with other local services. `make status` prints the URLs. Override with `BACKEND_PORT=8877 FRONTEND_PORT=8878 make up` (e.g. when OAuth redirect URIs are registered against a specific port). The backend gets `FRONTEND_URL` (CORS and post-login redirect) and the frontend gets `VITE_API_URL`/`VITE_WS_URL` from these ports.

### Fast deploy to your own server

`make deploy` (`scripts/deploy`) rsyncs the working tree to a server and builds there with `docker-compose.deploy.yml` (Cargo `fast-release` profile + BuildKit cache mounts: warm backend rebuilds take seconds). No commit needed. `SERVICE=backend|frontend` deploys one. Settings are `DEPLOY_HOST`, `DEPLOY_PATH`, `DEPLOY_PROJECT`, `DEPLOY_URL` in the root `.env`; the server's `<DEPLOY_PATH>/.env` holds the app settings plus `HAMBA_BACKEND_PORT`/`HAMBA_FRONTEND_PORT`. GitHub's Deploy workflow (full `release` profile) still publishes ghcr images on push to main.

### Quick Start (Production)

```bash
# Build and run both services (production mode)
docker compose up -d

# Frontend: http://localhost:8080
# Backend API: http://localhost:8877
```

### Manual Development (without make)

```bash
# Run with hot reload support
docker compose -f docker-compose.yml -f docker-compose.dev.yml up

# Frontend dev server: http://localhost:8878
# Backend API: http://localhost:8877
```

### Docker Architecture

- **backend/Dockerfile**: Rust API server (multi-stage: `dev` target runs `cargo run`, `runner` is a slim image with the release binary)
- **frontend/Dockerfile**: SvelteKit static build served by nginx
- **docker-compose.yml**: Production configuration
- **docker-compose.dev.yml**: Development override with hot reload

### Data Persistence

The SQLite database is stored in a Docker volume mounted at `./data`. The `DATABASE_PATH` environment variable controls the database location inside the container.

```bash
# Database is persisted at ./data/hamba.db
# Backup: cp ./data/hamba.db ./backup/
```

### Environment Variables

Create a `.env` file in the project root (see `.env.example` in backend/):

```bash
# Required for email providers
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
REDIRECT_URI=http://localhost:8877/auth/callback

# Optional
ANTHROPIC_API_KEY=...
LOG_LEVEL=info
LOG_FORMAT=json
```

### Building Individual Images

```bash
# Backend only
docker build -t hamba-backend ./backend

# Frontend only
docker build -t hamba-frontend ./frontend

# Run backend with custom database path
docker run -p 8877:8877 -v $(pwd)/data:/app/data --env-file .env hamba-backend
```

### Health Checks

The backend exposes health endpoints used by Docker:
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed health with metrics

## CI/CD Pipeline

GitHub Actions workflows are configured in `.github/workflows/`:

### CI Workflow (ci.yml)
Runs on all pushes and pull requests to main:
- **Lint & Typecheck**: Runs `bun run check` on frontend
- **Backend Tests**: Runs `cargo clippy` and `cargo test` in backend
- **Frontend Tests**: Runs `bun run test` in frontend
- **Build**: Builds frontend after all checks pass

### Deploy Workflow (deploy.yml)
Runs on pushes to main and manual triggers:
- Builds Docker images for backend and frontend
- Pushes to GitHub Container Registry (ghcr.io)
- Images are tagged with commit SHA and `latest`

### Running CI Locally
```bash
# Type checking
cd frontend && bun run check

# All tests
./test

# Just frontend tests
./test fe

# Just backend tests
./test be
```
