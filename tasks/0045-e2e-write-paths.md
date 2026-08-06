# Task 0045: The live suite reaches the write paths

Status: todo (move to `tasks/archive/` when done)
Depends on: — (everything it exercises is on main)
Parallel: yes (worktree-safe) — it owns `tests/e2e/` and nothing else. 0044 owns
`src/commands/` and a new lib; the two meet only in that 0044 changes behaviour
this suite will assert (see *Out of scope*).

## Goal

`tests/e2e/` covers the write paths that only Google can refuse — shortcuts,
Forms, Slides, and `cp -r` — so the next encoding defect fails a push instead of
a manual pass.

## Context

- Issue: [#30](https://github.com/ncukondo/gdrive-cli/issues/30).
- Decision: [`0043`](../decisions/0043-e2e-runs-before-push.md). §1 is the
  cadence, §2 the containment rule (one folder per run, kept when the file
  fails), §4 the separation from the manual pass. Nothing new is decided here —
  this task builds the layer 0043 already describes into the directory it named.
- [`0012`](../decisions/0012-testing-strategy.md)'s E2E policy is CRITICAL and
  reprinted by `.husky/pre-push` on failure: do not add mocks to bypass, do not
  change an expected value to match broken behaviour, do not skip or delete.
- `tests/e2e/helpers/sandbox.ts` is the whole apparatus — `describeLive`,
  `useSandbox`, `gdrive`, `gdriveAs`, `gdriveError`, `list`, `info`. Read it
  first. Responses are parsed with `zod` rather than asserted into shape
  ([`0015`](../decisions/0015-no-type-assertions.md)); follow that, because an
  assertion here would make the suite agree with whatever the CLI printed.
- `tests/e2e/sheets.test.ts` is the shortest existing file and the model to copy.

**Why these cases and not others.** Six write-side defects shipped past a full
unit suite this year and were caught by a person running the CLI by hand. Every
one was an encoding the API refuses and a fake accepts:

| Defect | What no fake could say |
|---|---|
| `value` sent beside `isOther` | the Forms API refuses the pair |
| `goToSectionId` copied into a new form | it is an item id from another form |
| `fileUploadQuestion` in a create | the API cannot create one |
| `documentTitle` unset at creation | Drive then calls the form `Untitled form` |
| `copyFile` sent with no name | Drive's default is `Copy of X` for a Doc and the original name for a binary |
| `cp -r /` | `resolvePath` answers `root`, `parents` carries the real id |

Aim the cases at that class. A test that only checks the CLI's own plumbing
belongs beside its source, not here.

## Scope

- `tests/e2e/shortcuts.test.ts`, `tests/e2e/forms.test.ts`,
  `tests/e2e/slides.test.ts` — new.
- `tests/e2e/drive.test.ts` — `cp -r` and `rename` cases added to the existing
  file, since they need the same fixtures it already builds.
- `tests/e2e/helpers/sandbox.ts` — only if a case genuinely needs a helper the
  file lacks. Prefer adding nothing.

## Out of scope

- **Anything needing a browser or a person.** A form response cannot be
  submitted from a CLI, so "a renamed question keeps its responses" stays in the
  manual pass, where task 0030's `Verification` already has it
  ([`0043`](../decisions/0043-e2e-runs-before-push.md) §4).
- **A mid-tree `cp -r` failure**, and the rate-limit retry. Neither can be
  arranged on an account that owns every file. Say so in the file rather than
  approximating it.
- **Widening `collectPages`' 10,000-child truncation** ([#32](https://github.com/ncukondo/gdrive-cli/issues/32)).
- **Making the suite fast.** `.husky/pre-push` runs it on every push and the
  existing three files already take about a minute; this task will roughly double
  that. If it goes past what a push can carry, say so in the report rather than
  trimming coverage to fit — that is a decision, not an implementation detail.

## TDD plan

The usual order does not apply: the code exists and passes. Write each case so
that it would have **failed before the fix that made it pass**, and say in the
file which defect it stands for. A case nobody can trace to a failure is a case
nobody will trust when it goes red.

1. **Shortcuts** — `ln` a seeded Doc, then: `ls` reports `type: shortcut` with
   `target_id` and `target_type: doc`; `docs read` through it by id and by path
   returns the target's body; `ln` a folder and list through the shortcut;
   `info` on the shortcut reports the shortcut, not the target; `rm` on it
   leaves the target alone.
2. **Forms** — `forms create --file` from a document holding an `other: true`
   option **and** a `file_upload` question: the create succeeds, the Other option
   reads back, the file-upload item is reported as skipped rather than killing
   the batch. `ls` names the form what `create` was told, not `Untitled form`.
   Then read a form with a page break and a branching option, `forms create` from
   that document, and assert no id of the source appears in the copy. Then a
   `--prune`-less deletion refusing with `PRUNE_REQUIRED` and writing nothing.
3. **Slides** — `slides create --file`, then a title-only edit leaves the body's
   text alone, and an edit to an `elements` entry is `INVALID_ARGS`. Formatting
   itself cannot be asserted through the CLI — `slides read` does not emit it —
   so assert what the CLI *can* see and leave the bold to the manual pass, saying
   so.
4. **`cp -r` and `rename`** — a tree with a subfolder, a Doc, a binary and a
   shortcut: every name survives the copy (the `Copy of` defect), the shortcut is
   copied as a pointer with its target unchanged, and the target folder is not
   copied. `cp -r /` is refused. A `rename` moves the Drive name, and a Doc's
   in-document title with it.

## Acceptance criteria

- [ ] Each new file works inside a sandbox from `useSandbox()` and names no path
      outside it
- [ ] Every case cites the defect or the decision clause it stands for
- [ ] `bun run test:e2e` passes against a real account, and the sandboxes are
      gone afterwards
- [ ] `bun run test` still excludes `tests/e2e/**` and is unaffected
- [ ] With `GDRIVE_CLI_E2E_FOLDER` unset the suite skips rather than fails
- [ ] `bun run typecheck`, `bun run lint`, `bun run format:check` pass

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test:e2e` against a real account — the whole point of the
  task. `bun run test` — unchanged, and must stay that way.
- Manual, against a real account: run the suite once with a deliberately broken
  build — revert one of the six fixes in the table above locally, confirm the
  matching case goes red, and restore it. A live suite nobody has seen fail is a
  live suite nobody knows is wired up; this is the one check that says it is.
  Also confirm a failing file leaves its sandbox behind and a passing run does
  not ([`0043`](../decisions/0043-e2e-runs-before-push.md) §2).
