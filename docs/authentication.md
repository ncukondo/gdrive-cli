# Authentication

How to get `gdrive` talking to your Google account. Design rationale lives in
[`../decisions/0005`](../decisions/0005-auth-and-scopes.md).

## 1. Google Cloud setup

`gdrive` talks to Google with **your own** OAuth client, so you control the
project and its quota.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. Enable three APIs: **Google Drive API**, **Google Docs API**, and
   **Google Sheets API**.
3. Configure the **OAuth consent screen**. For personal use pick *External* and
   add your own address under *Test users* — a testing app does not need
   verification.
4. Create credentials → **OAuth client ID** → application type
   **Desktop app**. Copy the **Client ID** and **Client secret**.

## 2. Provide the client credentials

Either let `gdrive auth` prompt for them the first time (it writes
`~/.config/gdrive-cli/client_secret.json`), drop the JSON you downloaded from
the console at that path (the `{ "installed": { … } }` shape is accepted), or
export environment variables:

```sh
export GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="..."
```

The interactive prompt is text-mode only. With `--format json` a missing client
returns `AUTH_REQUIRED` instead of prompting, so scripted runs never block.

## 3. Log in

```sh
gdrive auth              # same as `gdrive auth login`
```

`gdrive` starts a local HTTP server on a free port, opens your browser to
Google's consent page, receives the authorization code on the redirect, and
exchanges it for tokens. It then calls the userinfo endpoint to detect the
account email and stores the token under that email. The first account
authenticated becomes the default account.

```console
$ gdrive auth
Authenticated as me@gmail.com (set as default account)
```

```json
{ "success": true,
  "data": { "authenticated": true, "email": "me@gmail.com", "default": true } }
```

Repeat for each additional account — see [`accounts.md`](accounts.md).

## Scopes

| Scope | Why |
|-------|-----|
| `https://www.googleapis.com/auth/drive` | read and modify Drive files |
| `https://www.googleapis.com/auth/documents` | read and edit Google Docs |
| `https://www.googleapis.com/auth/spreadsheets` | read and edit Google Sheets |
| `https://www.googleapis.com/auth/userinfo.email` | detect the account email |

The full `drive` scope (not `drive.file`) is required so the CLI can operate on
files it did not create; Google's consent screen labels it as sensitive. Adding
a scope later means re-running `gdrive auth` for each account.

## Where things are stored

```
~/.config/gdrive-cli/
├── client_secret.json          # OAuth client, shared by all accounts
├── config.toml                 # default account, aliases, defaults
└── accounts/
    ├── work@example.com.json   # per-account tokens (chmod 600)
    └── me@gmail.com.json
```

A token file records the email, access and refresh tokens, expiry, and granted
scopes. Access tokens are refreshed automatically from the refresh token, so
you only log in once per account.

## `gdrive auth status`

```console
$ gdrive auth status
Account: me@gmail.com [default]
Token expires: 2026-07-24 07:16:56
Scopes: documents, userinfo.email, openid, drive, spreadsheets
```

```json
{ "success": true, "data": {
  "authenticated": true,
  "email": "me@gmail.com",
  "alias": null,
  "default": true,
  "expires_at": "2026-07-24T07:16:56.079Z",
  "scopes": ["documents", "userinfo.email", "openid", "drive", "spreadsheets"]
} }
```

Quiet mode prints the email.

## `gdrive auth logout [<email|alias>]`

Revokes the token with Google and deletes the local token file. Without an
argument it logs out the resolved account.

```console
$ gdrive auth logout work
Logged out work@example.com
```

```json
{ "success": true, "data": { "email": "work@example.com", "logged_out": true } }
```

`gdrive account remove` is the same operation and additionally drops the
account's alias entry from the config.

## Troubleshooting

| Symptom | Code | What to do |
|---------|------|------------|
| Never logged in, or no OAuth client configured | `AUTH_REQUIRED` (exit 2) | Run `gdrive auth`; set the client ID/secret |
| Stored token file is corrupt or truncated | `AUTH_REQUIRED` (exit 2) | Re-run `gdrive auth` for that account |
| `client_secret.json` is malformed | `AUTH_REQUIRED` (exit 2) | Re-download it, or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| Refresh fails — token revoked or expired | `AUTH_EXPIRED` (exit 2) | Re-run `gdrive auth` for that account |
| `-a name` names an account that has no token | `ACCOUNT_NOT_FOUND` (exit 2) | `gdrive account list` to see what is authenticated |
| Drive refuses a write on a file you can only read | `PERMISSION_DENIED` (exit 1) | Not an auth problem — ask the owner or a shared-drive organizer for `writer` |
| "Request had insufficient authentication scopes" | `AUTH_REQUIRED` (exit 2) | The token predates a scope change; re-run `gdrive auth` for that account |
| Consent screen says the app is unverified | — | Add your address as a *Test user* on the consent screen |
