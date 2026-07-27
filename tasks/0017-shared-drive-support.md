# Task 0017: Shared drive support (`supportsAllDrives` + `ls`/`search` scope flags)

Status: in-progress (move to `tasks/archive/` when done)
Depends on: —
Parallel: no — owns `src/lib/api.ts`, which every command area calls.

## Goal

A shared-drive file **ID** works in every Drive command (`info`, `ls`,
`download`, `upload`, `mv`, `cp`, `rm`, `share`), and `ls`/`search` can be
widened to shared drives on request with `--all-drives` / `--drive <name>`.

## Context

- Issue: [#1 Shared drive files are invisible to every Drive API command][issue].
- Relevant decisions: `decisions/0016-shared-drive-scope.md` (written first —
  the `ls`/`search` default is a decision, not an implementation detail),
  `decisions/0008` (addressing), `decisions/0015` (no assertions; request params
  are checked against the generated types), `decisions/0012` (fakes, no network).
- Relevant docs: `docs/commands.md` (`ls` / `search` / "Addressing files"),
  `README.md`.
- Drive v3 scopes every request to My Drive unless `supportsAllDrives` is set;
  for *listing* it additionally needs `includeItemsFromAllDrives` + `corpora`.

[issue]: https://github.com/ncukondo/gdrive-cli/issues/1

## Scope

- `src/lib/api.ts` — `supportsAllDrives` on all 14 call sites; `ListParams`
  scope fields; `DriveClient.drives.list`; `listSharedDrives` /
  `resolveDriveScope`.
- `src/lib/google-clients.ts` — `drives.list` added to `GeneratedParamChecks`.
- `src/commands/ls.ts`, `src/commands/search.ts` — `--all-drives` / `--drive`.
- `src/commands/drive-read.ts` — wiring (resolve the scope before handling).
- `tests/helpers/fake-drive.ts` — the tree fake grows a `drives` member.
- `docs/commands.md`, `README.md`.

## Out of scope

- Path resolution across shared drives (`src/lib/resolve-path.ts`). Recorded as
  a follow-up on the issue and in `decisions/0016`; shared-drive files are
  addressed by ID for now.
- Widening the `ls`/`search` default to `allDrives` — decided against in 0016.

## TDD plan

1. **Red** — `src/lib/api.test.ts`:
   - every wrapper sends `supportsAllDrives: true` (one case per method:
     `listChildren`, `getFile`, `createFolder`, `copyFile`, `moveFile`,
     `trashFile`, `deleteFile`, `uploadMedia`, `downloadMedia`, `exportFile`,
     `listPermissions`, `createPermission`, `updatePermissionRole`,
     `deletePermission`);
   - `listChildren`/`searchFiles` send **no** `corpora` and no
     `includeItemsFromAllDrives` when no scope is given (the 0016 default);
   - `scope: {kind:"all"}` → `corpora: "allDrives"` + `includeItemsFromAllDrives`;
   - `scope: {kind:"drive", driveId}` → `corpora: "drive"` + `driveId`;
   - `listSharedDrives` follows pages;
   - `resolveDriveScope`: undefined for no flags; both flags → `INVALID_ARGS`;
     unknown name → `NOT_FOUND`; two same-named drives → `INVALID_ARGS` listing
     the IDs.
2. **Red** — `src/commands/ls.test.ts` / `search.test.ts`: a `scope` in deps
   reaches `listChildren` / `searchFiles`; the commands declare both flags.
3. **Green** — implement the minimum for each.
4. **Refactor** — one `applyScope` helper shared by `listChildren` and
   `searchFiles`; keep `mockDrive` in `api.test.ts` the single fake.

## Acceptance criteria

- [ ] `gdrive info <shared-drive-id>` returns metadata instead of `NOT_FOUND`
- [ ] `ls`/`search` results are unchanged when neither flag is given
- [ ] `--all-drives` and `--drive <name>` widen the scope; both together are
      `INVALID_ARGS`; an unknown drive name is `NOT_FOUND`; an ambiguous one is
      `INVALID_ARGS`
- [ ] No type assertions; `drives.list` is covered by `GeneratedParamChecks`
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run lint:casts`,
      `bun run format:check` pass
- [ ] `docs/commands.md` + `README.md` document the flags and state that
      shared-drive files are addressed by ID, not by path

## Verification

- `bun run test:unit` — the wrapper/param and scope-resolution cases above.
- Manual (read-only, real account): `gdrive info <id>` and
  `gdrive download <id> --export-as md` against a file on a shared drive; must
  not mutate anything.
