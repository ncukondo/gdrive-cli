# Task 0004: OAuth + multi-account auth

Status: todo
Depends on: 0002, 0003
Parallel: no — central to all data commands

## Goal

OAuth login that detects the account email and stores per-account tokens, plus
account resolution (`-a` > env > `default_account` > sole account) yielding an
authenticated googleapis client. Implements `decisions/0004` and `0005`.

## Context

- Relevant decisions: `decisions/0004-multi-account.md`, `decisions/0005-auth-and-scopes.md`
- Adapt gcal-cli's `src/lib/auth.ts` (loopback OAuth, client_secret prompt,
  token refresh); extend for per-email token files + email detection.

## Scope

- `src/lib/auth.ts`: OAuth loopback flow, client-secret load/prompt, token
  read/write at `accounts/<email>.json` (chmod 600), refresh, email detection
  via userinfo.
- `src/lib/account.ts`: resolve requested account → token file → OAuth2 client;
  errors `AUTH_REQUIRED` / `ACCOUNT_NOT_FOUND`.
- `src/commands/auth.ts`: `gdrive auth [login|status|logout]`.

## Out of scope

- `account list/use/alias/remove` (0005), `init` (0011).

## TDD plan

1. **Red** (inject fs + fake OAuth/token/userinfo): token round-trips per email;
   email detection sets filename; refresh on expiry; account resolution
   priority; missing account → `ACCOUNT_NOT_FOUND`; none → `AUTH_REQUIRED`;
   `--format json` never prompts (returns `AUTH_REQUIRED`).
2. **Green** — implement flow + resolution.
3. **Refactor** — split flow (I/O) from pure resolution.

## Acceptance criteria

- [ ] `gdrive auth` stores `accounts/<email>.json`; first login sets default
- [ ] `gdrive auth status` shows resolved account (text + JSON per 0005)
- [ ] `gdrive auth logout [acct]` revokes + deletes the token
- [ ] Account resolution priority honored; correct errors/exit codes
- [ ] `bun run test`, `bun run typecheck` pass

## Verification

- `bun run test src/lib/auth.test.ts src/lib/account.test.ts src/commands/auth.test.ts`
- Manual: real `gdrive auth` against a test project (e2e, local only)
