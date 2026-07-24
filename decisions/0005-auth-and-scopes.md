# 0005: Authentication & OAuth scopes

Date: 2026-07-24
Status: accepted

## Context

gdrive-cli needs to read and lightly edit Drive files, Google Docs, and Google
Sheets across multiple accounts. Auth UX follows gcal-cli; storage is extended
for multiple accounts (0004).

## Decision

### OAuth 2.0 flow (per account)

1. User runs `gdrive auth`.
2. If no OAuth client is configured, interactively prompt for **Client ID** and
   **Client Secret** and save to `~/.config/gdrive-cli/client_secret.json`
   (text format only; `--format json` returns `AUTH_REQUIRED` instead, to
   preserve automation).
3. CLI starts a local HTTP server on an available port, opens the browser to
   Google's consent page, receives the auth code on redirect, and exchanges it
   for access/refresh tokens.
4. CLI calls the userinfo endpoint to detect the account **email**, then stores
   the token at `~/.config/gdrive-cli/accounts/<email>.json`.

Access tokens are refreshed automatically using the stored refresh token; if
refresh fails, the user must re-authenticate that account.

### Requested scopes

```
https://www.googleapis.com/auth/drive          # read + modify Drive files
https://www.googleapis.com/auth/documents       # read + edit Google Docs
https://www.googleapis.com/auth/spreadsheets     # read + edit Google Sheets
https://www.googleapis.com/auth/userinfo.email   # detect account email (openid email)
```

Full `drive` scope (not `drive.file`) is required so the CLI can read and
operate on files it did not create. This is a sensitive scope; the consent
screen will warn accordingly.

### Storage layout

```
~/.config/gdrive-cli/
├── client_secret.json          # shared OAuth client (installed app)
├── config.toml                 # default_account, aliases, defaults (0006)
└── accounts/
    ├── work@example.com.json   # per-account tokens
    └── me@gmail.com.json
```

Token file format:

```json
{
  "email": "me@gmail.com",
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expiry_date": 1706000000000,
  "scopes": ["https://www.googleapis.com/auth/drive", "..."]
}
```

Token files are written `chmod 600`. `client_secret.json` accepts either the
`{ "installed": { ... } }` shape downloaded from Google Cloud Console or
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` environment variables.

### Google Cloud setup (documented for users)

Create a project, enable the **Drive**, **Docs**, and **Sheets** APIs, create
**OAuth 2.0 Desktop app** credentials, and provide the Client ID/Secret to
gdrive-cli.

### `auth status`

Text:
```
Account: me@gmail.com (alias: personal) [default]
Token expires: 2026-07-24 13:00:00
Scopes: drive, documents, spreadsheets
```

JSON:
```json
{ "success": true, "data": { "authenticated": true, "email": "me@gmail.com",
  "alias": "personal", "default": true, "expires_at": "2026-07-24T13:00:00Z" } }
```

## Consequences

- `lib/auth.ts` (adapted from gcal-cli) gains email detection and per-email
  token paths; `lib/account.ts` resolves email/alias → token file.
- Adding a scope later (or the email scope for older tokens) requires the user
  to re-run `gdrive auth` for each affected account.
