# Task 0006: Drive API wrapper & path resolution

Status: done
Depends on: 0004
Parallel: no — shared dependency of 0007/0008/0009/0010

## Goal

`lib/api.ts` wrapping Drive v3, and `lib/resolve-path.ts` implementing
ID-or-path addressing per `decisions/0008`.

## Context

- Relevant decisions: `decisions/0008-drive-commands.md`
- Adapt gcal-cli's `lib/api.ts` patterns (pagination, response normalization);
  `../gcal-cli` or clone — see `decisions/README.md`.

## Scope

- `src/lib/api.ts`: list children, get metadata, search, create folder, copy,
  move (update parents), trash/delete, media up/download, export; File
  normalization (mime → friendly `type`).
- `src/lib/resolve-path.ts`: ID detection, root-relative path walk, ambiguity →
  `INVALID_ARGS` with candidates, missing → `NOT_FOUND`.

## Out of scope

- Command wiring (0007/0008), Docs/Sheets APIs (0009/0010), sharing.

## TDD plan

1. **Red** (fake Drive client): pagination aggregates pages; File
   normalization; path walk resolves nested folders; ambiguous segment error;
   missing segment `NOT_FOUND`; ID passthrough.
2. **Green** — implement wrapper + resolver.
3. **Refactor** — isolate mime→type map.

## Acceptance criteria

- [x] List/search/get/create/copy/move/trash/delete/export covered
- [x] Path resolution handles nesting, ambiguity, and not-found
- [x] `bun run test`, `bun run typecheck` pass

Also smoke-tested live against real Drive: `listChildren`, `getFile`, and
`resolvePath` (by name, incl. spaces) against the authenticated account.

## Verification

- `bun run test src/lib/api.test.ts src/lib/resolve-path.test.ts`
