# Task 0020: `share add --role organizer | fileOrganizer`

Status: done
Depends on: — (stacked on 0019 only to avoid conflicting edits in the
`decisions/` and `tasks/` index tables)
Parallel: yes (worktree-safe) — owns `src/commands/share/*`; its only shared
file is the `ShareRole` line in `src/types/index.ts`.

## Goal

`gdrive share add <drive root or file ID> --to alice@example.com --role
organizer` promotes a shared-drive member, instead of failing `--role` parsing.
`share link` keeps the three roles an anyone-with-link permission can hold.

## Context

- [issue #4](https://github.com/ncukondo/gdrive-cli/issues/4).
- Relevant decisions: `decisions/0018` (this change), `decisions/0011` (the
  command surface it revises), `decisions/0016` §3 (a drive's root ID is a file
  ID, which is what makes drive-level membership reachable at all),
  `decisions/0014`.
- Relevant docs: `docs/commands.md` (`share add` / `share link` tables).

## Scope

- `src/types/index.ts` — `ShareRole`.
- `src/commands/share/add.ts` — `parseShareRole`, the `--anyone` guard, help
  text.
- `src/commands/share/link.ts` — `parseLinkRole`, help text.
- `decisions/0011`, `decisions/0018`, `decisions/README.md`,
  `docs/commands.md`.

## Out of scope

- Pre-checking that the target is on a shared drive (decision 0018 §3 — it
  would cost a `files.get` on every grant).
- Ownership transfer, capabilities, expiration times (still 0011).
- A dedicated membership subcommand; the drive root ID is the file argument.

## TDD plan

1. **Red** — `src/commands/share/add.test.ts`: `parseShareRole` accepts
   `organizer` and `fileOrganizer` (exact camelCase) and still rejects `owner`,
   `fileorganizer`, and `editor`; `handleShareAdd --anyone --role organizer` is
   `INVALID_ARGS` naming the roles it can take; a `--to` + `organizer` grant
   reaches `createPermission` with `role: "organizer"`.
2. **Red** — `src/commands/share/link.test.ts`: `--role organizer` is
   `INVALID_ARGS`; the three original roles still work.
3. **Green** — widen `ShareRole`, split the parser in two, add the guard.
4. **Refactor** — keep one `VALID_ROLES` list per parser, no re-export of a
   renamed `parseRole` (nothing outside `share/` imports it).

## Acceptance criteria

- [x] `share add --role organizer` / `--role fileOrganizer` reach the API
- [x] `--anyone` with either is `INVALID_ARGS`, not a Google 400
- [x] `share link --role organizer` is `INVALID_ARGS`
- [x] `--role owner` is still rejected with its own message
- [x] `docs/commands.md` lists five roles for `add`, three for `link`
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`

## Outcome notes

- `parseRole` became two functions rather than one with an allow-list
  parameter. Both call sites are fixed and known, and the split puts the reason
  in the name: `parseLinkRole` is the one that cannot widen without breaking
  what an `anyone` permission is.
- The `--anyone` guard duplicates what `parseLinkRole` enforces for `share
  link`, because `share add --anyone` reaches the same impossible permission by
  a different route. Both messages name the three roles that do work.
- Nothing was needed in `lib/api.ts`: `PermissionCreateInput.role` is typed
  `ShareRole`, so widening the type widened the wire format, and `share list`
  already read arbitrary role strings back.

## Verification

- `bun run test:unit` (419 passed), `typecheck`, `lint`, `lint:casts`,
  `format:check`.
- **Not** verified against a live shared drive: the manual pass would grant a
  real role to a real address on a real drive, and no disposable grantee was at
  hand. What that would have caught and the tests do not: whether Drive accepts
  `organizer` on a drive **root** ID through `permissions.create` the same way
  it does on a folder inside the drive. The roles themselves are unambiguous;
  the root-as-file-ID route is the assumption carried from decision 0016 §3.
