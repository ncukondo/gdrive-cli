# Task 0034: `gdrive rename <file> <name>`

Status: todo (move to `tasks/archive/` when done)
Depends on: — (0027's `resolveTarget` and the `shortcut` type are already on main)
Parallel: yes (worktree-safe) — a new `commands/rename.ts` and one method in
`lib/api.ts`. 0032 owns `commands/slides/` and 0033 owns `commands/cp.ts` and
`lib/output.ts`, so the three touch no file in common except the append-only
registration in `commands/drive-write.ts` and the shared docs.

## Goal

`gdrive rename <file> <name>` changes a file's Drive name, on every file type
alike.

## Context

- Decisions: [`0052`](../decisions/0052-rename.md) §1 (a separate verb rather
  than a second meaning for `mv`) and §2 (the argument takes the **entry** role
  of [`0025`](../decisions/0025-shortcuts.md) §1, so renaming a shortcut renames
  the shortcut). §3 is **withdrawn** by
  [`0053`](../decisions/0053-a-form-rename-reaches-everything.md) — read that one
  first, since it removes a whole stage this task originally had.
- [`0008`](../decisions/0008-drive-commands.md) has the file object this returns.
  Do **not** edit it, or any other committed record
  ([`0032`](../decisions/0032-decisions-are-append-only.md) §3).
- 0052's `Context` says a Drive rename reaches the in-document title for a Doc, a
  Sheet and a deck but not for a form. The first three hold; the fourth was read
  the instant after the write and did not wait for it. 0053 carries the corrected
  measurement.

## Scope

- `src/lib/api.ts` — one `renameFile`, beside `trashFile` and `copyFile`. It is a
  `files.update` carrying `name`, with `fields: FILE_FIELDS` and
  `supportsAllDrives: true` like every other write there.
- `src/commands/rename.ts` + its unit test.
- `src/commands/drive-write.ts` — one registration, append-only.
- `tests/integration/shortcut-roles.test.ts` — the entry-role case. This file is
  shared; add to it rather than restructuring it.
- `docs/commands.md`, `README.md`.

## Out of scope

- **Nothing about a form's `documentTitle`.** 0052's `Out of scope` called
  repairing it impossible; [`0053`](../decisions/0053-a-form-rename-reaches-everything.md)
  withdraws that — a rename repairs it, which is what this task ships, so there
  is neither work to defer nor an issue to file.
- **Renaming through `mv`.** 0052 §1 rejects it; do not add a second spelling.
- **An e2e case.** `tests/e2e/` still covers no write path beyond Drive's own
  ([issue #30](https://github.com/ncukondo/gdrive-cli/issues/30)), and this task
  does not close that; the manual pass below is what covers the live behaviour.

## TDD plan

1. **`renameFile`**
   - **Red** — `src/lib/api.test.ts`: the request body carries `name` and nothing
     else; `fields` and `supportsAllDrives` are sent; a 403 arrives as
     `PERMISSION_DENIED` carrying Drive's own message; the normalized file comes
     back. Add the call to the existing "supportsAllDrives is sent by every file
     operation" property test.
   - **Green** — implement it.
2. **The command**
   - **Red** — `src/commands/rename.test.ts`: a rename by id and by path; the new
     name reaches the API; text, JSON and quiet output; a name that is empty or
     only whitespace is `INVALID_ARGS` before any call is made.
   - **Red** — the entry role, in `tests/integration/shortcut-roles.test.ts`:
     `rename <link> <name>` renames the shortcut, and the target is not touched
     *as well* (assert the call count, as the neighbouring cases do).
   - **Green** — implement, registering in `drive-write.ts`.
3. **Docs**
   - `docs/commands.md` gains a `gdrive rename` section and a row in the shortcut
     role table's **entry** line; `README.md`'s Drive highlight gains `rename`.
   - `rename` behaves the same on every file type, so nothing per-type is said.
     [`0053`](../decisions/0053-a-form-rename-reaches-everything.md) withdrew
     0052 §3's form report: a Drive rename does reach a form's `documentTitle`,
     a few seconds later, and the measurement that said otherwise had read the
     field the instant after writing its source. §2 of that record also settles
     that the lag itself is not documented.

## Acceptance criteria

- [ ] `gdrive rename "Reports/Notes" "Notes 2026"` renames it, and
      `gdrive ls Reports` shows the new name
- [ ] `gdrive rename <shortcut> <name>` renames the shortcut; the target keeps
      its name
- [ ] An empty or whitespace-only `<name>` is `INVALID_ARGS` with no API call
- [ ] A Drive refusal reports Drive's own message and code
- [ ] Renaming a form, a Doc, a Sheet, a deck, a folder or a plain file behaves
      identically — one Drive call, no per-type branch anywhere
- [ ] Quiet prints the id; JSON carries the renamed file object
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran (`decisions/0043` §4).

- Automated: `bun run test src/commands/rename.test.ts src/lib/api.test.ts` — the
  command and the request. `bun run test tests/integration/shortcut-roles.test.ts`
  — the entry role. `bun run test:e2e` — nothing; this task adds no e2e file.
- Manual, against a real account: rename a Doc and confirm with `docs read` that
  the in-document title moved with it; rename a form and confirm that `ls` shows
  the new name and that the form is reachable by path. Read the form's
  `documentTitle` through the API **twice, seconds apart** — the first read can
  still show the old value, and it is the second that establishes the behaviour
  ([`0053`](../decisions/0053-a-form-rename-reaches-everything.md)'s closing
  section is there because one read was taken where two were needed). Also rename
  a shortcut and confirm its target keeps its name.

  This pass ran on 2026-08-06 against `task/0034-rename` and all of it held.
