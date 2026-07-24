# Task 0001: Project setup & tooling

Status: todo
Depends on: —
Parallel: no — foundation for everything

## Goal

A buildable, testable TypeScript/Bun project skeleton with the tech stack from
`decisions/0002` and a stub `gdrive --version` / `--help` that exits cleanly.

## Context

- Relevant decisions: `decisions/0002-tech-stack.md`, `decisions/0001-development-process.md`
- Mirror gcal-cli's `package.json`, `tsconfig.json`, `vitest.config.ts` layout.

## Scope

- `package.json` (bin `gdrive`, scripts from 0002), `tsconfig.json`,
  `vitest.config.ts`, `.gitignore`, `.oxlintrc`/oxfmt config, husky hook.
- `src/index.ts` (commander program: `--version`, `--help`, global options
  `-a/--account`, `-f/--format`, `-q/--quiet`, `--config`).
- `src/commands/index.ts` (empty registry), `src/types/index.ts` (ErrorCode).

## Out of scope

- Any real command logic (later tasks).

## TDD plan

1. **Red** — `src/index.test.ts`: program exposes `--version` matching
   package.json; unknown command exits 3.
2. **Green** — wire commander with global options and version.
3. **Refactor** — extract program factory for testability.

## Acceptance criteria

- [ ] `bun run dev -- --version` prints the version
- [ ] `bun run dev -- --help` lists global options
- [ ] Unknown command exits 3 (`INVALID_ARGS`)
- [ ] `bun run test`, `bun run typecheck`, `bun run lint` pass
- [ ] README stub exists

## Verification

- `bun run test src/index.test.ts`
