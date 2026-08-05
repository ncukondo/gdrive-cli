# Task 0041: The rules a script cannot check move to where they are read

Status: todo
Depends on: —
Parallel: yes — alongside 0040, which owns the executable half of the same
decision. Disjoint scopes: this task writes only `CLAUDE.md` files and touches no
script, no hook and no workflow.

## Goal

Three directories gain a `CLAUDE.md` holding the conventions that govern them,
loaded at the moment a file there is edited. The root `CLAUDE.md` loses the two
blocks that copy `package.json`, one of which has been wrong since 2026-07-24.

## Context

- [`decisions/0045`](../decisions/0045-rules-are-executed.md) §3 and §4 are this
  task's whole brief: the two conditions a directory file must satisfy, and the
  test for whether a block is a copy.
- **The measurement that produced §4.** `scripts/lint-casts.ts` has run in
  `.github/workflows/ci.yml` since 2026-07-24. The root document's `## Commands`
  block has been edited seven times since — four of them on 2026-08-04, tuning
  the test lines directly above it — and has never listed `lint:casts`. A reader
  of that block cannot learn that a fifth check exists and gates CI.
- **Who reads what.** Claude Code loads a directory's `CLAUDE.md` when it touches
  a file there. A person does not, and neither does any other tool. So everything
  here is a just-in-time reminder for an agent; anything that must also hold for
  a human contributor belongs in a hook or in CI, which is task 0040's half.
- Conventions being relocated: [`0012`](../decisions/0012-testing-strategy.md)
  (fs and client injection, shared fakes),
  [`0013`](../decisions/0013-architecture.md) (the handler contract and the one
  sanctioned shared edit), [`0015`](../decisions/0015-no-type-assertions.md),
  [`0032`](../decisions/0032-decisions-are-append-only.md) §3–§4,
  [`0035`](../decisions/0035-docs-are-downstream.md),
  [`0036`](../decisions/0036-machine-format-by-default.md),
  [`0037`](../decisions/0037-tests-assert-behaviour.md) §1,
  [`0042`](../decisions/0042-deferred-work-is-an-issue.md) §2,
  [`0043`](../decisions/0043-e2e-runs-before-push.md) §5.

## Scope

- `src/CLAUDE.md`, `tests/CLAUDE.md`, `decisions/CLAUDE.md` — new.
- `CLAUDE.md` at the root — remove `## Commands` and `## Tech Stack`, keep the
  E2E paragraph that sits below the first of them.

Each new file is a short list of rules with a link to the record behind each. No
file list, no command table, no flag list, no dependency list — 0045 §3, and the
practical test is that adding a file to the directory must not make the document
wrong.

**`src/CLAUDE.md`** — the handler contract (validate with zod, call `lib/*`,
emit through `lib/output.ts`, never build JSON by hand, never call
`process.exit`, throw `AppError { code }`); `src/commands/index.ts` is the one
sanctioned shared edit and is append-only; the default output is the machine one
and text never aligns; no display width is computed anywhere.

**`tests/CLAUDE.md`** — a test asserts what the program does, never what it is
made of; fs through `FsAdapter`, Google clients injected into the `lib/*-api.ts`
wrappers, fakes shared from `tests/helpers/`; output correctness is asserted at
the renderer and E2E's subject is the boundary with Google; `docs/` is never a
fixture; when E2E fails, fix the implementation — do not mock around it, do not
adjust the expectation, do not skip it.

**`decisions/CLAUDE.md`** — append only, and read from the highest number down;
a committed file is never edited, so a change is a new number whose `Status`
names `revises` or `extends`; a new record needs its row in `README.md`; do not
write a `what` — a command table or an output shape belongs to `docs/` and the
code; every `Out of scope` entry names an issue or says the work will not be
done.

## Out of scope

- **`tasks/CLAUDE.md` and `docs/CLAUDE.md`.** Both came out at four to six lines,
  and `tasks/README.md` already opens with the same rules for the same reader.
  A near-empty file is the inventory problem in miniature: something to keep true
  that carries nothing. Will not be done unless a rule appears that is specific to
  those directories and not already in their `README.md`.
- **Moving the `what` out of decisions 0004, 0008–0011 and 0013.** 0045's
  `Out of scope` refuses this, and 0032 §3 forbids the edits it would take.
  `src/CLAUDE.md` carries 0013's *contract* and deliberately not its source tree
  map, which is the inventory that would go stale first.
- **Any hook, script or workflow.** Task 0040.
- **Restating a decision in full.** Each line is one sentence and a link. A
  directory file that grows into a summary is a second copy of a record that is
  already append-only and already readable.

## TDD plan

There is no code here, so the Red step is not a test file — it is the check that
each candidate line fails to belong somewhere better. Applied in order to every
line before it is written:

1. **Red — is it checkable?** If a script could decide it, it belongs in task
   0040 and not in a document (0045 §1). This removes `git add -A`, the landing
   path, the index row and the width rule from the prose; the width rule stays in
   `src/CLAUDE.md` as a statement of intent because an agent about to add a
   column needs the reason, not just the refusal.
2. **Red — is it an inventory?** If adding a file, a command or a dependency to
   the directory would make the line wrong, it does not go in (0045 §3).
3. **Red — is it needed here?** If it reads just as well from `decisions/`, it
   stays there. Background and history are not just-in-time.
4. **Green** — write the three files, one line per rule, each linking its record.
5. **Refactor** — the root document, once the three exist: remove the two copied
   blocks, and confirm what remains says nothing `package.json` also says. Then
   re-read `Getting Started`, which points at `decisions/0013` and `0012` for the
   architecture and testing conventions — the parts an agent needs at edit time
   now have a nearer home, and the pointer should say what each source is still
   for rather than duplicating the move.

## Acceptance criteria

- [ ] `src/CLAUDE.md`, `tests/CLAUDE.md` and `decisions/CLAUDE.md` exist, and no
      one of them contains a file list, a command table, a flag list or a
      dependency list
- [ ] Every rule in each file links the record it comes from
- [ ] Adding a new command file under `src/commands/` would not make
      `src/CLAUDE.md` wrong — checked by reading it against that hypothetical,
      not by adding one
- [ ] The root `CLAUDE.md` no longer names any `package.json` script or
      dependency, except that `changelog` takes a version
- [ ] The `pre-push` / `GDRIVE_CLI_E2E_FOLDER` paragraph survives intact — it is
      not a copy of anything and 0045 §4's test is what keeps it
- [ ] `bun run test` and `bun run typecheck` pass — no code changes, so this is a
      regression check on nothing, and a fast one
- [ ] `docs/` and the root `README.md` need no change, confirmed rather than
      assumed

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran ([`decisions/0043`](../decisions/0043-e2e-runs-before-push.md) §4).

- **Automated**: nothing meaningful. This task adds no code and no test, and
  saying so plainly is more useful than pointing at a suite that would pass
  whatever these files said.
- **Manual, and it is the whole verification**:
  1. Read each new file against 0045 §3's two conditions, line by line. A line
     that fails either is deleted, not reworded.
  2. In a live Claude Code session, edit a file under `src/` and confirm
     `src/CLAUDE.md` is loaded and its rules are visible to the agent. The files
     are worthless if the mechanism does not fire, and nothing in the repository
     can test that.
  3. Diff the removed root blocks against `package.json` one last time, to record
     in the outcome notes whether anything was in the prose that was not in the
     manifest. The expectation is that `lint:casts` was the only difference and it
     ran the wrong way.
