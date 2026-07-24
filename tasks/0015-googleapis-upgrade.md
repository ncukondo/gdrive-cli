# Task 0015: Upgrade googleapis (130 → 173)

Status: todo
Depends on: —
Parallel: no — touches every command's client construction

## Goal

Move the `googleapis` dependency from `^130.0.0` to the current major (173 at
the time of writing) with Drive, Docs, Sheets, and OAuth behavior unchanged,
verified against a real account.

## Context

- Relevant decisions: `decisions/0002-tech-stack.md`, `decisions/0012-testing-strategy.md`
- Relevant docs: `docs/authentication.md` (scopes / OAuth flow)
- 43 major versions of drift. `googleapis` bumps its major on every generated
  API refresh, so most of the gap is regenerated types rather than deliberate
  breakage — but the engine floor did move (`>=14` → `>=18`) and the OAuth2
  client is the piece most likely to have shifted.

**The compiler will not catch a regression here.** Every client is built with
`google.xxx({...}) as unknown as OurClient` against hand-written interfaces
(`DriveClient`, `DocsClient`, `SheetsClient`), and unit tests inject fakes that
satisfy those interfaces. A renamed parameter, a changed response envelope, or
a moved `data` field type-checks and passes the whole suite while failing at
runtime. This task is therefore live-verification-led, not test-led.

Cast sites: `src/commands/{drive-read,drive-write}.ts`,
`src/commands/{docs,sheets,share}/index.ts`.
OAuth surface: `src/lib/auth.ts` and `src/lib/account.ts`
(`new google.auth.OAuth2(...)`, `InstanceType<(typeof google.auth)["OAuth2"]>`).

## Scope

- `package.json` / `bun.lock` — the dependency bump.
- Any adjustment the bump forces in `src/lib/{auth,account}.ts`, the client
  interfaces in `src/lib/{api,docs-api,sheets-api}.ts`, and the cast sites.

## Out of scope

- Dropping the `as unknown as` casts in favor of the generated types. Tempting
  (it would have caught this class of drift) but it pulls googleapis types into
  the fakes and rewrites `decisions/0012`'s injection model — file a separate
  task with a decision record if wanted.
- Other dependency bumps (`commander`, `zod`, `smol-toml`).

## Plan

1. Bump, `bun install`, `bun run typecheck`, `bun run test:all`. Expect this to
   pass even if something broke — see Context.
2. Diff the OAuth surface: confirm `google.auth.OAuth2`'s constructor
   signature, `generateAuthUrl`, `getToken`, and `setCredentials` still behave
   as `src/lib/auth.ts` assumes.
3. Re-run the live smoke sweeps recorded in `tasks/archive/0009`, `0010`,
   `0014` — every Drive, Docs, Sheets, and share subcommand against a scratch
   folder, self-cleaning. This is the real verification.
4. Add a regression test for anything found broken, then fix it.
5. Check the binary size delta (`bun run build:release`); the current binaries
   are ~86–120 MB and googleapis dominates that.

## Acceptance criteria

- [ ] `googleapis` at the current major; `bun.lock` committed
- [ ] `bun run test:all`, `bun run typecheck`, `bun run lint`, `format:check` pass
- [ ] CI green, including the packed-tarball install smoke test
- [ ] Live sweep passes: `auth status`, `ls`, `search`, `info`, `download`,
      `upload`, `mkdir`, `mv`, `cp`, `rm`, all `share`, `docs`, and `sheets`
      subcommands — text, `-q`, and `-f json`
- [ ] Any behavior change is reflected in `docs/` and noted here
- [ ] Node engine floor (`>=18`) is compatible with what we ship and document

## Verification

- `bun run test:all` — unit suite (necessary, not sufficient here)
- Live sweep against a real account, self-cleaning, as in task 0009/0010/0014
- `node dist/index.js --version` plus a packed-tarball install run
