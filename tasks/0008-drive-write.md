# Task 0008: Drive write commands

Status: todo
Depends on: 0006
Parallel: yes (group B) — alongside 0007

## Goal

`gdrive upload`, `mkdir`, `mv`, `cp`, `rm` per `decisions/0008`.

## Context

- Relevant decisions: `decisions/0008-drive-commands.md`, `decisions/0007-output-and-errors.md`

## Scope

- `src/commands/upload.ts`, `mkdir.ts`, `mv.ts`, `cp.ts`, `rm.ts`.

## TDD plan

1. **Red** — `upload` with `--parent`/`--name`/`--as-doc`/`--as-sheet`;
   `mkdir` under parent; `mv` changes parents; `cp` copies with `--name`;
   `rm` trashes by default and `--permanent` deletes; quiet emits new/target ID;
   `IO_ERROR` on unreadable local file.
2. **Green** — implement over `lib/api.ts`.
3. **Refactor** — shared parent-resolution helper.

## Acceptance criteria

- [ ] All five commands' text/json/quiet outputs match 0008
- [ ] `rm` defaults to trash; `--permanent` deletes
- [ ] Path/ID addressing works for source and destination
- [ ] `bun run test`, `bun run typecheck` pass; docs updated

## Verification

- `bun run test src/commands/{upload,mkdir,mv,cp,rm}.test.ts`
