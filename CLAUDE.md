# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hamba is a keyboard-driven email client (Superhuman alternative). It supports both Gmail API and IMAP/SMTP providers.

## Commands

**Development (run both):**
```bash
cd backend && bun run dev     # API at localhost:3001
cd frontend && bun run dev    # Web at localhost:5173
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

Email operations are abstracted via `EmailProvider` interface (`backend/src/services/providers/types.ts`). Two implementations exist:
- `GmailProvider` - Uses Gmail API with OAuth tokens
- `ImapSmtpProvider` - Uses imapflow/nodemailer for self-hosted email

The factory `getProvider(accountId)` returns the correct provider based on `account.provider_type`.

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

SQLite via `bun:sqlite`. Tables: `accounts`, `emails`, `attachments`, `drafts`, `labels`, `snippets`, `contacts`, `signatures`, etc. FTS5 virtual table `emails_fts` for search.

**Migrations:**
```bash
cd backend && bun run migrate              # Run pending migrations
cd backend && bun run migrate:status       # Show migration status
cd backend && bun run migrate:rollback     # Rollback last migration
cd backend && bun run migrate:create name  # Create new migration
```

Migration files live in `backend/src/db/migrations/`. Each migration exports `up()` and `down()` functions. The system automatically bootstraps existing databases when first run.

## Environment

Requires `.env` in root with:
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
REDIRECT_URI=http://localhost:3001/auth/callback

# Optional: For AI email composition (Cmd+J in compose)
ANTHROPIC_API_KEY=...

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
1. IMAP server notifies the persistent connection (`imap-idle.ts`)
2. Backend triggers a quick sync and notifies via WebSocket
3. Frontend receives WebSocket message and refreshes email list

### Gmail Accounts
Gmail uses polling (every 60s) as fallback. For true push notifications:
1. Set up Google Cloud Pub/Sub topic
2. Configure webhook URL (requires public endpoint - use ngrok for local dev)
3. Call Gmail `watch` API to register the webhook

### WebSocket Protocol
- Connect to `ws://localhost:3001/ws`
- Send `{"type": "subscribe", "accountId": "..."}` to subscribe
- Receive `{"type": "new_mail", "accountId": "..."}` on new mail
- Receive `{"type": "sync_complete", "accountId": "...", "count": N}` after sync

## Testing

Unit tests live alongside the files they test (e.g., `stores.ts` → `stores.test.ts`).

- **Frontend**: Vitest with jsdom, `@testing-library/svelte`
- **Backend**: Bun's built-in test runner

Run `./test --help` for all options.

## API Documentation

OpenAPI/Swagger documentation is available at `http://localhost:3001/docs` when the backend is running. The documentation includes:
- All API endpoints organized by tags (Auth, Emails, Drafts, Labels, Contacts, AI, Snippets, Signatures)
- Request/response schemas
- Interactive "Try it out" functionality via Swagger UI

## Logging & Monitoring

The backend uses structured logging via `backend/src/services/logger.ts`. Key features:

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
```typescript
import { logger, metrics, errorTracking } from "./services/logger";

// Basic logging
logger.info("Operation completed", { accountId, count: 5 });
logger.error("Operation failed", error, { context: "sync" });

// Child logger with default context
const syncLogger = logger.child({ service: "sync" });
syncLogger.info("Starting sync");

// Performance metrics
const result = await metrics.measure("db.query", async () => {
  return await db.query(...);
});

// Manual timing
metrics.timing("operation.duration", durationMs, { type: "sync" });

// Error tracking
errorTracking.captureException(error, { userId, action });
```
