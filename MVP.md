# FastEmail MVP Plan

## Core Features (Must Have)

### P0 - Critical

- [x] **Compose & Send**
  - [x] Compose view component with To, Cc, Bcc, Subject, Body
  - [ ] Draft auto-save to local DB
  - [x] Send via Gmail API (`/emails/send` endpoint)
  - [x] Keyboard shortcut: `c` to compose

- [x] **Reply & Forward**
  - [x] Reply component (inline or modal)
  - [x] Reply-all support
  - [x] Forward with quoted original message
  - [x] Keyboard shortcuts: `r` reply, `a` reply-all, `f` forward

- [x] **Token Refresh**
  - [x] Auto-detect expired tokens before API calls
  - [x] Background refresh using refresh_token
  - [x] Re-authenticate flow if refresh fails

### P1 - Important

- [ ] **Incremental Sync**
  - [ ] Store Gmail historyId for delta sync
  - [ ] Poll every 30-60 seconds for new emails
  - [ ] Only fetch changed messages, not full inbox

- [ ] **Error Handling & Toasts**
  - [ ] Toast notification component
  - [ ] Network error detection and retry
  - [ ] Offline indicator
  - [ ] Loading states for all async actions

- [ ] **Attachments**
  - [ ] Display attachment list in email view
  - [ ] Download attachments
  - [ ] Attach files in compose view
  - [ ] Drag & drop support

## Nice to Have (Post-MVP)

### P2 - Enhancements

- [ ] **Labels/Folders**
  - [ ] Fetch Gmail labels via API
  - [ ] Sidebar navigation by label
  - [ ] Apply/remove labels from emails
  - [ ] Keyboard shortcut: `l` to add label

- [ ] **Undo Actions**
  - [ ] Undo send (5 second delay before actual send)
  - [ ] Undo archive/trash with toast + undo button
  - [ ] Keyboard shortcut: `z` to undo

### P3 - Future

- [ ] **Snooze**
  - [ ] Snooze picker (later today, tomorrow, next week, custom)
  - [ ] Background job to "un-snooze" emails
  - [ ] Keyboard shortcut: `h` to snooze

- [ ] **Multiple Accounts**
  - [ ] Account switcher in sidebar
  - [ ] Unified inbox view (all accounts)
  - [ ] Per-account email lists

- [ ] **AI Features**
  - [ ] Email summaries (TL;DR)
  - [ ] Smart compose suggestions
  - [ ] Auto-categorization

## Keyboard Shortcuts (Full List)

| Key | Action | Status |
|-----|--------|--------|
| `j` / `k` | Navigate down / up | ✅ Done |
| `o` / `Enter` | Open email | ✅ Done |
| `u` / `Escape` | Back to inbox | ✅ Done |
| `e` | Archive | ✅ Done |
| `#` | Move to trash | ✅ Done |
| `s` | Star / unstar | ✅ Done |
| `Shift+I` | Toggle read / unread | ✅ Done |
| `/` | Focus search | ✅ Done |
| `Cmd+K` | Command palette | ✅ Done |
| `g` | Go to top | ✅ Done |
| `Shift+G` | Go to bottom | ✅ Done |
| `c` | Compose | ✅ Done |
| `r` | Reply | ✅ Done |
| `a` | Reply all | ✅ Done |
| `f` | Forward | ✅ Done |
| `z` | Undo | 🔲 Todo |
| `l` | Add label | 🔲 Todo |
| `h` | Snooze | 🔲 Todo |

## Technical Notes

### Gmail API Endpoints Needed

```
POST /gmail/v1/users/me/messages/send     # Send email
POST /gmail/v1/users/me/drafts            # Save draft
GET  /gmail/v1/users/me/labels            # List labels
GET  /gmail/v1/users/me/history           # Incremental sync
GET  /gmail/v1/users/me/messages/{id}/attachments/{attachmentId}
```

### Database Schema Additions

```sql
-- Drafts table
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  to_addresses TEXT,
  cc_addresses TEXT,
  bcc_addresses TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  attachments TEXT, -- JSON array
  created_at INTEGER,
  updated_at INTEGER
);

-- Sync state
ALTER TABLE accounts ADD COLUMN history_id TEXT;
```

## Getting Started

To continue development:

```bash
cd /Users/dustin/sd/src/fastemail
bun run dev
```

Backend: http://localhost:3001
Frontend: http://localhost:5173
