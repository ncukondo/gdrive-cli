# Task 0015: Upgrade googleapis (130 → 173)

Status: done
Depends on: 0016 (removes the casts that hide this bump's breakage)
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

- Dropping the `as unknown as` casts in favor of the generated types — now
  owned by `tasks/0016-remove-type-assertions.md` (`decisions/0015`), which
  this task depends on. It keeps `decisions/0012`'s fakes intact by putting the
  generated types behind adapters in `src/lib/google-clients.ts`, so after 0016
  the bump *is* compiler-checked and step 1 below stops being a formality.
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

- [x] `googleapis` at the current major; `bun.lock` committed
- [x] `bun run test:all`, `bun run typecheck`, `bun run lint`, `format:check` pass
- [x] CI green, including the packed-tarball install smoke test
- [x] Live sweep passes: `auth status`, `ls`, `search`, `info`, `download`,
      `upload`, `mkdir`, `mv`, `cp`, `rm`, all `share`, `docs`, and `sheets`
      subcommands — text, `-q`, and `-f json`
- [x] Any behavior change is reflected in `docs/` and noted here — there was none
- [x] Node engine floor (`>=18`) is compatible with what we ship and document

## Outcome

`googleapis` 130.0.0 → 173.0.0 with **no source change required** by the bump
itself, and no behavior change to report in `docs/`. The 43 majors were indeed
regenerated API surface, not deliberate breakage.

**The OAuth surface was the smallest risk, not the largest.** Token exchange,
refresh, and revoke all go through raw `fetch` against hardcoded endpoints, so
googleapis is only involved in three calls: the positional
`new google.auth.OAuth2(id, secret, redirectUri)` constructor, `generateAuthUrl`
({`access_type`, `scope`, `prompt`}), and `setCredentials`. All three are intact
in google-auth-library 10.9.1. `getToken` is not used at all. The positional
constructor is now marked `@deprecated` in favor of an options object; it still
works and was left alone (changing it is not forced by this bump).

**Decision 0015's compile-time claim was half true, and is now fully true.** The
factory return-type annotations catch *response* drift — verified by probe: a
port declaring a `data` field googleapis does not return fails `typecheck`. They
do **not** catch *request* drift, because parameters are compared
contravariantly and extra properties on our side are not an assignability error;
a probe adding `bogusRequestParam` to `ListParams` compiled clean. So a renamed
or dropped parameter would have passed the whole suite and silently been ignored
by the API — exactly the failure mode this task was written around. Closed by
adding `GeneratedParamChecks` to `src/lib/google-clients.ts`, which asserts
every port method's parameter keys are a subset of the generated
`Params$Resource$…` type. It reads the params back out of the ports via
`Parameters<…>`, so there is no parallel list to maintain. Verified in both
directions: clean at 173, and a temporary bogus key fails `typecheck` naming the
key. `decisions/0015` §3 and its Consequences were corrected to match.

**Added an `engines` floor.** googleapis 173 and google-auth-library 10 both
require Node `>=18` (was `>=14`), and `package.json` had no `engines` field, so
an npm install on Node 16 would have succeeded and then crashed at runtime.
`"engines": { "node": ">=18" }` now states the floor. CI already builds on Node
22, and the compiled binaries bundle their own runtime, so nothing else moved.

**Binary size:** the `bun-linux-x64` compiled binary grows 115,910,784 →
124,917,888 bytes (+8.6 MiB, +7.8%); the bundle goes from 1073 to 1256 modules.
Measured by building the same target before and after the bump.

## Live sweep

Run 2026-07-24 against `ncukondo@gmail.com`, inside one scratch folder
(`gdrive-cli-sweep-0015`) permanently deleted at the end — verified gone
afterwards, and the account's pre-existing trash was left untouched.

Covered, in text / `-q` / `-f json` as applicable: `auth status`,
`account list`; `mkdir` (root + `--parent`); `upload`, `info`, `download` with a
byte-exact round-trip; `ls` (plain, `--type`, `-n`/`--order`, `--trashed`),
`search`; `cp --name` then `mv` (parents confirmed reassigned); `share
list`/`add --anyone`/`link`/`remove --permission-id`; `docs
create --content`/`append`/`insert --at start`/`replace`/`read` (markdown, text,
json) with the edited text confirmed in the read-back; `sheets
create`/`tabs`/`write`/`append`/`read` (table, csv, json, ranged)/`clear`, plus
`--input-mode user` confirming `=1+1` evaluates to `2`; exports
`--export-as pdf` (valid `%PDF`), `md`, `csv`, `xlsx`; `rm` (trash, then
`--permanent`). Error paths: `--type bogus` → exit 3, unknown file → exit 1.

Everything passed on the first run with no code change. The packed tarball was
additionally installed and exercised under **Node** (not Bun) — `--version`,
`--help`, `auth status`, `ls`, `search` — since the sweep itself runs on Bun and
the npm path is the one with the engine floor.

## Verification

- `bun run test:all` — unit suite (necessary, not sufficient here)
- Live sweep against a real account, self-cleaning, as in task 0009/0010/0014
- `node dist/index.js --version` plus a packed-tarball install run
