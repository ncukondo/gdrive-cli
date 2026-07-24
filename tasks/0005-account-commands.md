# Task 0005: Account commands

Status: todo
Depends on: 0004
Parallel: no

## Goal

`gdrive account list|use|alias|remove` for managing authenticated accounts and
aliases, per `decisions/0004` and `0006`.

## Context

- Relevant decisions: `decisions/0004-multi-account.md`, `decisions/0006-configuration.md`

## Scope

- `src/commands/account.ts` (subcommand group), reconciling token files
  (`accounts/*.json`) with `[[accounts]]` config entries.

## TDD plan

1. **Red** — `list` merges tokens + aliases, marks default; `use` rewrites
   `default_account`; `alias` assigns/renames; `remove` deletes token + alias
   entry; unknown account → `ACCOUNT_NOT_FOUND`.
2. **Green** — implement over `lib/config.ts` + `lib/account.ts`.
3. **Refactor** — shared account-listing helper.

## Acceptance criteria

- [ ] `account list` shows email, alias, default flag (text + JSON + quiet=email/line)
- [ ] `account use`/`alias` persist to config; `remove` cleans both sources
- [ ] `bun run test`, `bun run typecheck` pass; docs updated

## Verification

- `bun run test src/commands/account.test.ts`
