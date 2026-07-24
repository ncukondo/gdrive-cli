# 0006: Configuration file

Date: 2026-07-24
Status: accepted

## Context

The CLI needs a place to record the default account, account aliases, and
output defaults. Format and discovery follow gcal-cli's TOML conventions.

## Decision

### Location & resolution order

1. `--config <path>` option
2. `$GDRIVE_CLI_CONFIG` environment variable
3. `./gdrive-cli.toml` (current directory)
4. `~/.config/gdrive-cli/config.toml` (default)

### Format

```toml
# Account used when -a/--account and $GDRIVE_CLI_ACCOUNT are absent.
# May be an email or an alias.
default_account = "work"

# Default output format: "text" (default) or "json"
default_format = "text"

# Known accounts. `email` is canonical (matches accounts/<email>.json).
# `alias` is optional and interchangeable with the email on the CLI.
[[accounts]]
email = "work@example.com"
alias = "work"

[[accounts]]
email = "me@gmail.com"
alias = "personal"
```

The `[[accounts]]` table is the alias registry; token material never lives
here (it lives in `accounts/<email>.json`, see 0005). An account can be
authenticated without an `[[accounts]]` entry — the entry only adds an alias
and/or documents it; `gdrive account list` reconciles the two sources.

### Environment variables

| Variable | Description |
|----------|-------------|
| `GDRIVE_CLI_CONFIG` | Custom config file path |
| `GDRIVE_CLI_ACCOUNT` | Default account (email or alias) |
| `GDRIVE_CLI_FORMAT` | Default output format |
| `GOOGLE_CLIENT_ID` | OAuth client ID (overrides `client_secret.json`) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |

### `gdrive init`

Generates `config.toml` at the default (or `--local`) location, seeding
`[[accounts]]` from already-authenticated tokens and setting `default_account`
to the sole/first account. Idempotent: refuses to clobber an existing file
without `--force`.

## Consequences

- `lib/config.ts` (adapted from gcal-cli) parses TOML with `smol-toml` and
  exposes account/alias lookup used by `lib/account.ts` (0004).
- Aliases are edited both by hand and by `gdrive account alias`, which
  rewrites this file.
