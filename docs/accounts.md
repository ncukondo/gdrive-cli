# Multiple accounts

Switching between Google accounts — personal vs. work — is the defining feature
of this CLI. Design rationale: [`../decisions/0004`](../decisions/0004-multi-account.md).

## The model

- An account **is** its Google email, detected at login. That email is the
  canonical id and names the token file.
- Any account may get a short **alias** (`work`, `personal`). Aliases live in
  the config file and are interchangeable with the email everywhere an account
  is referenced.
- One account is the **default**, used when you do not say otherwise.

## Which account runs a command

Resolution order, first match wins:

1. `-a, --account <email|alias>` on the command line
2. `$GDRIVE_CLI_ACCOUNT`
3. `default_account` in the config file
4. the sole authenticated account, if there is exactly one
5. otherwise: `ACCOUNT_NOT_FOUND` (or `AUTH_REQUIRED` when nothing is
   authenticated at all)

## Typical workflow

```sh
gdrive auth                                # log in as me@gmail.com (becomes default)
gdrive auth                                # log in again, this time as work@example.com

gdrive account alias work@example.com work # give it a short name
gdrive account alias me@gmail.com personal

gdrive account use work                    # make work the default
gdrive ls                                  # runs as work@example.com
gdrive ls -a personal                      # one-off on the other account
GDRIVE_CLI_ACCOUNT=personal gdrive ls      # same, for a whole shell session
```

## Commands

### `gdrive account list`

Reconciles the token files with the `[[accounts]]` entries in the config, so an
account that is authenticated but not in the config still shows up (and vice
versa, marked as not authenticated). The default is listed first and marked
`*`.

```console
$ gdrive account list
* work@example.com (work)
  me@gmail.com (personal)
```

```json
{ "success": true, "data": {
  "accounts": [
    { "email": "work@example.com", "alias": "work", "default": true, "authenticated": true },
    { "email": "me@gmail.com", "alias": "personal", "default": false, "authenticated": true }
  ],
  "default_account": "work@example.com"
} }
```

Quiet mode prints one authenticated email per line.

### `gdrive account use <email|alias>`

Sets `default_account` in the config. Fails with `ACCOUNT_NOT_FOUND` if that
account has no token.

```console
$ gdrive account use work
Default account set to work@example.com
```

```json
{ "success": true, "data": { "default_account": "work@example.com" } }
```

### `gdrive account alias <email|alias> <alias>`

Assigns or renames an alias. An alias already used by a different account is
rejected with `INVALID_ARGS`.

```console
$ gdrive account alias work@example.com w
Alias "w" -> work@example.com
```

```json
{ "success": true, "data": { "email": "work@example.com", "alias": "w" } }
```

### `gdrive account remove <email|alias>`

Revokes the token, deletes the token file, and drops the account's config
entry. If it was the default, `default_account` is cleared.

```console
$ gdrive account remove personal
Removed me@gmail.com
```

```json
{ "success": true, "data": { "email": "me@gmail.com", "removed": true } }
```

## Notes

- The OAuth client (`client_secret.json`) is shared by every account; only
  tokens are per-account.
- Aliases are a config concern, not a token concern — see
  [`configuration.md`](configuration.md) for the file format.
- `gdrive auth logout` is the token-only version of `account remove`.
