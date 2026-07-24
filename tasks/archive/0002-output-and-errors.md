# Task 0002: Output & error core

Status: done
Depends on: 0001
Parallel: yes (group A) — alongside 0003

## Goal

The IO core: `lib/output.ts` renders success/error in text, JSON, and quiet
modes; `lib/input.ts` reads a literal / `@file` / `-` (stdin) argument;
`lib/fs.ts` defines the injectable `FsAdapter`; a top-level error handler maps
`ErrorCode` → exit code. Per `decisions/0007`, `0012`, `0013`.

## Context

- Relevant decisions: `decisions/0007-output-and-errors.md`,
  `decisions/0012-testing-strategy.md`, `decisions/0013-architecture.md`
- Adapt from gcal-cli's `src/lib/output.ts` (`../gcal-cli` or clone — see
  `decisions/README.md`).

## Scope

- `src/lib/output.ts` — text/json/quiet renderers + error envelope.
- `src/lib/input.ts` — literal / `@file` / `-` reader (stdin injected for tests).
- `src/lib/fs.ts` — `FsAdapter` interface + `node:fs` implementation (0012).
- `src/types/index.ts` — `ErrorCode` union, envelope types, `AppError { code,
  message }`, `errorToExit(code)`.

## Out of scope

- `lib/config.ts` (0003), command-specific formatters (live with each command).

## TDD plan

1. **Red** — `output.test.ts`: success text vs `{success:true,data}`; error
   text to stderr vs `{success:false,error:{code,message}}`; quiet suppresses
   decoration; `errorToExit` maps each ErrorCode to 1/2/3.
   `input.test.ts`: literal passthrough; `@file` read via fake fs; `-` reads
   injected stdin; missing file → `IO_ERROR`.
2. **Green** — implement renderers + reader + mapper.
3. **Refactor** — shared serializer.

## Acceptance criteria

- [x] Text, JSON, quiet renderers behave per 0007
- [x] `lib/input.ts` handles literal / `@file` / `-`; errors are `IO_ERROR`
- [x] Every `ErrorCode` maps to the correct exit code
- [x] JSON mode ignores `--quiet`
- [x] `bun run test`, `bun run typecheck` pass

## Verification

- `bun run test src/lib/output.test.ts`
