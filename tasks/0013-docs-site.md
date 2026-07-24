# Task 0013: README & user docs

Status: todo
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

- [ ] Every command documented with an example and its JSON shape
- [ ] Google Cloud setup + scopes explained
- [ ] Multi-account workflow (`auth`, `account use`, `-a`) documented
- [ ] Install (npm / npx / binary) documented

## Verification

- Run each documented example against a test account
