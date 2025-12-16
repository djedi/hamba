# Complete a task from TODO.md

## 0. Check usage (if running in batch mode)

- If daily or weekly usage is > 80%, stop immediately and inform the user
- This prevents exhausting API limits during automated task runs

## 1. Select task

- Read TODO.md and identify the next uncompleted task (marked with `- [ ]`)
- Understand the requirements before starting

## 2. Implement

- Explore relevant code to understand existing patterns
- Implement the feature/fix following project conventions
- Write unit tests for new functionality (tests live next to source files: `foo.ts` → `foo.test.ts`)
- Optimize for speed - this is a Superhuman clone where perceived performance is critical
- Use optimistic updates, prefetching, and background processing where applicable

## 3. Verify

- Run type checking: `cd frontend && bun run check`
- Run tests: `/Users/dustin/sd/src/hamba/test`
- Test manually if needed (backend: `cd backend && bun run dev`, frontend: `cd frontend && bun run dev`)
- Ensure no regressions in existing functionality

## 4. Review

- Self-review the changes for:
  - Security issues (XSS, injection, etc.)
  - Performance concerns
  - Code clarity and maintainability
  - Consistency with existing codebase patterns
- Update documentation if applicable:
  - CLAUDE.md: Add new commands, patterns, or architectural changes
  - README.md: Update user-facing docs (features, setup, usage)

## 5. Commit

- Mark the task complete in TODO.md (change `[ ]` to `[x]`)
- Stage all changed files
- Create a commit with a clear message describing the change
