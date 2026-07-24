# Task 0007: Drive read commands

Status: todo
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

- [ ] Each command's text, JSON, quiet outputs match 0008
- [ ] `download` streams to stdout when no `-o`; export formats work
- [ ] `NOT_FOUND` / ambiguous path errors surface correctly
- [ ] `bun run test`, `bun run typecheck` pass; docs updated

## Verification

- `bun run test src/commands/{ls,search,info,download}.test.ts`
