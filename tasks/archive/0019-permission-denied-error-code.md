# Task 0019: `PERMISSION_DENIED` for a 403 that re-authenticating cannot fix

Status: done
Depends on: —
Parallel: yes (worktree-safe) — touches `src/lib/api.ts` error mapping and
`src/types/index.ts`; disjoint from tasks 0020 (`ShareRole`) only if that task
leaves `mapDriveError` alone, so land this one first.

## Goal

`gdrive rm` / `mv` / `share add` on a shared-drive file the account may only
read exits **1** with `error.code: "PERMISSION_DENIED"`, instead of exiting 2
and telling the caller to run `gdrive auth`. A 403 that really is a missing
OAuth scope keeps exit 2.

## Context

- [issue #3](https://github.com/ncukondo/gdrive-cli/issues/3).
- Relevant decisions: `decisions/0017` (this change), `decisions/0007` (error
  and exit-code tables), `decisions/0014` (the contract break is allowed, with
  release notes), `decisions/0015` (narrow the untyped error body, no
  assertions), `decisions/0012` (fakes, no network).
- Relevant docs: `docs/commands.md` (exit codes), `docs/authentication.md`
  (the "what went wrong" table).

## Scope

- `src/types/index.ts` — `ERROR_CODES`, `ERROR_CODE_EXIT_MAP`.
- `src/lib/api.ts` — `mapDriveError` and a local reason-reading helper.
- `decisions/0007`, `decisions/0017`, `decisions/README.md`.
- `docs/commands.md`, `docs/authentication.md`.

## Out of scope

- `organizer` / `fileOrganizer` in `share add` (issue #4).
- Shared-drive paths (issue #5) and the `info` drive-root name (issue #6).
- Retry behavior for rate-limit 403s — they land on `PERMISSION_DENIED` with
  Google's message; classifying them separately needs its own decision.

## TDD plan

1. **Red** — `src/types/index.test.ts`: `errorToExit("PERMISSION_DENIED")` is 1;
   `errorToCode` resolves a thrown `AppError("PERMISSION_DENIED")` to itself.
2. **Red** — `src/lib/api.test.ts` on `mapDriveError`:
   - a bare 403 → `PERMISSION_DENIED` (replaces the `[403, "AUTH_REQUIRED"]` row
     in the existing `it.each`, which pins the bug);
   - 403 with `response.data.error.errors[0].reason ===
     "ACCESS_TOKEN_SCOPE_INSUFFICIENT"` → `AUTH_REQUIRED`;
   - 403 with reason `insufficientPermissions` → `AUTH_REQUIRED`;
   - 403 with reason `insufficientFilePermissions` → `PERMISSION_DENIED`
     (the near-miss string that a substring match would get wrong);
   - 403 whose message contains "insufficient authentication scopes" and has no
     `errors` array → `AUTH_REQUIRED`;
   - 403 with a malformed body (`response.data` a string, `errors` not an
     array, `reason` a number) → `PERMISSION_DENIED`, no throw from the helper;
   - 401 / 404 / 500 unchanged.
3. **Red** — `src/lib/api.test.ts`: the `listSharedDrives` 403 case now expects
   `PERMISSION_DENIED` (it asserted `AUTH_REQUIRED`).
4. **Green** — add the code + exit mapping, then the reason reader.
5. **Refactor** — keep the helper private to `api.ts` and the narrowing flat.

## Acceptance criteria

- [x] A role-denied write exits 1 with `PERMISSION_DENIED` in the JSON envelope
- [x] A scope-denied call still exits 2 with `AUTH_REQUIRED`
- [x] A malformed / absent error body falls back to `PERMISSION_DENIED`
- [x] Docs and Sheets get the same mapping (they share `mapDriveError`)
- [x] `decisions/0007` and `docs/commands.md` list the new code and exit
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`

## Outcome notes

- The reason lookup is `errorReasons` in `src/lib/api.ts`: four narrowing hops
  (`response` → `data` → `error` → `errors`) over an untyped body, each one
  falling through to "no reason" rather than throwing. Five malformed-body
  shapes are pinned by tests, because this helper runs only on the error path
  and a crash there would replace a bad exit code with no output at all.
- The scope carve-out matches `insufficientPermissions` **exactly**; Drive's
  role failure is the longer `insufficientFilePermissions`, and a substring
  match would have re-created the very bug the task fixes. Both strings are in
  the test table so the distinction cannot be refactored away silently.
- A rate-limit 403 (`userRateLimitExceeded`) also lands on `PERMISSION_DENIED`.
  Not ideal, but it shares the exit code and Google's message says which it is;
  splitting it out would need a retry policy decision that nothing asks for yet.

## Verification

- `bun run test:unit` (412 passed), `typecheck`, `lint`, `lint:casts`,
  `format:check`. `test:integration` has no files in this repo.
- **Verified against a real account**, read-only: `gdrive share list` on a
  presentation shared with the account as a viewer. `main` answered exit 2 /
  `AUTH_REQUIRED`; this branch answers exit 1 / `PERMISSION_DENIED`, message
  `The user does not have sufficient permissions for this file.`
- That case is the near-miss the design turns on: Drive's reason there is
  `insufficientFilePermissions`, one word away from the scope failure's
  `insufficientPermissions`. A substring match would have reproduced the bug;
  the exact match handles it correctly on real data.
- Still unverified: the *scope* branch. Producing it needs a token minted
  before a scope was added, which no account here has.
