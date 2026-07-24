# Task 0010: Sheets commands

Status: todo
Depends on: 0006
Parallel: yes (group C) — alongside 0009

## Goal

`gdrive sheets tabs|read|write|append|clear|create` per `decisions/0010`.

## Context

- Relevant decisions: `decisions/0010-sheets-commands.md`, `decisions/0007-output-and-errors.md`

## Scope

- `src/lib/sheets-api.ts` (Sheets v4 wrapper + CSV/JSON/table codecs),
  `src/commands/sheets/*` (`index.ts`, `tabs.ts`, `read.ts`, `write.ts`,
  `append.ts`, `clear.ts`, `create.ts`), reusing the content reader from 0009.

## TDD plan

1. **Red** (fake Sheets client): `tabs` lists sheets; `read` A1/whole-tab with
   `--tab` and `--as table|csv|json`; `write` (RAW + `--input-mode user`);
   `append` rows; `clear`; `create --parent`; CSV/JSON value parsing incl.
   quoting; updated-cell counts; json shapes per 0010.
2. **Green** — implement wrapper + commands + codecs.
3. **Refactor** — extract CSV codec.

## Acceptance criteria

- [ ] All six subcommands behave and format per 0010
- [ ] Range/tab resolution and value encodings correct
- [ ] `bun run test`, `bun run typecheck` pass; docs updated

## Verification

- `bun run test src/lib/sheets-api.test.ts src/commands/sheets/*.test.ts`
