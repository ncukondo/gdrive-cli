# gdrive-cli

CLI for Google Drive, Docs, and Sheets — read and simple edits — with
multi-account switching. Sibling of `gcal-cli`, designed for AI-agent use.

## Getting Started

- Read `decisions/README.md` for the design (source of truth for *why*).
- Read `tasks/README.md` for the current plan; pick a task, follow its TDD plan.
- User-facing behavior lives in `docs/` and `README.md`.

## Tech Stack (see `decisions/0002`)

Bun · TypeScript · commander · googleapis · smol-toml · zod · vitest · oxlint · oxfmt

## Commands

```bash
bun run dev            # run the CLI
bun run test           # all tests (vitest)
bun run test:unit      # src unit tests
bun run test:integration
bun run test:e2e       # requires auth
bun run lint / format / format:check / typecheck
```

## Development Rules (see `decisions/0001`)

- **No living SPEC**: record design in `decisions/NNNN-*.md`; document behavior
  in `docs/`; do work as `tasks/NNNN-*.md` files (TDD Red→Green→Refactor).
- **TDD**: failing test first, minimal code to pass, refactor green.
- **Commits**: small; specific `git add <file>` (never `-A`/`.`); English.
- **Parallel**: parallel-safe tasks use `git worktree`; deps declared per task.
- Docs updates are part of a task's Definition of Done.
