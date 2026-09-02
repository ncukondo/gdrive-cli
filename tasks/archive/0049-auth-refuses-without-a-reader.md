# Task 0049: `gdrive auth` refuses where nobody can read the URL

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0050, 0051 and 0052.

## Goal

`gdrive auth` on a machine with client credentials and nothing attached to
stderr exits 2 with `AUTH_REQUIRED` naming what is missing, instead of blocking
for ever on a loopback server no browser will reach (issue #17).

## Context

- Relevant decisions:
  [`0059`](../decisions/0059-the-browser-flow-needs-a-reader.md) (what the flow
  needs, which stream it is on, and why nothing probes for a browser),
  [`0005`](../decisions/0005-auth-and-scopes.md) step 3 (the flow itself),
  [`0007`](../decisions/0007-output-and-errors.md) (what goes to which stream),
  [`0040`](../decisions/0040-a-review-finding-names-a-class.md) §3 (the shape of
  fix to avoid — the first `canPrompt` patch answered the finding, not the
  class).
- Relevant docs: `docs/authentication.md` §2–§3, `docs/commands.md` line 31.
- **The gate is not stdin.** That is the reading this task exists to not take.
  `src/index.ts:56`'s `canPrompt` asks about stdin because typing happens
  there; the flow's requirement is that the URL be *seen*, and the URL is
  printed. 0059 §1 moves it to stderr and §2 gates on that stream. Gating on
  stdin instead refuses `gdrive auth </dev/null` typed at an interactive shell —
  which works today — and permits `gdrive auth > log` at that same shell, which
  hangs today.
- `docs/authentication.md` §3 says `gdrive` "opens your browser". Nothing in
  `src/lib/auth.ts` launches one; `startOAuthFlow` returns a URL and
  `src/commands/auth.ts` prints it. 0059's Consequences make correcting that
  part of this task, because §3's reasoning only reads as a choice once the
  mechanism is stated.
- `renderError` (`src/lib/output.ts`) already puts a **failure** envelope on
  stderr and leaves stdout empty. So the JSON corruption 0059 §1 fixes is on the
  **success** path only: the URL line shared stdout with the success envelope.
  A criterion that says "the refusal's stdout parses as JSON" is unsatisfiable
  and means nothing — stdout is empty there.

## Scope

- `src/index.ts` — the flow's gate, beside `canPrompt` rather than instead of it
- `src/commands/auth.ts` — `handleAuthLogin` and its registrar
- `src/lib/auth.ts` — only where the credential notice is written
- `src/lib/prompt.ts` — `createReadlinePrompt` built readline with
  `output: process.stdout`, so `gdrive auth > file` put `Client ID:` in the file
  and left the terminal silent. Found in review; the same stream question as the
  URL, and 0059 §1 is only true once both move.
- `src/commands/auth.test.ts`, `src/index.test.ts`, `src/lib/auth.test.ts`
- `tests/integration/auth-streams.test.ts` — the URL is written in the registrar
  closure, which no test beside `handleAuthLogin` reaches. A unit test there has
  to inject a `runFlow` fake and then assert where the fake wrote, which passes
  with production writing to stdout. Measured; that is why this file exists.
- `docs/authentication.md`, `docs/commands.md`

## Out of scope

- Opening a browser for the user. 0059 §3 refuses the probe and this task does
  not add the launcher either. **This work will not be done.**
- A non-interactive login (a service account, a device-code flow, a pasted
  refresh token). 0005 step 3 fixes the loopback redirect as the design, and
  changing it is a new decision rather than a bug fix. **Not tracked; there is
  no request for it.**
- Moving any *other* command's notices to stderr. 0007 already says where they
  go; auditing every command against it is its own survey and no report asks
  for one. **This work will not be done here.**

## TDD plan

1. **Red** — `src/commands/auth.test.ts`:
   - `handleAuthLogin` with the flow's gate closed and client credentials
     **present in the fake fs** throws `AUTH_REQUIRED` and never calls
     `runFlow`. This is the issue: today `runFlow` is called and would block.
   - Two distinct messages: the one for a missing terminal must **not** tell the
     caller to drop `-f json`, and the one for `-f json` must not tell them to
     find a terminal. A single message containing both strings has to fail —
     which an assertion that only checks `toContain` cannot do.
   - `canPrompt: false` with credentials **absent** still throws
     `AUTH_REQUIRED` from the credential lookup, and still never calls
     `runFlow`.
   - Credentials absent, stdin a terminal, stderr a terminal: still prompts and
     still logs in.
   - The consent URL and the "no OAuth client configured" notice go to `warn`,
     not to `write`. Assert on both sinks: a test that only checks the URL is
     absent from stdout passes if it went nowhere at all.
2. **Red** — `src/index.test.ts`: the flow's gate is closed when stderr is not a
   tty and open when it is, and it does not consult stdin. The `-f json` reason
   is reported only when the terminal is there, because the terminal is the one
   that cannot be worked around.
3. **Green** — add the gate; move the two writes to `warn`; refuse at the top of
   `handleAuthLogin`.
4. **Refactor** — the comment at `auth.ts:157` describes the gap this task
   closes and must not survive it describing something else.

## Acceptance criteria

- [ ] `gdrive auth </dev/null` with no tty at all exits 2, naming the terminal
- [ ] `gdrive auth </dev/null` **at an interactive shell** still logs in — the
      false refusal this task is written to avoid
- [ ] `gdrive auth > out` at a terminal shows the URL and completes, where it
      used to hang
- [ ] `gdrive -f json auth` exits 2 and says the flag is what refused
- [ ] `gdrive auth > token.json` at a terminal: `token.json` holds one envelope
      and no prose, and the URL — and the `Client ID:` prompt, if there is one —
      appears on the terminal
- [ ] The refusal's rule is the **class**, not two examples: stderr must be a
      terminal, so `2> log`, `2>&1 | tee log` and `|& less` are refused too, and
      `docs/` says so
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/authentication.md` §2 states the rule for the command rather than
      for the prompt, and §3 no longer claims a browser is opened

## Verification

- Automated: `bun run test src/commands/auth.test.ts src/index.test.ts`.
  `bun run test:e2e` — nothing;
  [`0043`](../decisions/0043-e2e-runs-before-push.md) §4 says the suite runs
  with no tty and no browser, so it can only ever exercise the refusal.
- Manual, against a real account, at a real terminal with a real consent screen:
  (1) `gdrive auth` completes and stores a token. (2) `gdrive auth </dev/null`
  at that terminal **still completes** — the regression to watch for.
  (3) `gdrive auth 2>/dev/null` returns immediately, exit 2. (4)
  `gdrive auth -f json > t.json` completes and `jq . t.json` parses. Only (1),
  (2) and (4) need the browser.
