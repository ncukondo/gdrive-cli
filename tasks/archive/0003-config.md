# Task 0003: Config (TOML) & discovery

Status: done
Depends on: 0001
Parallel: yes (group A) — alongside 0002

## Goal

`lib/config.ts` loads `config.toml` per the resolution order in
`decisions/0006`, exposes defaults and the account/alias registry, and can
rewrite the accounts table (for `account alias` / `init`).

## Context

- Relevant decisions: `decisions/0006-configuration.md`
- Adapt from gcal-cli's `src/lib/config.ts` (uses `smol-toml`).

## Scope

- `src/lib/config.ts`: load/discover, typed `Config`, `resolveAlias(x)` ↔
  email lookup, `default_account`/`default_format`, safe write helpers.

## Out of scope

- Token storage (0004), account resolution priority incl. env/CLI (0004).

## TDD plan

1. **Red** — `config.test.ts` (inject fs): discovery order (CLI > env > local >
   default); parse `[[accounts]]`; alias↔email both directions; missing file →
   empty defaults; malformed TOML → `CONFIG_ERROR`.
2. **Green** — implement with `smol-toml`.
3. **Refactor** — separate discovery from parsing.

## Acceptance criteria

- [x] Resolution order honored
- [x] Alias ↔ email resolution both ways
- [x] Round-trip write preserves unrelated keys
- [x] Malformed config → `CONFIG_ERROR`
- [x] `bun run test`, `bun run typecheck` pass

## Verification

- `bun run test src/lib/config.test.ts`
