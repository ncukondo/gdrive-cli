# Task 0002: Output & error core

Status: todo
Depends on: 0001
Parallel: yes (group A) — alongside 0003

## Goal

`lib/output.ts` renders success/error in text, JSON, and quiet modes, and a
top-level error handler maps `ErrorCode` → exit code, per `decisions/0007`.

## Context

- Relevant decisions: `decisions/0007-output-and-errors.md`
- Adapt from gcal-cli's `src/lib/output.ts`.

## Scope

- `src/lib/output.ts`, `src/types/index.ts` (ErrorCode union, envelope types),
  a small `AppError { code, message }` class and `errorToExit(code)`.

## Out of scope

- `lib/config.ts` (0003), command-specific formatters (live with each command).

## TDD plan

1. **Red** — `output.test.ts`: success text vs `{success:true,data}`; error
   text to stderr vs `{success:false,error:{code,message}}`; quiet suppresses
   decoration; `errorToExit` maps each ErrorCode to 1/2/3.
2. **Green** — implement renderers + mapper.
3. **Refactor** — shared serializer.

## Acceptance criteria

- [ ] Text, JSON, quiet renderers behave per 0007
- [ ] Every `ErrorCode` maps to the correct exit code
- [ ] JSON mode ignores `--quiet`
- [ ] `bun run test`, `bun run typecheck` pass

## Verification

- `bun run test src/lib/output.test.ts`
