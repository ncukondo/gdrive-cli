# Task 0018: Close the shared-drive gaps found in review

Status: in-progress (move to `tasks/archive/` when done)
Depends on: 0017
Parallel: no — reopens `src/lib/api.ts` and `src/lib/resolve-path.ts`.

## Goal

Make `decisions/0016 §1` true as written: a shared-drive **ID** works in every
command that takes one, with no flag. Review found two ways it silently did
not, plus three smaller mismatches between the docs and the code.

## Context

- Review of `feature/shared-drive-support` (task 0017). Both defects surface as
  a **wrong success**, not an error, which is why the 0017 manual pass missed
  them.
- Relevant decisions: `decisions/0016` (revised by this task), `decisions/0008`
  (addressing + command table), `decisions/0015` (no assertions),
  `decisions/0012` (fakes, no network).
- Relevant docs: `docs/commands.md`, `README.md`.

## Scope

- `src/lib/api.ts` — `includeItemsFromAllDrives` for `listChildren`; drive-name
  error message; `listSharedDrives` hardening.
- `src/lib/resolve-path.ts` — `looksLikeId`; the 15th `files.list` call site.
- `src/commands/ls.ts` — reject a folder argument together with a scope flag;
  drop `--all-drives`.
- `src/commands/drives.ts` (new) + `src/commands/drive-read.ts` — `gdrive drives`.
- `src/types/index.ts` — `SharedDrive` joins the other domain types.
- `decisions/0016`, `decisions/0008`, `docs/commands.md`, `README.md`,
  `tasks/archive/0017-shared-drive-support.md` (call-site count).

## Out of scope

- Path resolution across shared drives — still deferred (issue #1).
- Remapping 403 to something other than `AUTH_REQUIRED`; widening `ShareRole`
  to `organizer`/`fileOrganizer`. Both are pre-existing and go to follow-up
  issues.

## TDD plan

1. **Red** — `src/lib/api.test.ts`: `listChildren` sends
   `includeItemsFromAllDrives: true` with **no** scope (this is the `ls <shared
   folder id>` bug); `searchFiles` still sends nothing without a flag;
   `resolveDriveScope` names the available drives in its `NOT_FOUND`;
   `listSharedDrives` skips id-less entries and maps a 403.
2. **Red** — `src/lib/resolve-path.test.ts`: `looksLikeId` accepts a 19-char
   shared drive root id (`0A` + 17) and still rejects a 19-char plain name;
   `resolvePath`'s `files.list` sends `supportsAllDrives`.
3. **Red** — `src/commands/ls.test.ts`: a folder argument plus a scope is
   `INVALID_ARGS` (replaces "still resolves an explicit folder under --drive",
   which pinned the broken behavior); `createLsCommand` no longer offers
   `--all-drives`.
4. **Red** — `src/commands/drives.test.ts`: table / JSON / quiet renderings and
   the empty case.
5. **Green** then **Refactor** — fold `ScopeOptions` into `DriveScopeArgs`,
   remove the unreachable branch in `resolveDriveScope`.

## Acceptance criteria

- [ ] `gdrive ls <shared-drive folder ID>` lists children with no flag
- [ ] `gdrive info <shared-drive root ID>` (19 chars) succeeds, and that ID is
      accepted anywhere a folder is (`--parent`, `mv`, `cp`)
- [ ] A folder argument together with `--drive` is `INVALID_ARGS` naming the fix
- [ ] `gdrive drives` lists name + ID in text / JSON / quiet
- [ ] An unknown `--drive` name lists the available drives
- [ ] `gdrive ls` with no arguments is byte-for-byte what it was before
- [ ] Every `files.list` call site sends `supportsAllDrives`, and the docs say
      exactly which call does not
- [ ] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`

## Verification

- `bun run test:unit`.
- Manual, **read-only** against the `専門医部会` shared drive: `ls` of a folder
  ID with no flag, `info` of the root ID, `drives`, the `--drive` + folder
  rejection, and an unchanged bare `ls`. No `upload`/`mkdir`/`mv` — the claim
  that a root ID can be a `--parent` is carried by the resolve-path unit tests.
