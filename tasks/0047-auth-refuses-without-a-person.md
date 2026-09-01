# Task 0047: `gdrive auth` refuses where nobody can finish the flow

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0048, 0049 and 0050; none of them touches
`src/commands/auth.ts`, `src/index.ts` or `docs/authentication.md`.

## Goal

`gdrive auth` on a machine with client credentials and no tty exits 2 with
`AUTH_REQUIRED` naming what is missing, instead of blocking for ever on a
loopback server no browser will reach (issue #17).

## Context

- Relevant decisions: [`0058`](../decisions/0058-the-browser-flow-needs-a-person.md)
  (what the flow needs, and why nothing probes for a browser),
  [`0005`](../decisions/0005-auth-and-scopes.md) step 3 (the flow itself),
  [`0040`](../decisions/0040-a-review-finding-names-a-class.md) §3 (the shape of
  fix to avoid — the first `canPrompt` patch answered the finding, not the
  class).
- Relevant docs: `docs/authentication.md` §2–§3, `docs/commands.md` line 31.
- `src/index.ts:56`'s `canPrompt` already encodes both halves of the gate 0058
  §1 and §3 arrive at. The task is to reach it from the second wait, and to say
  in the code *why* one predicate answers two questions — not to grow a second
  one that happens to agree.
- `docs/authentication.md` §3 says `gdrive` "opens your browser". Nothing in
  `src/lib/auth.ts` launches one; `startOAuthFlow` returns a URL and
  `src/commands/auth.ts` prints it. 0058's Consequences make correcting that
  part of this task, because §2's reasoning only reads as a choice once the
  mechanism is stated.

## Scope

- `src/index.ts` — whatever `canPrompt` becomes so that both call sites read
  from one place.
- `src/commands/auth.ts` — `handleAuthLogin` and its registrar.
- `src/commands/auth.test.ts`
- `docs/authentication.md`, `docs/commands.md`

## Out of scope

- Opening a browser for the user. 0058 §2 refuses the probe and this task does
  not add the launcher either; the printed URL is the mechanism. **This work
  will not be done.**
- A non-interactive login (a service account, a device-code flow, a pasted
  refresh token). 0005 step 3 fixes the loopback redirect as the design, and
  changing it is a new decision rather than a bug fix. **Not tracked; there is
  no request for it.**

## TDD plan

1. **Red** — `src/commands/auth.test.ts`:
   - `handleAuthLogin` with `canPrompt: false` and client credentials **present
     in the fake fs** throws `AUTH_REQUIRED` and never calls `runFlow`. This is
     the issue: today `runFlow` is called and would block.
   - The message names a terminal when stdin is not a tty, and names `-f json`
     when that is what closed the gate — two distinct messages, because one of
     them is fixed by dropping a flag (0058 §4).
   - `canPrompt: false` with credentials **absent** still throws
     `AUTH_REQUIRED` from the credential lookup, and still never calls
     `runFlow` — the path that already worked keeps working.
   - `canPrompt: true` calls `runFlow` exactly once and reports the account, as
     today.
   - Nothing is written to stdout before the refusal: a refused JSON caller gets
     the error envelope and no prose URL line.
2. **Green** — pass the reason for the closed gate into `handleAuthLogin`
   alongside the boolean, or replace the boolean with something that carries it,
   and gate `runFlow` on it. Keep `handleError`'s mapping untouched:
   `AUTH_REQUIRED` is already exit 2.
3. **Refactor** — the comment at `auth.ts:157` describes the gap this task
   closes and must not survive it describing something else. Replace it with
   what the code now does and a link to 0058.

## Acceptance criteria

- [ ] `gdrive auth </dev/null` on a configured machine exits 2 with
      `AUTH_REQUIRED` and a message naming the terminal
- [ ] `gdrive -f json auth` at a terminal exits 2 and says the flag is what
      refused, and the whole of stdout parses as one JSON envelope
- [ ] `gdrive auth` at a terminal with no format named still logs in
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/authentication.md` §2's "the prompt needs a terminal" becomes the
      rule for the command, and §3 no longer claims a browser is opened

## Verification

- Automated: `bun run test src/commands/auth.test.ts` — the refusal, both
  messages, and that `runFlow` is not reached. `bun run test:e2e` — nothing;
  [`0043`](../decisions/0043-e2e-runs-before-push.md) §4 says the suite runs
  with no tty and no browser, so it can only ever exercise the refusal it would
  be asserting against itself.
- Manual, against a real account: a real terminal and a real consent screen.
  (1) `gdrive auth` at a tty completes and stores a token. (2) `gdrive auth`
  with stdin redirected from `/dev/null` returns immediately, exit 2. (3)
  `gdrive -f json auth | jq .` at a tty parses. Only (1) needs the browser.
