# Hamba

<p align="center">
  <img src="hamba-logo.png" alt="Hamba" height="128" />
</p>

<p align="center">
  <strong>A blazing fast, keyboard-driven email client.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#usage">Usage</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#contributing">Contributing</a>
</p>

---

**Hamba** (pronounced _hahm-bah_) is a Xhosa word meaning "go" or "move" — reflecting the app's focus on speed and efficiency. In Xhosa culture, "Hamba kahle" means "go well" or "travel safely."

<!-- Demo GIF: Record following docs/DEMO_SCRIPT.md and place demo.gif in repo root -->
<!-- <p align="center">
  <img src="demo.gif" alt="Hamba Demo" width="800" />
</p> -->

## Features

### Core Email Features

- **Multiple Email Providers** — Gmail API, Outlook/Office365, Yahoo, and generic IMAP/SMTP
- **Keyboard-first Navigation** — Vim-style shortcuts (j/k to navigate, e to archive, etc.)
- **Split Inbox** — AI-powered classification of Important vs Other emails (like Superhuman)
- **Command Palette** — Cmd+K to access all actions instantly
- **Full-text Search** — FTS5-powered search with operators (`from:`, `to:`, `subject:`, `has:attachment`, etc.)
- **Thread View** — Conversation grouping with expandable messages

### Organization

- **Labels & Folders** — Full support for Gmail labels and IMAP folders
- **Snooze** — Hide emails until later (h key) with presets or custom dates
- **Follow-up Reminders** — Get reminded if you don't receive a reply
- **Starred, Sent, Drafts, Trash, Archive** — All standard views supported

### Compose

- **AI-powered Writing** — Generate emails from brief prompts (Cmd+J)
- **Smart Reply Suggestions** — Quick contextual reply options
- **Email Templates/Snippets** — Type `;shortcut` to expand saved snippets
- **Undo Send** — Cancel sent emails within a configurable window
- **Send Later** — Schedule emails for optimal delivery times
- **Attachments** — Drag-and-drop file attachments
- **Contact Autocomplete** — Fast recipient lookup from your contacts

### Performance

- **Local SQLite Cache** — Instant access to all emails
- **Optimistic Updates** — UI responds immediately, syncs in background
- **Prefetching** — Adjacent emails loaded before you need them
- **Virtual Scrolling** — Handle inboxes of any size smoothly
- **Offline Support** — Service worker caches emails for offline reading

### Interface

- **Dark Mode** — Easy on the eyes, with theme customization
- **Toast Notifications** — Non-blocking feedback with undo actions
- **Loading Skeletons** — Polished loading states
- **Empty States** — Celebrate Inbox Zero!
- **Desktop App** — Native macOS app via Tauri

### AI Features

- **AI Email Composer** — Write full emails from brief prompts
- **Email Summarization** — Get 2-3 sentence summaries of long threads
- **AI-powered Inbox Classification** — Smart Important vs Other sorting
- **Smart Reply Suggestions** — Contextual quick replies

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit + Svelte 5 |
| Backend | Bun + Elysia |
| Database | SQLite (bun:sqlite) |
| Desktop | Tauri |
| Email | Gmail API, Microsoft Graph, IMAP/SMTP |
| AI | Anthropic Claude API |

## Installation

### Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- [Rust](https://rustup.rs) (only for Tauri desktop builds)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/hamba.git
cd hamba

# Install dependencies
bun install
cd backend && bun install
cd ../frontend && bun install
cd ..

# Configure environment (see Configuration section)
cp backend/.env.example .env
# Edit .env with your OAuth credentials

# Start development servers
cd backend && bun run dev     # Terminal 1: API at localhost:3001
cd frontend && bun run dev    # Terminal 2: Web at localhost:5173
```

### Docker Deployment

```bash
# Production deployment
docker compose up -d

# Frontend: http://localhost:8080
# Backend API: http://localhost:3001
```

For development with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Desktop App (Tauri)

```bash
# Development (run backend separately)
cd frontend && bun run tauri:dev

# Production build with bundled backend
cd frontend && bun run tauri:build
```

## Configuration

Create a `.env` file in the project root with the following variables:

### Required: Gmail OAuth

```bash
# Get from https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3001/auth/callback
```

**Setup steps:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Web application)
5. Add `http://localhost:3001/auth/callback` as an authorized redirect URI

### Optional: Microsoft OAuth (Outlook/Office365)

```bash
# Get from https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3001/auth/microsoft/callback
```

**Setup steps:**
1. Register new application at Azure Portal
2. Select "Accounts in any organizational directory and personal Microsoft accounts"
3. Add Web redirect URI: `http://localhost:3001/auth/microsoft/callback`
4. Under "API permissions", add: `Mail.ReadWrite`, `Mail.Send`, `User.Read`

### Optional: Yahoo OAuth

```bash
# Get from https://developer.yahoo.com/apps/
YAHOO_CLIENT_ID=your_yahoo_client_id
YAHOO_CLIENT_SECRET=your_yahoo_client_secret
YAHOO_REDIRECT_URI=http://localhost:3001/auth/yahoo/callback
```

### Optional: AI Features

```bash
# For AI email composition, summarization, and smart replies
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Optional: Logging & Monitoring

```bash
LOG_LEVEL=info              # debug, info, warn, error
LOG_FORMAT=json             # json for production, omit for human-readable
SENTRY_DSN=your_sentry_dsn  # Error tracking
```

## Usage

### Adding an Account

1. Launch the app and click "Add Account"
2. Choose your email provider (Gmail, Outlook, Yahoo, or IMAP)
3. Complete the OAuth flow or enter IMAP/SMTP credentials
4. Your emails will begin syncing automatically

### Navigating Email

- Use `j` and `k` to move through your inbox
- Press `o` or `Enter` to open an email
- Press `u` or `Escape` to return to the list
- Press `/` to search
- Press `Cmd+K` for the command palette

### Composing Email

- Press `c` to compose a new email
- Press `r` to reply, `a` to reply all, `f` to forward
- Press `Cmd+J` for AI-assisted writing
- Type `;snippet` to expand saved templates
- Press `Cmd+Enter` to send

### Managing Email

- Press `e` or `y` to archive
- Press `#` to trash
- Press `s` to star/unstar
- Press `h` to snooze
- Press `l` to apply labels

## Keyboard Shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down / up |
| `o` / `Enter` | Open email |
| `u` / `Escape` | Back to inbox |
| `g` | Go to top |
| `Shift+G` | Go to bottom |
| `/` | Focus search |
| `Cmd+K` | Command palette |
| `?` | Show all shortcuts |

### Actions

| Key | Action |
|-----|--------|
| `e` / `y` | Archive |
| `#` | Move to trash |
| `s` | Star / unstar |
| `Shift+I` | Toggle read / unread |
| `h` | Snooze |
| `l` | Apply label |

### Compose

| Key | Action |
|-----|--------|
| `c` | Compose new |
| `r` | Reply |
| `a` | Reply all |
| `f` | Forward |
| `Cmd+J` | AI compose |
| `Cmd+Enter` | Send |
| `Cmd+Shift+C` | Add Cc |
| `Cmd+Shift+B` | Add Bcc |

### View

| Key | Action |
|-----|--------|
| `Space` | Scroll down (95%) |
| `Shift+Space` | Scroll up (95%) |
| `Shift+R` | Sync emails |
| `Cmd+1-9` | Switch accounts |

## API Documentation

When the backend is running, interactive API documentation is available at:

- **Swagger UI**: http://localhost:3001/docs
- **Health Check**: http://localhost:3001/health
- **Metrics**: http://localhost:3001/metrics

## Testing

```bash
# Run all tests
./test

# Frontend tests only
./test fe

# Backend tests only
./test be

# With coverage report
./test --report

# Watch mode
./test --watch
```

Tests live alongside source files (e.g., `stores.ts` → `stores.test.ts`).

## Project Structure

```
hamba/
├── backend/
│   └── src/
│       ├── index.ts              # Elysia server entry point
│       ├── db/                   # SQLite database & migrations
│       ├── routes/               # API routes
│       └── services/
│           ├── providers/        # Gmail, IMAP, Microsoft, Yahoo
│           ├── logger.ts         # Structured logging
│           └── ai.ts             # AI features
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.ts            # API client
│   │   │   ├── stores.ts         # Svelte stores
│   │   │   ├── keyboard.ts       # Keyboard navigation
│   │   │   └── components/       # UI components
│   │   └── routes/               # SvelteKit routes
│   └── src-tauri/                # Tauri desktop config
├── docker-compose.yml            # Production Docker config
├── docker-compose.dev.yml        # Development Docker config
└── .env                          # Environment variables
```

## Database Migrations

```bash
cd backend

# Run pending migrations
bun run migrate

# Check migration status
bun run migrate:status

# Rollback last migration
bun run migrate:rollback

# Create new migration
bun run migrate:create add_feature_table
```

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

1. Fork and clone the repository
2. Install dependencies: `bun install` in root, backend, and frontend
3. Copy `.env.example` to `.env` and configure
4. Start development servers (see Installation)

### Code Style

- TypeScript strict mode is enabled
- Use Svelte 5 runes for frontend state
- Follow existing patterns in the codebase
- Write tests for new functionality

### Pull Request Process

1. Create a feature branch from `master`
2. Make your changes with clear commit messages
3. Ensure all tests pass: `./test`
4. Ensure type checking passes: `cd frontend && bun run check`
5. Submit a PR with a clear description of changes

### Reporting Issues

Please use [GitHub Issues](https://github.com/yourusername/hamba/issues) to report bugs or request features. Include:

- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Your environment (OS, Bun version, browser)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ for people who value their time
</p>
