# Task 0033: `gdrive cp -r`

Status: todo (move to `tasks/archive/` when done)
Depends on: 0027 — the walk must copy a shortcut without following it
([`0031`](../decisions/0031-recursive-copy.md) §2), which needs `shortcut` to
exist as a `FileType`.
Parallel: no — it changes `lib/output.ts` (the error envelope) and
`commands/cp.ts`, and 0027 also touches `commands/cp.ts`.

## Goal

`gdrive cp -r <folder> <dest>` reproduces a folder tree in one invocation, and
when it cannot finish, says exactly how far it got.

## Context

- Decision: [`0031`](../decisions/0031-recursive-copy.md). §3 and §4 are a pair
  — stopping early is only defensible because the report is complete, so do not
  implement one without the other.
- [`0007`](../decisions/0007-output-and-errors.md)'s error envelope gains an
  optional `data`. That change is recorded in
  [`0031`](../decisions/0031-recursive-copy.md) §4 and nowhere else: 0007 is not
  edited ([`0032`](../decisions/0032-decisions-are-append-only.md)).
- Prior art: `sharedDriveHint` in `lib/resolve-path.ts` is §1's pattern —
  a hint computed only after the real operation failed, which must never replace
  the caller's error when the hint's own lookup fails.
- [`0025`](../decisions/0025-shortcuts.md) §1's entry rule is why the walk
  copies a shortcut rather than following it.

## Scope

- `src/lib/output.ts` — `renderError` accepts an optional `data`.
- `src/types/index.ts` — `AppError` carries optional partial-result data, or a
  sibling error type does; pick one and keep `AppError`'s existing call sites
  untouched.
- `src/lib/api.ts` — a retry wrapper for the walk's calls (§5), scoped so no
  existing caller starts retrying.
- `src/lib/copy-tree.ts` — the walk itself. New file: it is the piece worth
  testing without a command around it.
- `src/commands/cp.ts` — `-r`, the destination-ancestor check, the folder hint.

## Out of scope

- Resume, parallelism, general CLI-wide retry, copying permissions — all
  deferred in 0031.

## TDD plan

1. **The envelope** (`lib/output.ts`, `types/`)
   - **Red** — an error with partial data renders
     `{success: false, error: {...}, data: {...}}`; an error without it renders
     exactly today's two-key object, so every existing error test still passes
     unchanged; text mode prints the message and the summary; quiet prints the
     ids copied so far, one per line.
   - **Green** — implement.
   - **Refactor** — the existing `renderError` signature should stay usable
     without the new argument.

2. **The walk** (`lib/copy-tree.ts`) — pure of commander, driven by an injected
   client.
   - **Red (shape)** — a two-level tree copies as folders-before-contents, and
     the returned report lists every folder and file with `src`, `dst` and
     `name`; an empty folder copies as an empty folder; the top-level copy takes
     `--name` when given and the source's name otherwise.
   - **Red (shortcuts, §2)** — a shortcut to a folder inside the tree is copied
     as a shortcut and its target's contents are **not** copied; a shortcut to a
     file likewise.
   - **Red (failure, §3)** — a `files.copy` that fails part-way stops the walk,
     and the thrown error carries every folder and file completed before it plus
     the one that failed; nothing after the failure is attempted (assert the
     call count).
   - **Red (retry, §5)** — a 429 followed by a success is retried and does not
     appear in the report as a failure; a bounded number of consecutive 429s
     gives up and stops like any other failure; a 403 is **not** retried.
   - **Green** — implement.
   - **Refactor** — keep backoff injectable so tests do not sleep.

3. **The command** (`commands/cp.ts`)
   - **Red (§6)** — `cp -r A A` and `cp -r A A/B` fail `INVALID_ARGS` before any
     copy happens (assert no write calls); a destination that merely shares a
     name with an ancestor does not trip it.
   - **Red (§1)** — `cp <folder> <dest>` without `-r` fails with a message
     naming the folder and `-r`; the metadata fetch happens only on the failure
     path (assert the call count on a successful file copy); when that fetch
     itself fails, the caller sees Drive's original error, not a hint error.
   - **Red** — `cp -r <file> <dest>` copies the file normally.
   - **Green** — implement.

4. **Docs**
   - No decision file is edited
     ([`0032`](../decisions/0032-decisions-are-append-only.md)). 0031 already
     records the envelope's optional `data` (§4) and that 0008 noted `cp`
     without its folder limit; 0007 and 0008 stay as written.
   - `docs/commands.md` — `cp -r`, the partial-result envelope, and the fact
     that a stopped run leaves a valid partial subtree.
   - `README.md` — the Drive highlight line.

## Acceptance criteria

- [ ] `gdrive cp -r "Reports/2026" Archive` produces `Archive/2026` with the
      whole tree, and quiet prints the new top folder id
- [ ] `gdrive cp "Reports/2026" Archive` (no `-r`) fails naming the folder and
      `-r`, and an ordinary file copy still costs one API call
- [ ] A shortcut inside the tree is copied as a shortcut; the folder it points
      at is not copied
- [ ] A copy that fails part-way exits non-zero and its JSON carries `data`
      with every folder and file already created
- [ ] `gdrive cp -r A A/B` fails before copying anything
- [ ] Every pre-existing error-envelope test passes unchanged
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated, in the same pull request as the
      code ([`0033`](../decisions/0033-implementation-lands-through-review.md) §1)

## Verification

- `bun run test src/lib/copy-tree.test.ts` — the walk, including the failure and
  retry cases
- `bun run test src/commands/cp.test.ts` — the flag, the hint, the cycle guard
- `bun run test src/lib/output.test.ts` — the envelope, old and new shapes
- Manual, against a real account: copy a folder holding a subfolder, a Doc, a
  binary file and a shortcut. Then revoke access to one file mid-tree and
  re-run, to see a real partial report. The rate-limit retry is the one thing
  neither a fake nor a small manual tree will exercise — note that in the task's
  outcome rather than claiming it was verified.
