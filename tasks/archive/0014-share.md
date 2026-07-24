# Task 0014: Share / permissions commands

Status: done
Depends on: 0006
Parallel: yes (group C) — alongside 0009 / 0010

## Goal

`gdrive share list|add|remove|link` for managing file permissions, per
`decisions/0011`.

## Context

- Relevant decisions: `decisions/0011-sharing-commands.md`, `decisions/0007-output-and-errors.md`
- Uses the existing `drive` scope (no new scope).

## Scope

- `src/lib/api.ts` permission methods (`permissions.list/create/update/delete`)
  + grantee→type inference.
- `src/commands/share/*` (`index.ts`, `list.ts`, `add.ts`, `remove.ts`,
  `link.ts`).

## Out of scope

- Ownership transfer (`--role owner` / `share transfer`) — deferred per 0011.

## TDD plan

1. **Red** (fake Drive client): `list` returns permissions with ids/roles/types;
   `add --to/--domain/--anyone` infers type and sets role; `remove` by email or
   `--permission-id`; `link` ensures anyone-with-link and returns the URL;
   invalid grantee combos → `INVALID_ARGS`; text/json/quiet shapes per 0011.
2. **Green** — implement API methods + commands.
3. **Refactor** — extract grantee-inference helper.

## Acceptance criteria

- [x] `list/add/remove/link` behave and format per 0011
- [x] Grantee type inference and role defaults correct
- [x] `remove` works by email and by permission id
- [x] `bun run test`, `bun run typecheck` pass; docs updated

Notes:

- `--to` infers `group` only for `@googlegroups.com` addresses (Drive cannot
  classify an arbitrary address without a lookup); everything else is `user`.
- `share link` reuses an existing anyone-with-link permission and upgrades its
  role via `permissions.update` when `--role` differs — hence the extra
  `permissions.update` method beyond the three listed in the original scope.

Live-verified end-to-end against the real account (self-cleaning smoke test):
`share list`, `share link` (create, then role upgrade to writer), `share remove
--permission-id`, and the missing-grantee `INVALID_ARGS` guard. Note: deleting
the owner permission fails at the API with 403, which maps to `AUTH_REQUIRED`
(exit 2) via the shared error mapper from 0006.

## Verification

- `bun run test src/commands/share/*.test.ts`
