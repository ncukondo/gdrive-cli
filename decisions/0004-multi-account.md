# 0004: Multi-account model

Date: 2026-07-24
Status: accepted

## Context

The defining feature over gcal-cli (which stores a single `credentials.json`)
is switching between multiple Google accounts — e.g. personal vs. work Drive.
The model should feel familiar to `gcloud` / `gh` users.

## Decision

- **Accounts are identified by their Google email**, auto-detected at login
  time via the `userinfo.email` / `openid email` scope. The email is the
  canonical account id.
- **Optional alias.** Any account may be given a short alias (e.g. `work`,
  `personal`). Aliases are stored in `config.toml` (see 0006) and are
  interchangeable with the email wherever an account is referenced.
- **Selecting an account**, in priority order:
  1. `-a, --account <email|alias>` command-line option
  2. `GDRIVE_CLI_ACCOUNT` environment variable
  3. `default_account` in `config.toml`
  4. If exactly one account is authenticated, use it.
  5. Otherwise error `ACCOUNT_NOT_FOUND` (or `AUTH_REQUIRED` if none exist).
- **Per-account token files** live at
  `~/.config/gdrive-cli/accounts/<email>.json` (see 0005). The OAuth *client*
  (`client_secret.json`) is shared across accounts.

### Account management commands

| Command | Behavior |
|---------|----------|
| `gdrive auth [login]` | Run OAuth, detect email, store/refresh that account's token. First account becomes `default_account`. |
| `gdrive auth status` | Show the resolved account's auth state. |
| `gdrive auth logout [<email\|alias>]` | Revoke + delete that account's token (default: resolved account). |
| `gdrive account list` | List authenticated accounts; mark the default and show aliases. |
| `gdrive account use <email\|alias>` | Set `default_account`. |
| `gdrive account alias <email\|alias> <alias>` | Assign/rename an alias. |
| `gdrive account remove <email\|alias>` | Alias of `auth logout`. |

## Consequences

- Every data command accepts `-a/--account`; resolution is centralized in
  `lib/account.ts` and feeds an authenticated client into `lib/api.ts`.
- Aliases are a config concern, not a token concern — removing an account
  cleans up both its token file and its alias entry.
- Email detection requires the email scope (0005); tokens predate no email are
  not supported (re-auth required).
