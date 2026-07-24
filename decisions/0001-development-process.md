# 0001: Development process

Date: 2026-07-24
Status: accepted

## Context

We want to develop gdrive-cli incrementally, with independent units of work
that can proceed in parallel, and without a single living SPEC document that
drifts apart from the code. This mirrors the process proven in
[`yaml-form-cli`](https://github.com/ncukondo/yaml-form-cli).

## Decision

- **No living SPEC.** Design and process decisions are recorded per-topic in
  `decisions/` (this directory). User-facing behavior — the *what* — is
  documented in `docs/` and `README.md`. Input shapes are enforced by `zod`
  validation at the CLI boundary.
- **Task files** in `tasks/`, one per unit of work, created from
  `tasks/_template.md`. Tasks are written TDD-first (Red → Green → Refactor
  steps and acceptance criteria in the file). Completed task files move to
  `tasks/archive/` (keep the filename). `tasks/README.md` holds the current
  plan with `Depends on` / `Parallel group` / `Status`.
- **TDD is mandatory.** Each task lists the failing tests to write before
  implementation. A task is done only when its acceptance criteria are checked
  and `bun run test` + `bun run typecheck` pass.
- **Parallel development** with `git worktree` for tasks marked parallel-safe
  (disjoint file scopes). Dependencies are declared in each task file. Don't
  restate decisions in tasks — link to `decisions/NNNN-*.md`. If work reveals a
  needed decision change, record a new decision (or supersede an old one)
  first.
- **Docs are part of Definition of Done.** Any `docs/` or `README.md` update a
  task implies is part of that task, not an afterthought.
- **Commits**: frequent and small; specific `git add <file>` (never
  `git add -A`/`.`); messages in English.

## Consequences

- `decisions/` answers *why*; `docs/` + code answer *what*; task files are the
  work log and archive preserves history.
- New contributors (human or agent) start from `tasks/README.md`, pick a task,
  and read the linked decisions.
