# Task 0021: `drive:<name>/<path>` in every command that takes a path

Status: done
Depends on: — (stacked on 0020 only for the `decisions/` and `tasks/` index
tables)
Parallel: no — owns `src/lib/resolve-path.ts` and touches the drive-name lookup
in `src/lib/api.ts`.

## Goal

`gdrive ls "drive:専門医部会/部門用フォルダ"` lists that folder, and the same
prefix works in `info`, `download`, `mv`, `cp`, `rm`, `share`, `docs`, and
`sheets`, because they all resolve through one injected `resolvePath`. A My
Drive path whose first segment names a shared drive says so instead of a bare
`No such file or folder`.

## Context

- [issue #5](https://github.com/ncukondo/gdrive-cli/issues/5).
- Relevant decisions: `decisions/0019` (this change), `decisions/0016` §3 (which
  it supersedes) and §2 (the `includeItemsFromAllDrives` reasoning it reuses),
  `decisions/0008` (addressing), `decisions/0013` (module graph),
  `decisions/0012` (fakes, no network).
- Relevant docs: `docs/commands.md` addressing + shared-drive sections,
  `README.md`.

## Scope

- `src/lib/resolve-path.ts` — the `drive:` branch, the walk from a drive root,
  `includeItemsFromAllDrives`, the failed-first-segment hint.
- `src/lib/api.ts` — extract `resolveDriveByName` from `resolveDriveScope`.
- `decisions/0016`, `decisions/0019`, `decisions/README.md`,
  `docs/commands.md`, `README.md`.

## Out of scope

- Removing `ls --drive` / `search --drive` (decision 0019 §5 keeps both).
- A `drive:` spelling for IDs, and escaping a `/` inside a drive name — the
  root ID from `gdrive drives` is the answer for both.
- `info` reporting a drive root's name as `Drive` (issue #6, next task).

## TDD plan

1. **Red** — `src/lib/resolve-path.test.ts`:
   - `drive:Finance` → the drive's root ID, with no `files.list` at all;
   - `drive:Finance/2026/Budget` → walks from the root ID, and the query for
     the first segment pins that ID as the parent;
   - an unknown drive name → `NOT_FOUND` listing the available names;
   - a duplicated drive name → `INVALID_ARGS` listing the IDs;
   - `drive:` and `drive:/x` → `INVALID_ARGS`;
   - a My Drive path is unchanged: no `drives.list` call on the success path;
   - `childrenNamed` sends `includeItemsFromAllDrives: true`.
2. **Red** — the hint: a first segment that misses in My Drive *and* names a
   shared drive → `NOT_FOUND` whose message contains `drive:<name>/…`; the same
   miss with no such drive → the original message, unchanged; a `drives.list`
   that throws on the hint path → still the original `NOT_FOUND`, not the
   drive error.
3. **Green** — extract `resolveDriveByName`, add the prefix branch, then the
   hint.
4. **Refactor** — keep `resolvePath` one function with one loop; the drive
   branch only chooses the starting parent.

## Acceptance criteria

- [x] `drive:<name>` resolves to the drive root without listing files
- [x] `drive:<name>/a/b` walks inside the drive
- [x] Unknown / ambiguous / empty names error exactly as `--drive` does
- [x] A plain My Drive path issues no extra API call on success
- [x] The first-segment hint fires only when a drive of that name exists, and
      never replaces the error when the lookup itself fails
- [x] `docs/commands.md` no longer says paths cannot reach a shared drive
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`

## Outcome notes

- The drive branch only chooses a starting `parentId` and an error-message
  label; the walk itself is untouched, which is why `mv`, `cp`, `--parent`, and
  the `docs`/`sheets` file arguments got the syntax without any edit of their
  own.
- `drive:/2026` had to be split *before* dropping empty segments, or it reads
  as the drive named `2026`. That is now a comment and a test, because the
  filter-then-destructure version looks correct.
- The hint calls `listSharedDrives` inside a `try` that swallows everything.
  Losing a hint is nothing; losing the caller's `NOT_FOUND` and reporting a
  drive-listing failure instead would be a worse error than the one we started
  with. The tree fake's default `drives.list` throws, so that path is covered.
- `createTreeDrive` grew an optional `drives` argument rather than a second
  fake, so the "no drives.list on a plain path" assertion stays free: the
  default fake still throws if a stray lookup happens.

## Verification

- `bun run test:unit` (432 passed), `typecheck`, `lint`, `lint:casts`,
  `format:check`.
- **Verified against the `専門医部会` shared drive**, read-only: `ls drive:名前`,
  a two- and a three-level walk, `info` by `drive:` path, an unknown drive name
  (`NOT_FOUND` listing all eight), `drive:` alone (`INVALID_ARGS`), and the
  hint on a bare path. Bare `ls -q` on My Drive still returns the same 92 IDs
  task 0018 recorded, so the default is untouched.
- That settles the inference this task was written on: a `'<parent>' in
  parents` query with `includeItemsFromAllDrives` and no `corpora` really does
  return children inside a shared drive. It is now observed, not assumed.
- The manual pass caught a missing period — the hint read `専門医部会 A shared
  drive has that name` — which no unit test would have failed on, since they
  assert `toContain`.
