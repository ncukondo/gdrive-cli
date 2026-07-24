# Task NNNN: <title>

Status: todo | in-progress | done (move to `tasks/archive/` when done)
Depends on: <task numbers or —>
Parallel: <yes (worktree-safe) / no> — <which tasks it can run alongside>

## Goal

<One or two sentences: the observable outcome of this task.>

## Context

- Relevant decisions: `decisions/NNNN-*.md`, …
- Relevant docs: `docs/…`
- <Anything else a fresh worktree needs to know.>

## Scope

- <Files/modules this task owns. Keep disjoint from parallel tasks.>

## Out of scope

- <Explicitly deferred work, with the task that owns it if known.>

## TDD plan

1. **Red** — write failing tests for: <cases, including error cases>
2. **Green** — implement the minimum to pass.
3. **Refactor** — <known cleanups; keep tests green>.

Repeat per sub-feature; commit at green points.

## Acceptance criteria

- [ ] <User-observable behavior 1>
- [ ] <Error case handled with a clear message>
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] Affected docs updated

## Verification

- `bun run test <path>` — <what it covers>
- <Manual check if any, e.g. run against a real account>
