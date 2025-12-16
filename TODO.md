# Hamba - Superhuman Clone TODO

A task list for building a viable open source Superhuman clone. Each task includes context for an AI coding agent to complete it independently.

## Core Email Features

### Views & Navigation

- [x] **Implement Starred view** - Add a "Starred" folder view in the sidebar that shows only emails where `is_starred = 1`. Create a new query `emailQueries.getStarred` in `backend/src/db/index.ts` and add a route. Update `frontend/src/lib/stores.ts` to support different views and update `Sidebar.svelte` to switch between them.

- [x] **Implement Sent view** - Add a "Sent" folder view. For Gmail, fetch messages with SENT label. For IMAP, fetch from "Sent" or "Sent Items" folder. Store sent emails in the database with a `folder` column or label system.

- [x] **Implement Drafts view** - Add drafts support. Create a `drafts` table in the database. Auto-save compose content every 5 seconds. Load drafts in the Drafts sidebar view. For Gmail/IMAP, sync drafts from server.

- [x] **Implement Trash view** - Add a "Trash" folder view showing emails where `is_trashed = 1`. Add ability to permanently delete or restore from trash. Auto-delete emails after 30 days.

- [x] **Implement Archive view** - Add an "All Mail" or "Archive" view showing archived emails (`is_archived = 1`). Allow un-archiving back to inbox.

- [x] **Implement Labels/Folders support** - Parse Gmail labels and IMAP folders. Store in a `labels` table. Show labels on emails in list view. Allow filtering by label. Add UI to create/edit/delete labels.

### Split Inbox

- [x] **Implement Split Inbox (Important/Other)** - Superhuman's killer feature. Create an ML model or rules-based system to classify emails as Important vs Other. Factors: sender frequency, reply rate, domain (personal vs automated), keywords. Store `is_important` flag. Add UI tabs above inbox to switch between Important/Other/All. Default to Important view.

### Snooze & Reminders

- [x] **Implement Snooze functionality** - Add `snoozed_until` timestamp column to emails table. Create UI to snooze an email (keyboard shortcut `h`). Options: Later today, Tomorrow, This weekend, Next week, Pick date. Snoozed emails disappear from inbox until the snooze time, then reappear at the top. Add a "Snoozed" view in sidebar.

- [x] **Implement Follow-up Reminders** - Add `remind_at` timestamp column. If you send an email and don't get a reply by the remind date, surface it in inbox with "Follow up?" prompt. UI in compose to set reminder. Keyboard shortcut `Shift+H` to set reminder on sent email.

### Compose Enhancements

- [x] **Add attachment support for sending** - Update `ComposeView.svelte` to accept file attachments. Add drag-and-drop zone. Store attachments as base64 or multipart. Update `GmailProvider.send()` and `ImapSmtpProvider.send()` to handle attachments using proper MIME encoding.

- [x] **Implement Undo Send** - After sending, show a toast "Email sent - Undo" for 5-10 seconds. If clicked, cancel the send. For Gmail, use the Gmail API's undo feature. For IMAP/SMTP, delay the actual send by the undo window duration, keeping it in a pending queue.

- [x] **Implement Send Later / Scheduling** - Add UI to schedule email for later. Store scheduled emails in a `scheduled_emails` table with `send_at` timestamp. Run a background job every minute to send due emails. Show "Scheduled" view in sidebar.

- [x] **Implement Email Templates / Snippets** - Create a `snippets` table with `name`, `shortcut`, `content`. In compose, typing `;shortcut` expands to the snippet content. Add UI to manage snippets in settings. Superhuman uses `;` prefix.

- [x] **Add CC/BCC UI in compose** - Currently CC/BCC fields may not be visible by default. Add Cc/Bcc links that expand input fields. Remember preference. Keyboard shortcut `Cmd+Shift+C` for Cc, `Cmd+Shift+B` for Bcc.

- [x] **Implement contact autocomplete** - Create a `contacts` table populated from sent/received emails. In compose To/Cc/Bcc fields, show autocomplete dropdown as user types. Match on name and email. Show recent contacts first, then alphabetical.

### Search

- [x] **Improve search UI** - Add a prominent search bar (keyboard shortcut `/`). Show search results in main view. Support operators: `from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `is:starred`, `before:`, `after:`. Use the existing FTS5 virtual table.

- [x] **Add search highlighting** - When viewing search results, highlight matching terms in the email list and email body.

## AI Features

- [x] **AI Email Composer** - Integrate with Claude/OpenAI API. Add "Write with AI" button in compose. User provides brief prompt ("decline politely", "ask for meeting next week"), AI generates full email. Keyboard shortcut `Cmd+J`.

- [x] **AI Email Summarization** - For long emails/threads, show "Summarize" button. Use AI to generate 2-3 sentence summary. Cache summaries in database.

- [x] **AI-powered Split Inbox** - Use embeddings or Claude to classify emails as Important vs Other based on content, sender relationship, and user behavior patterns.

- [x] **Smart Reply Suggestions** - Show 3 quick reply options at bottom of email view (like Gmail). Use AI to generate contextual short responses.

## Performance & Polish

### Speed Optimizations

- [x] **Implement virtual scrolling for email list** - Current implementation renders all emails. For large inboxes, implement virtual scrolling that only renders visible rows. Use a library like `svelte-virtual-list` or build custom.

- [x] **Add email list pagination/infinite scroll** - Currently loads fixed number of emails. Implement infinite scroll that loads more as user scrolls down. Add `offset` parameter to email fetch.

- [x] **Optimize email prefetching** - Currently prefetches adjacent emails. Expand to prefetch next 5 emails in background when viewing an email, so navigation is instant.

- [x] **Add service worker for offline support** - Cache emails locally using service worker. Allow reading cached emails offline. Queue actions (archive, reply) to sync when back online.

### UI Polish

- [x] **Add toast notifications** - Show non-blocking toast messages for actions: "Email archived", "Email sent", "Sync complete". Use a toast library or build simple component. Include undo action where applicable.

- [x] **Add loading skeletons** - Replace loading spinners with skeleton loaders that match the shape of content (email rows, email body). Feels faster and more polished.

- [x] **Add empty states** - Design empty states for: empty inbox ("Inbox Zero!"), no search results, no starred emails, etc. Add illustrations or icons.

- [x] **Add keyboard shortcut overlay** - Press `?` to show a modal with all keyboard shortcuts organized by category. Similar to GitHub's shortcut help.

- [x] **Implement Command Palette search** - The `Cmd+K` palette exists but needs full implementation. Add fuzzy search over: commands, recent emails, contacts, labels. Arrow keys to navigate, Enter to select.

- [x] **Add email conversation/thread view** - Group emails by thread_id. Show conversation view with all messages in thread expanded or collapsed. Reply at bottom of thread.

- [x] **Improve date formatting** - Show relative dates in email list: "2m ago", "1h ago", "Yesterday", "Dec 10". Show full date on hover. Match Superhuman's format.

### Error Handling

- [x] **Add global error boundary** - Catch and display errors gracefully. Show "Something went wrong" with retry button instead of crashing.

- [x] **Add connection status indicator** - Show when offline or WebSocket disconnected. Auto-reconnect with exponential backoff. Show "Reconnecting..." status.

- [x] **Handle token expiration gracefully** - For Gmail, detect 401 errors and prompt re-authentication. For IMAP, detect auth failures and show error.

## Settings & Configuration

- [x] **Create Settings UI** - Add Settings page accessible from sidebar or `Cmd+,`. Sections: Account, Appearance, Keyboard shortcuts, Notifications, AI.

- [x] **Add theme customization** - Allow switching between dark/light mode. Add accent color picker. Save preferences to localStorage.

- [x] **Add notification preferences** - Desktop notifications for new email (using Notification API). Configurable: all emails, important only, none. Sound on/off.

- [x] **Add keyboard shortcut customization** - Allow rebinding keyboard shortcuts. Store custom bindings. Reset to defaults option.

- [x] **Add signature management** - Create/edit email signatures per account. Option for plain text or rich HTML. Auto-append to new emails and replies.

## Account Management

- [x] **Improve account switcher** - Show unread count per account in sidebar. Keyboard shortcut to switch accounts (`Cmd+1`, `Cmd+2`, etc). Show which account is active more prominently.

- [x] **Add account settings per account** - Configure sync frequency, signature, name, etc. per account. Edit/delete account.

- [x] **Support Microsoft OAuth** - Add Outlook/Office365 OAuth flow similar to Gmail. Use Microsoft Graph API for email operations.

- [x] **Support Yahoo OAuth** - Add Yahoo OAuth flow. Many users have Yahoo accounts.

## Infrastructure & Code Quality

- [x] **Add comprehensive tests** - Unit tests for database queries, email parsing, dark mode transformation. Integration tests for API routes. E2E tests with Playwright for critical flows.

- [x] **Add TypeScript strict mode** - Enable strict TypeScript checking. Fix all type errors. Add proper types for all API responses.

- [x] **Add API documentation** - Document all backend API endpoints with request/response schemas. Consider OpenAPI/Swagger spec.

- [ ] **Add database migrations system** - Current schema changes are ad-hoc. Implement proper migrations with version tracking. Tools: `umzug`, `kysely`, or custom.

- [ ] **Add logging and monitoring** - Structured logging for backend. Error tracking integration (Sentry). Basic analytics for performance monitoring.

- [ ] **Dockerize the application** - Create Dockerfile for backend and frontend. Docker Compose for local development. Document deployment process.

- [ ] **Add CI/CD pipeline** - GitHub Actions for: lint, typecheck, test on PR. Auto-deploy on merge to main.

## Documentation

- [ ] **Write README** - Project overview, features, screenshots, installation instructions, configuration, contributing guidelines.

- [ ] **Write CONTRIBUTING guide** - How to set up dev environment, code style, PR process, issue templates.

- [ ] **Create demo video/GIF** - Show off key features: keyboard navigation, split inbox, snooze, AI compose.

## Future / Nice-to-Have

- [ ] **Calendar integration** - Show upcoming meetings in sidebar. Detect meeting invites in emails. Quick RSVP buttons.

- [ ] **Read receipts / Open tracking** - Track when recipients open emails (with pixel). Show "Seen" indicator. Respect privacy concerns - make optional.

- [ ] **Mobile app (React Native)** - Port frontend to React Native for iOS/Android. Share API and business logic.

- [ ] **Browser extension** - Chrome/Firefox extension to quickly save emails, access from any page, keyboard shortcut to compose.

- [ ] **Email analytics** - Dashboard showing: emails sent/received per day, average response time, busiest times, top contacts.
