# Task 0016: Remove type assertions

Status: in-progress
Depends on: — (do this **before** 0015 googleapis upgrade; it is what makes the
bump compiler-checked)
Parallel: no — touches every command's client construction and most option
parsers

## Goal

No `as` / `as unknown as` / `<T>expr` / `!` assertions remain in `src/**` or
`tests/**` (`as const` and `satisfies` excepted), with CLI behavior — output,
error codes, messages, exit codes — unchanged, and a `lint:casts` check in CI
to keep it that way.

## Context

- Relevant decisions: `decisions/0015-no-type-assertions.md` (the five groups
  and the replacement pattern for each), `decisions/0012-testing-strategy.md`
  (fakes stay as they are), `decisions/0014-pre-1.0-compatibility.md`.
- `tasks/0015-googleapis-upgrade.md` deferred this and asked for exactly this
  task; its "the compiler will not catch a regression here" caveat is what
  step 4 below fixes.
- ~85 assertion sites; the count per file is in the git history of this task.

## Scope

- New: `src/lib/args.ts` (`parseChoice`), `src/lib/google-clients.ts`
  (`toDriveClient` / `toDocsClient` / `toSheetsClient`),
  `tests/helpers/mock.ts` (`firstCall`, `ExitSignal` exit mock).
- Edited: option parsers (`ls`, `download`, `docs/read`, `sheets/read`,
  `sheets/write`, `share/add`), boundary parsers (`lib/config.ts`,
  `lib/auth.ts`, `lib/sheets-api.ts`, `src/upgrade.ts`), `lib/api.ts` port +
  `normalizePermission`, `src/types/index.ts` (`errorToCode`),
  `lib/account.ts`, `lib/resolve-path.ts`, `commands/share/remove.ts`, the six
  client-construction sites, and the test files listed by `lint:casts`.
- `package.json` (`lint:casts`), `.github/workflows/ci.yml`.

## Out of scope

- The googleapis version bump itself — that stays task 0015.
- Any change to what a command prints or which error code it returns. The one
  deliberate behavior change is a corrupt token file now raising
  `AUTH_REQUIRED` instead of being trusted (decision 0015).

## TDD plan

Work in slices; each slice is Red → Green → commit.

1. **`parseChoice`** — Red: `src/lib/args.test.ts` for a valid value, an
   invalid value (exact message `Invalid --type "x". Use: a, b, c.`), and the
   returned type. Green: implement with `find`. Refactor: rewrite the six
   option parsers over it; their existing tests must stay green untouched.
2. **Boundary schemas** — Red: tests that a malformed config record, a corrupt
   token file, a malformed release payload, and a non-2-D JSON `--values`
   produce the documented `AppError` code/message. Green: zod schemas.
3. **Errors & index access** — Red (where not already covered): `errorToCode`
   on an error carrying a non-`ErrorCode` string `code`; `resolve-path`'s
   ambiguous-match branch. Green: narrowing checks, destructuring.
4. **Client adapters** — Red: `src/lib/google-clients.test.ts` asserting each
   adapter delegates to the injected API object (call-through, params
   forwarded, `data` returned). Green: the three adapters + the `files.get` /
   `getMedia` split and `responseType: "arraybuffer"` in the port; update
   `tests/helpers/fake-drive.ts` and the inline fakes. `bun run typecheck` is
   the real assertion here — it now checks our ports against `drive_v3` &c.
5. **Tests' own assertions** — mechanical: `firstCall`, `satisfies`,
   `ExitSignal`, `instanceof` in catch blocks, `Map` for fake stores.
6. **Guard** — `bun run lint:casts` fails on a re-introduced assertion (verify
   by adding one temporarily); wire into CI after `typecheck`.

## Acceptance criteria

- [ ] `bun run lint:casts` reports zero assertions in `src/**`, `tests/**`
- [ ] `bun run test:all`, `typecheck`, `lint`, `format:check` pass
- [ ] No diff in any command's output, error code, or exit code (unit +
      integration suites cover this; they are edited only where an assertion
      lived)
- [ ] `src/lib/google-clients.ts` is the only file importing `drive_v3`,
      `docs_v1`, or `sheets_v4` types
- [ ] `decisions/0015` linked from `decisions/README.md`; task 0015's
      "Out of scope" note updated to point here
- [ ] CI runs `lint:casts`

## Verification

- `bun run test:all` — the whole suite; behavior parity is the point
- `bun run typecheck` — now also checks the ports against googleapis
- `bun run dev -- ls` / `docs read` / `sheets read` against a real account —
  the adapters are the one runtime-shaped change
