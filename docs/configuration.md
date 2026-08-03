# Configuration

The config file records the default account, aliases, and output defaults.
Design rationale: [`../decisions/0006`](../decisions/0006-configuration.md).

## Where the config comes from

Resolution order, first match wins:

1. `--config <path>`
2. `$GDRIVE_CLI_CONFIG`
3. `./gdrive-cli.toml` (current directory)
4. `~/.config/gdrive-cli/config.toml`

A path given explicitly (option or environment variable) that does not exist is
a `CONFIG_ERROR`; the implicit locations are simply skipped when absent. With no
config anywhere, built-in defaults apply — the CLI still works, it just has no
default account or aliases, and it emits JSON.

`default_format` is where a person at a terminal moves the default back to
text. Unasked, every command emits its machine representation
([`../decisions/0036`](../decisions/0036-machine-format-by-default.md)):

```toml
default_format = "text"
```

## Format

```toml
# Account used when -a/--account and $GDRIVE_CLI_ACCOUNT are absent.
# May be an email or an alias.
default_account = "work"

# Default output format: "json" (default) or "text"
default_format = "json"

# Known accounts. `email` is canonical (it matches accounts/<email>.json).
# `alias` is optional and interchangeable with the email on the CLI.
[[accounts]]
email = "work@example.com"
alias = "work"

[[accounts]]
email = "me@gmail.com"
alias = "personal"
```

`[[accounts]]` is an alias registry, not a token store — token material lives in
`~/.config/gdrive-cli/accounts/<email>.json` (see
[`authentication.md`](authentication.md)). An account can be authenticated
without an entry here; the entry only adds an alias.

Invalid values fail loudly: a malformed file or a bad `default_format` is a
`CONFIG_ERROR`, as is an `[[accounts]]` entry without an `email`.

## `gdrive init`

Generates the file for you, seeded from the accounts you have already
authenticated, with `default_account` set to the first of them.

```console
$ gdrive init -f text
Created /home/me/.config/gdrive-cli/config.toml
Accounts: work@example.com, me@gmail.com
Default: work@example.com
```

The file it writes carries `default_format = "json"` — the same default the CLI
applies without a config, written down rather than inverted.

```json
{ "success": true, "data": {
  "path": "/home/me/.config/gdrive-cli/config.toml",
  "accounts": ["work@example.com", "me@gmail.com"],
  "default_account": "work@example.com",
  "created": true
} }
```

| Option | Effect |
|--------|--------|
| `--local` | Write `./gdrive-cli.toml` instead of the default location |
| `--force` | Overwrite an existing config file |
| `--config <path>` | Write exactly this path (takes precedence over `--local`) |

Without `--force`, an existing file is left alone and the command fails with
`CONFIG_ERROR`. Regenerating with `--force` preserves any unrelated keys already
in the file. Quiet mode prints the path.

Commands that edit the config (`account use`, `account alias`,
`account remove`) rewrite the discovered file, or create the default one if
none exists. Comments are not preserved by the TOML writer.

## Environment variables

| Variable | Description |
|----------|-------------|
| `GDRIVE_CLI_CONFIG` | Config file path |
| `GDRIVE_CLI_ACCOUNT` | Account to use (email or alias) |
| `GDRIVE_CLI_FORMAT` | Default output format |
| `GOOGLE_CLIENT_ID` | OAuth client ID (overrides `client_secret.json`) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GDRIVE_CLI_VERSION` | Release tag for the binary installers |
| `GDRIVE_CLI_INSTALL_DIR` | Install location for the binary installers |
