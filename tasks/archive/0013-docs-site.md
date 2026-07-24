# Task 0013: README & user docs

Status: done
Depends on: 0012
Parallel: no

## Goal

Complete user-facing docs (`README.md` + `docs/`) covering install, Google
Cloud setup, multi-account usage, and every command.

## Context

- Relevant decisions: all; user-facing *what* lives in `docs/` per `0001`.

## Scope

- `README.md` (install/quickstart), `docs/commands.md`, `docs/configuration.md`,
  `docs/accounts.md`, `docs/authentication.md` — filled/verified against
  shipped behavior.

## TDD plan

- No unit tests; verification is doc-review + running each documented example.

## Acceptance criteria

- [x] Every command documented with an example and its JSON shape
- [x] Google Cloud setup + scopes explained
- [x] Multi-account workflow (`auth`, `account use`, `-a`) documented
- [x] Install (npm / npx / binary) documented

Notes / changes this task forced:

- `default_format` and `$GDRIVE_CLI_FORMAT` were parsed but never applied.
  Rather than document non-existent behavior, `resolveGlobalOptions` now falls
  back to them when `-f` is absent (a broken config is ignored there; the
  command's own `loadConfig` still reports it).
- Verifying `docs read` against a *real* formatted document (HTML uploaded with
  `--as-doc`) showed Docs reports no glyph information for converted lists, so
  numbered lists rendered as `-`. The renderer now also honors `glyphFormat` /
  `glyphSymbol`; where Docs reports nothing the bullet fallback stands, and
  that limit is documented.
- The ID heuristic (0008) treats any 20+ char `[A-Za-z0-9_-]` argument as an
  ID, which surprised a test folder named `gdrive-doc-check-388562`. Documented
  in the "Addressing files" section.

Verified live against the real account: every documented example for `ls`,
`search`, `info`, `download`, `upload`, `mkdir`, `mv`, `cp`, `rm`, all `share`,
`docs`, and `sheets` subcommands, plus `init`, `upgrade`, `auth status`, and
`account list` — text, `-q`, and `-f json` shapes all match what is written.
All test files were trashed afterwards.

## Verification

- Run each documented example against a test account
