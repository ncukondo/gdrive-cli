# Task 0007: Drive read commands

Status: done
Depends on: 0006
Parallel: yes (group B) — alongside 0008

## Goal

`gdrive ls`, `search`, `info`, `download` per `decisions/0008`.

## Context

- Relevant decisions: `decisions/0008-drive-commands.md`, `decisions/0007-output-and-errors.md`

## Scope

- `src/commands/ls.ts`, `search.ts`, `info.ts`, `download.ts`.

## TDD plan

1. **Red** — `ls` lists folder children (root default), `--type`/`--trashed`/
   `-n`/`--order`; `search` by query; `info` metadata; `download` to `-o` file
   or stdout; Doc/Sheet `--export-as`; text/json/quiet shapes per 0007/0008.
2. **Green** — implement over `lib/api.ts`.
3. **Refactor** — shared file-row formatter.

## Acceptance criteria

- [x] Each command's text, JSON, quiet outputs match 0008
- [x] `download` streams to stdout when no `-o`; export formats work
- [x] `NOT_FOUND` / ambiguous path errors surface correctly
- [x] `bun run test`, `bun run typecheck` pass; docs updated

Live-verified against the authenticated account: `ls` (text/json/quiet, `--type`,
`-n`), `search`, `info` (by path), `download` (Sheet→CSV to file and to stdout),
and error cases (`NOT_FOUND` exit 1, `--export-as` on binary → `INVALID_ARGS`).

## Verification

- `bun run test src/commands/{ls,search,info,download}.test.ts`
