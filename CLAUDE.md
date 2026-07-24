# gdrive-cli

CLI for Google Drive, Docs, and Sheets — read and simple edits — with
multi-account switching. Sibling of `gcal-cli`, designed for AI-agent use.

## Getting Started

- Read `decisions/README.md` for the design (source of truth for *why*).
- Read `tasks/README.md` for the current plan; pick a task, follow its TDD plan.
- Architecture map: `decisions/0013`. Testing conventions: `decisions/0012`.
- User-facing behavior lives in `docs/` and `README.md`.

## Reference implementations (on disk)

Two sibling repos live next to this one and are required reading for tasks that
say "adapt from …":

- **`../gcal-cli`** — tech stack, `tsconfig.json`/`vitest.config.ts`, and the
  patterns to adapt for `lib/{output,config,auth,api}.ts` (tasks 0002/0003/0004/
  0006). Its `spec/` mirrors what our `decisions/` cover.
- **`../yaml-form-cli`** — the dev *process* this repo follows, plus
  `src/upgrade.ts` + `install.sh`/`install.ps1` to adapt for task 0012.

If a checkout lacks them, clone from their GitHub URLs (see
`decisions/README.md`). Our `decisions/` fully specify behavior; the siblings
are an accelerator, not a hard dependency.

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
