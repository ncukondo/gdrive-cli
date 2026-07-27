# 0017: 403 means "you lack the right", not "log in again"

Date: 2026-07-27
Status: accepted

## Context

`mapDriveError` turns every HTTP 403 into `AUTH_REQUIRED`, which
[0007](0007-output-and-errors.md) defines as "no usable credentials for the
account" and maps to exit code 2 — the code whose documented remedy is
`gdrive auth` ([issue #3]).

On a shared drive that is usually the opposite of what happened. The account is
signed in, the token is fresh, and the API is refusing because the caller holds
`reader` or `commenter` where `writer` or `organizer` is required. `rm`, `mv`,
`share add`, and every write path can hit it. An agent or script reading exit 2
re-runs the OAuth flow, succeeds at it, retries, and gets exit 2 again: the one
error code that promises a fix names a fix that cannot work.

Before v0.4.0 this rarely surfaced, because shared-drive requests failed at
`NOT_FOUND` before the API ever reached a permission check
([0016](0016-shared-drive-scope.md) §1 removed that). The mapping is now
exercised routinely, so it has to be right.

403 is not one condition, though, and the cheap fix of moving all of it to exit
1 would throw away a signal that *is* worth keeping. Drive returns 403 for at
least three unrelated things:

| What happened | Does re-authenticating help? |
| ------------- | ---------------------------- |
| The role on the file or drive is too low | No — ask an organizer |
| The OAuth token lacks the scope for this call | **Yes** — consent again |
| Rate limit / quota exceeded | No — retry later |

Only the middle row is an authentication problem, and it is the row that
[0005](0005-auth-and-scopes.md) §"Adding a scope later" already anticipates:
a token minted before a scope was added keeps working for reads and fails 403
on the call that needs the new scope. Collapsing all three rows into one code
would make that case undiagnosable.

## Decision

### 1. A new error code `PERMISSION_DENIED`, exit 1

| Code | Description | Exit |
| ---- | ----------- | ---- |
| `PERMISSION_DENIED` | Signed in, but the account's role does not allow this | 1 |

It joins the exit-1 family (`NOT_FOUND`, `API_ERROR`, `CONFIG_ERROR`,
`IO_ERROR`): the operation failed and no credential change will fix it. Exit 2
keeps its narrow, actionable meaning — *run `gdrive auth`* — which is what makes
it useful to a script at all.

`API_ERROR` was the cheaper alternative and is rejected: a JSON consumer would
then have to parse Google's prose to tell "you are not allowed" from "Drive is
having a bad day", and those want different handling (surface to the human vs.
retry). The whole point of a stable `error.code` is to spare the caller that.

### 2. 403 maps by reason, with `PERMISSION_DENIED` as the default

```
403 ┬ reason ∈ {ACCESS_TOKEN_SCOPE_INSUFFICIENT, insufficientPermissions} → AUTH_REQUIRED (2)
    ├ message says "insufficient authentication scopes"                   → AUTH_REQUIRED (2)
    └ anything else                                                       → PERMISSION_DENIED (1)
```

The reason strings are read from **both** places Google writes them, because
which field carries one depends on the error style answering:

| Field | Style | A scope failure spells it |
| ----- | ----- | ------------------------- |
| `response.data.error.errors[].reason` | classic Drive | `insufficientPermissions` |
| `response.data.error.details[].reason` | `google.rpc.ErrorInfo` | `ACCESS_TOKEN_SCOPE_INSUFFICIENT` |

Reading only `errors[]` would leave the `ErrorInfo` door shut — and that is the
newer of the two, so it is the one likelier to be left standing alone as the
legacy array is phased out. (An earlier draft of this record did exactly that,
and claimed the newer style puts its reason in `errors[]`. Review caught it.)

Both are read defensively: the body is untyped JSON, so a missing or reshaped
field simply yields no reason and the default applies
([0015](0015-no-type-assertions.md) — narrow, never assert). The message check
is a third door to the same room, for the prose form Drive's classic style uses
(`Insufficient Permission` / `Request had insufficient authentication scopes`).

Note that Drive's *file* permission failure is `insufficientFilePermissions` —
a different string from the scope failure's `insufficientPermissions`. The match
is exact and case-sensitive for that reason; a substring match would send every
role denial back to exit 2, reintroducing the bug.

**The default direction is the safe one.** If the reason lookup fails to
recognize a genuine scope problem, the user gets exit 1 with Google's own
message ("Request had insufficient authentication scopes") in it — wrong code,
readable diagnosis. The inverse default would tell people to re-authenticate
over a role they will never be granted by logging in.

401 (`AUTH_EXPIRED`), 404 (`NOT_FOUND`), and everything else (`API_ERROR`) are
untouched.

### 3. Scope: the Drive mapper only

`mapDriveError` is the single mapper — `docs-api.ts` and `sheets-api.ts` import
it as `mapApiError` — so this covers Docs and Sheets too. That is correct:
a 403 from the Docs API on a file the account can only read is the same
condition with the same remedy.

## Consequences

- This changes the documented exit-code contract for an existing condition:
  a permission-denied `rm` moves from exit 2 to exit 1. Permitted in a minor
  release by [0014](0014-pre-1.0-compatibility.md) — the issue is self-filed by
  the maintainer, so no known user is triggering 0014's "When this ends" clause
  — and it must be called out in the release notes.
- `ERROR_CODES` and `ERROR_CODE_EXIT_MAP` in `src/types/index.ts` gain the code;
  0007's error table and `docs/commands.md`'s exit-code table gain the row.
- `errorToCode` picks the new code up for free — it matches thrown `AppError`s
  against `ERROR_CODES` by name.
- Text mode gains nothing but a better sentence; the value is in JSON mode and
  the exit status, which is where the agent consumer lives.
- The reason-reading helper is the first place this codebase looks *inside* a
  googleapis error body rather than at its status code. Kept small and local to
  `mapDriveError`, with the untyped body narrowed field by field.

[issue #3]: https://github.com/ncukondo/gdrive-cli/issues/3
