# Task 0016: Remove type assertions

Status: done
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
  (`buildDriveClient` / `buildDocsClient` / `buildSheetsClient`),
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
4. **Client factories** — Red: `getFile` against a non-file payload must
   report `API_ERROR`. Green: `responseType: "arraybuffer"` in the port (which
   turns out to be the only thing blocking direct assignment, so no adapter
   layer is needed), `DriveFileRawSchema` for the `unknown` `files.get`
   payload, and the three annotated factories at the six construction sites.
   `bun run typecheck` is the real assertion here — it now checks our ports
   against `drive_v3` &c.; `google-clients.test.ts` adds the runtime half
   (the promised methods exist on what googleapis returns).
5. **Tests' own assertions** — mechanical: `firstCall`, `satisfies`,
   `ExitSignal`, `instanceof` in catch blocks, `Map` for fake stores.
6. **Guard** — `bun run lint:casts` fails on a re-introduced assertion (verify
   by adding one temporarily); wire into CI after `typecheck`.

## Acceptance criteria

- [x] `bun run lint:casts` reports zero assertions in `src/**`, `tests/**`
- [x] `bun run test:all`, `typecheck`, `lint`, `format:check` pass
- [x] No diff in any command's output, error code, or exit code (unit +
      integration suites cover this; they are edited only where an assertion
      lived)
- [x] `src/lib/google-clients.ts` is the only file that imports `googleapis`
      to build a Drive/Docs/Sheets client
- [x] `decisions/0015` linked from `decisions/README.md`; task 0015's
      "Out of scope" note updated to point here
- [x] CI runs `lint:casts`

## Outcome

- 0 assertions left in `src/`, `tests/`, `scripts/`; `lint:casts` guards it.
- Two findings the refactor surfaced, both fixed with a test:
  - `errorToCode` used `code in ERROR_CODE_EXIT_MAP`, which also matched
    inherited keys — an error carrying `code: "toString"` was returned as an
    `ErrorCode` and mapped to an undefined exit code.
  - `lint:casts` found two `as unknown` sites in `src/upgrade.test.ts` that the
    initial grep-based inventory had missed.
- The client casts were hiding exactly one mismatch (`responseType`), so the
  planned adapter layer proved unnecessary — see `decisions/0015` §3.

## Verification

- `bun run test:all` — the whole suite; behavior parity is the point
- `bun run typecheck` — now also checks the ports against googleapis
- `bun run dev -- ls` / `docs read` / `sheets read` against a real account —
  the client factories are the one runtime-shaped change

Live sweep run on 2026-07-24 against `ncukondo@gmail.com` (read-only):
`account list`, `ls` (text/json/`-q`/`--type`), `search`, `info`,
`share list`, `docs read`, `sheets tabs`, `sheets read --as csv`, and both
`download` paths — `--export-as pdf` (valid 8-page PDF) and binary media
(byte count matches `info`), which is what exercises the narrowed
`responseType: "arraybuffer"`. Error paths: `--type bogus` → exit 3, unknown
file → exit 1.
