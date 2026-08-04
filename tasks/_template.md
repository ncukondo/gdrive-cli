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

- <Explicitly deferred work. Each entry names a GitHub issue or says the work
  will not be done — a description with neither is what `decisions/0042` §2
  rules out.>

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

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test <path>` — <what it covers>. `bun run test:e2e` —
  <what this task adds to the live suite, or "nothing">.
- Manual, against a real account: <what needs a terminal, a browser, or a
  person's judgement — or "none, and why">.
