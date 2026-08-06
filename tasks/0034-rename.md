# Task 0034: `gdrive rename <file> <name>`

Status: todo (move to `tasks/archive/` when done)
Depends on: — (0027's `resolveTarget` and the `shortcut` type are already on main)
Parallel: yes (worktree-safe) — a new `commands/rename.ts` and one method in
`lib/api.ts`. 0032 owns `commands/slides/` and 0033 owns `commands/cp.ts` and
`lib/output.ts`, so the three touch no file in common except the append-only
registration in `commands/drive-write.ts` and the shared docs.

## Goal

`gdrive rename <file> <name>` changes a file's Drive name, and when the file is a
form it says which title the rename did not reach.

## Context

- Decision: [`0052`](../decisions/0052-rename.md). §2 sends the argument to the
  **entry** role of [`0025`](../decisions/0025-shortcuts.md) §1 — renaming a
  shortcut renames the shortcut — and §3 decides the form report and where it
  travels.
- The `unsupported` channel is [`0021`](../decisions/0021-markdown-writes.md) §3;
  `reportUnsupported` lives in `src/lib/output.ts` and is already shared by
  `forms read` and `forms write`. Read `src/commands/forms/format.ts` for how a
  caller supplies its own `prefix` and `describe`.
- [`0008`](../decisions/0008-drive-commands.md) has the file object this returns.
  Do **not** edit it, or any other committed record
  ([`0032`](../decisions/0032-decisions-are-append-only.md) §3).
- The measurements behind 0052 are in its `Context`: a Drive rename reaches the
  in-document title for a Doc, a Sheet and a deck, and not for a form. They were
  taken on 2026-08-06 and are the reason §3 exists.

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

- **Repairing a form's `documentTitle`.** Impossible, not deferred —
  [`0052`](../decisions/0052-rename.md)'s `Out of scope` says why, and there is no
  issue because there is no work.
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
3. **The form report**
   - **Red** — renaming a file whose type is `form` reports through
     `reportUnsupported`: one line on stderr in text mode, an `unsupported` entry
     in JSON, and the rename still succeeds with exit 0. Renaming a Doc, a Sheet,
     a deck or a plain file reports nothing. No extra API call is made to decide
     it — assert that, because 0052 §3 chose the free answer deliberately.
   - **Green** — implement from the `mimeType` already on the response.
   - **Docs** — `docs/commands.md` gains a `gdrive rename` section and a row in
     the shortcut role table's **entry** line; `README.md`'s Drive highlight gains
     `rename`. Say what a form rename does and does not change, and that the
     editor's title cannot be repaired.

## Acceptance criteria

- [ ] `gdrive rename "Reports/Notes" "Notes 2026"` renames it, and
      `gdrive ls Reports` shows the new name
- [ ] `gdrive rename <shortcut> <name>` renames the shortcut; the target keeps
      its name
- [ ] An empty or whitespace-only `<name>` is `INVALID_ARGS` with no API call
- [ ] A Drive refusal reports Drive's own message and code
- [ ] Renaming a form succeeds **and** reports the unreached title; renaming a
      Doc, Sheet or deck reports nothing
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
  the new name, that the form is now reachable by path, and that `forms read`
  still reports the old `documentTitle` — which is the case the report exists for,
  and the one no fake can establish.
