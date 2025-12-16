# Contributing to Hamba

Thank you for your interest in contributing to Hamba! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- [Rust](https://rustup.rs) (only for Tauri desktop builds)
- Git
- A code editor (VS Code recommended)

### Getting Started

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/hamba.git
   cd hamba
   ```

2. **Install dependencies**

   ```bash
   bun install
   cd backend && bun install
   cd ../frontend && bun install
   cd ..
   ```

3. **Configure environment**

   ```bash
   cp backend/.env.example .env
   ```

   Edit `.env` with your OAuth credentials. See the [README](README.md#configuration) for setup instructions.

4. **Start development servers**

   ```bash
   # Terminal 1: Backend API
   cd backend && bun run dev

   # Terminal 2: Frontend
   cd frontend && bun run dev
   ```

   - Backend API: http://localhost:3001
   - Frontend: http://localhost:5173
   - API docs: http://localhost:3001/docs

### Development Commands

```bash
# Type checking
cd frontend && bun run check

# Run all tests
./test

# Run frontend tests only
./test fe

# Run backend tests only
./test be

# Run tests with coverage
./test --report

# Run tests in watch mode
./test --watch
```

## Code Style

### TypeScript

- TypeScript strict mode is enabled in both frontend and backend
- Use explicit types for function parameters and return values
- Avoid `any` - use proper types or `unknown` with type guards
- Frontend uses Svelte 5 runes (`$state`, `$derived`, `$effect`)

### File Organization

```
hamba/
├── backend/
│   └── src/
│       ├── index.ts              # Elysia server entry
│       ├── db/                   # Database & migrations
│       ├── routes/               # API routes
│       └── services/             # Business logic
│           └── providers/        # Email providers
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api.ts            # API client
│       │   ├── stores.ts         # Svelte stores
│       │   ├── keyboard.ts       # Keyboard shortcuts
│       │   └── components/       # UI components
│       └── routes/               # SvelteKit routes
```

### Testing

Tests live alongside source files:
- `stores.ts` → `stores.test.ts`
- `snippets.ts` → `snippets.test.ts`

**Frontend tests** use Vitest with jsdom:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('myFeature', () => {
  beforeEach(() => {
    // Reset state
  });

  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

**Backend tests** use Bun's built-in test runner:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("myFeature", () => {
  beforeEach(() => {
    // Set up test data
  });

  afterEach(() => {
    // Clean up
  });

  it("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

### Commit Messages

Use conventional commit format:

```
type(scope): description

[optional body]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(compose): add AI-powered email writing
fix(sync): handle expired OAuth tokens gracefully
docs(readme): add Docker deployment instructions
```

## Design Philosophy

Hamba is a Superhuman clone - **speed is critical**. Every contribution should consider:

1. **Optimize for perceived performance**
   - Use optimistic updates (update UI immediately, sync in background)
   - Prefetch data the user is likely to need
   - Move expensive operations to sync time, not render time

2. **Keep the UI responsive**
   - Never block the UI waiting for API responses
   - Show loading skeletons instead of spinners
   - Handle errors gracefully with retry options

3. **Keyboard-first**
   - All features should be accessible via keyboard
   - Add shortcuts for frequently used actions
   - Update `frontend/src/lib/keyboard.ts` for new shortcuts

## Pull Request Process

### Before Submitting

1. **Create a feature branch**
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes with clear commits**

3. **Ensure all checks pass**
   ```bash
   # Type checking
   cd frontend && bun run check

   # All tests
   ./test
   ```

4. **Test manually if needed**
   - Start both servers and verify your changes work
   - Check keyboard navigation
   - Verify no console errors

### Submitting a PR

1. Push your branch to your fork
2. Open a pull request against `master`
3. Fill out the PR template with:
   - Summary of changes
   - How to test
   - Screenshots (if UI changes)

### Review Process

- PRs require review before merging
- CI must pass (type check, tests, build)
- Respond to feedback promptly
- Squash commits if requested

## Database Migrations

When modifying the database schema:

1. Create a new migration:
   ```bash
   cd backend && bun run migrate:create add_my_table
   ```

2. Edit the generated file in `backend/src/db/migrations/`:
   ```typescript
   import { Database } from "bun:sqlite";

   export function up(db: Database): void {
     db.run(`
       CREATE TABLE my_table (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL
       )
     `);
   }

   export function down(db: Database): void {
     db.run("DROP TABLE IF EXISTS my_table");
   }
   ```

3. Run the migration:
   ```bash
   bun run migrate
   ```

4. Commit both the migration file and any code changes

## Adding a New Email Provider

To add support for a new email provider:

1. Create a new provider class in `backend/src/services/providers/`:
   ```typescript
   import type { EmailProvider, Email, SendOptions } from "./types";

   export class MyProvider implements EmailProvider {
     async getEmails(): Promise<Email[]> { /* ... */ }
     async sendEmail(options: SendOptions): Promise<void> { /* ... */ }
     // ... implement all interface methods
   }
   ```

2. Update the provider factory in `backend/src/services/providers/index.ts`

3. Add OAuth routes if needed in `backend/src/routes/`

4. Update the frontend account setup flow

5. Add tests and documentation

## Reporting Issues

### Bug Reports

When reporting bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Bun version, browser)
- Console errors or logs
- Screenshots if applicable

### Feature Requests

When requesting features:

- Describe the use case
- Explain how it fits Hamba's keyboard-first philosophy
- Suggest keyboard shortcuts if applicable
- Reference Superhuman or other email clients if relevant

## Getting Help

- Check existing [issues](https://github.com/yourusername/hamba/issues)
- Read the [README](README.md) and [API docs](http://localhost:3001/docs)
- Review [CLAUDE.md](CLAUDE.md) for architecture details

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
