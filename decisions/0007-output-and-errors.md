# 0007: Output modes, exit codes, error codes

Date: 2026-07-24
Status: accepted

## Context

The CLI serves both humans (readable terminal output) and AI agents / scripts
(machine-readable, stable). Conventions mirror gcal-cli.

**The primary consumer is an AI agent.** JSON (`-f json`) is a first-class,
stable interface: the envelope shape, `error.code` values, and each command's
`data` fields are treated as a contract — additive changes preferred, breaking
changes require a decision record. Text output is the convenience layer.

> While the project is pre-1.0 with no known users, this contract is relaxed:
> see [0014](0014-pre-1.0-compatibility.md). Read the paragraph above as the
> policy from 1.0 onward.

## Decision

### Output modes

- **Text (default)** — human-readable, to stdout.
- **JSON** — `-f, --format json`. Envelope:
  ```json
  { "success": true,  "data": { ... } }
  { "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
  ```
- **Quiet** — `-q, --quiet`. Minimal text for piping (e.g. bare IDs, one per
  line). JSON mode is unaffected by `--quiet`.

All datetime fields are ISO 8601 with offset. Byte sizes are integers.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General / operation error (API error, not found, I/O) |
| 2 | Authentication error (not authenticated / refresh failed) |
| 3 | Argument / usage error |

### Error codes

| Code | Description | Exit |
|------|-------------|------|
| `AUTH_REQUIRED` | No usable credentials for the account | 2 |
| `AUTH_EXPIRED` | Token expired and refresh failed | 2 |
| `ACCOUNT_NOT_FOUND` | Named account/alias is not authenticated | 2 |
| `PERMISSION_DENIED` | Signed in, but the account's role does not allow this | 1 |
| `NOT_FOUND` | File / folder / doc / sheet / range not found | 1 |
| `INVALID_ARGS` | Invalid command arguments | 3 |
| `PRUNE_REQUIRED` | The write would delete something and `--prune` was not given ([0028](0028-forms-write.md) §3) | 3 |
| `API_ERROR` | Google API returned an error | 1 |
| `CONFIG_ERROR` | Configuration file error | 1 |
| `IO_ERROR` | Local filesystem read/write error | 1 |

### Piping conventions

- Inputs that accept text/values accept a literal string, `@file` to read a
  file, or `-` to read stdin (used by `docs append`, `docs create --content`,
  `sheets write/append --values`).
- Downloaded content goes to stdout when no `-o` is given (so it can be piped),
  or to a file with `-o <path>`.

## Consequences

- `lib/output.ts` (adapted from gcal-cli) owns text/json/quiet rendering and
  the error envelope; command handlers never build JSON by hand.
- Errors thrown internally carry an `ErrorCode`; a top-level handler maps code
  → exit code and renders per the active format.
- Exit 2 is reserved for conditions `gdrive auth` can actually fix. A 403 that
  reflects the account's *role* is exit 1; see
  [0017](0017-permission-denied-error-code.md) for the split.
