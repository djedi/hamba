# Hamba

<p align="center">
  <img src="hamba-logo.png" alt="Hamba" height="128" />
</p>

<p align="center">
  <strong>A blazing fast, keyboard-driven email client.</strong>
</p>

---

**Hamba** (pronounced _hahm-bah_) is a Xhosa word meaning "go" or "move" — reflecting the app's focus on speed and efficiency. In Xhosa culture, "Hamba kahle" means "go well" or "travel safely."

## Features

- **Keyboard-first navigation** — Vim-style shortcuts (j/k to navigate, e to archive, etc.)
- **Blazing fast** — Local SQLite caching, optimistic updates, prefetching
- **Multiple providers** — Gmail API and IMAP/SMTP for self-hosted email
- **Command palette** — Cmd+K to access all actions
- **Full-text search** — FTS5-powered search across all emails
- **Multiple accounts** — Connect Gmail and IMAP accounts side by side
- **Desktop app** — Native macOS app via Tauri
- **Dark mode** — Easy on the eyes

## Tech Stack

- **Frontend**: SvelteKit + Svelte 5
- **Backend**: Bun + Elysia
- **Database**: SQLite (bun:sqlite)
- **Desktop**: Tauri
- **Email**: Gmail API, IMAP (imapflow), SMTP (nodemailer)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- [Rust](https://rustup.rs) installed (for Tauri desktop builds)
- Google Cloud project with Gmail API enabled (for Gmail accounts)

### 1. Set up Google OAuth (for Gmail)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Web application)
5. Add `http://localhost:3001/auth/callback` as an authorized redirect URI

### 2. Configure environment

Create `.env` in the root directory:

```
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:3001/auth/callback
```

### 3. Install dependencies

```bash
# Install all dependencies
bun install
cd backend && bun install
cd ../frontend && bun install
```

### 4. Run the app

**Web (development):**

```bash
# Terminal 1 - Backend
cd backend && bun run dev

# Terminal 2 - Frontend
cd frontend && bun run dev
```

- Backend API: http://localhost:3001
- Frontend: http://localhost:5173

**Desktop (Tauri):**

```bash
# Terminal 1 - Backend
cd backend && bun run dev

# Terminal 2 - Tauri
cd frontend && bun run tauri:dev
```

## Keyboard Shortcuts

| Key            | Action               |
| -------------- | -------------------- |
| `j` / `k`      | Navigate down / up   |
| `o` / `Enter`  | Open email           |
| `u` / `Escape` | Back to inbox        |
| `e` / `y`      | Archive              |
| `#`            | Move to trash        |
| `s`            | Star / unstar        |
| `Shift+I`      | Toggle read / unread |
| `Space`        | Scroll down (95%)    |
| `Shift+Space`  | Scroll up (95%)      |
| `/`            | Focus search         |
| `c`            | Compose              |
| `r`            | Reply                |
| `a`            | Reply all            |
| `f`            | Forward              |
| `Shift+R`      | Sync emails          |
| `Cmd+K`        | Command palette      |
| `g`            | Go to top            |
| `Shift+G`      | Go to bottom         |

## Testing

Run tests with the helper script:

```bash
./test              # Run all tests (frontend + backend)
./test frontend     # Run frontend tests only (alias: fe)
./test backend      # Run backend tests only (alias: be)
./test --report     # Generate HTML coverage report
./test --watch      # Watch mode (frontend only)
```

Tests live alongside their source files (e.g., `stores.ts` has `stores.test.ts`).

- **Frontend**: [Vitest](https://vitest.dev) with jsdom + [@testing-library/svelte](https://testing-library.com/docs/svelte-testing-library/intro)
- **Backend**: [Bun's built-in test runner](https://bun.sh/docs/cli/test)

## Project Structure

```
hamba/
├── backend/
│   └── src/
│       ├── index.ts              # Elysia server
│       ├── db/                   # SQLite database
│       ├── routes/               # API routes (auth, emails)
│       └── services/
│           └── providers/        # Gmail & IMAP providers
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.ts            # API client
│   │   │   ├── stores.ts         # Svelte stores
│   │   │   ├── keyboard.ts       # Keyboard navigation
│   │   │   └── components/       # UI components
│   │   └── routes/               # SvelteKit routes
│   └── src-tauri/                # Tauri desktop config
└── .env                          # Environment variables
```

## License

MIT
