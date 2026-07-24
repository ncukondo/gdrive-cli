# Task 0014: Share / permissions commands

Status: todo
Depends on: 0006
Parallel: yes (group C) — alongside 0009 / 0010

## Goal

`gdrive share list|add|remove|link` for managing file permissions, per
`decisions/0011`.

## Context

- Relevant decisions: `decisions/0011-sharing-commands.md`, `decisions/0007-output-and-errors.md`
- Uses the existing `drive` scope (no new scope).

## Scope

- `src/lib/api.ts` permission methods (`permissions.list/create/delete`) +
  grantee→type inference.
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

- [ ] `list/add/remove/link` behave and format per 0011
- [ ] Grantee type inference and role defaults correct
- [ ] `remove` works by email and by permission id
- [ ] `bun run test`, `bun run typecheck` pass; docs updated

## Verification

- `bun run test src/commands/share/*.test.ts`
