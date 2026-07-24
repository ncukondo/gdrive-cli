# Command reference

User-facing behavior. Design rationale lives in [`../decisions/`](../decisions/).

## Global options

| Option | Description |
|--------|-------------|
| `-a, --account <email\|alias>` | Account to use (overrides default) |
| `-f, --format <text\|json>` | Output format (default `text`) |
| `-q, --quiet` | Minimal output for piping |
| `--config <path>` | Config file path |
| `-h, --help`, `--version` | Help / version |

Account resolution: `-a` > `GDRIVE_CLI_ACCOUNT` > `default_account` in config >
the sole authenticated account. See [`../decisions/0004`](../decisions/0004-multi-account.md).

## Auth & accounts

| Command | Description |
|---------|-------------|
| `gdrive auth [login]` | OAuth login; detects the account email |
| `gdrive auth status` | Show the resolved account's auth state |
| `gdrive auth logout [<email\|alias>]` | Revoke and remove an account |
| `gdrive account list` | List accounts, aliases, and the default |
| `gdrive account use <email\|alias>` | Set the default account |
| `gdrive account alias <email\|alias> <alias>` | Assign/rename an alias |
| `gdrive account remove <email\|alias>` | Remove an account (alias of logout) |
| `gdrive init` | Generate `config.toml` |

## Drive

| Command | Description |
|---------|-------------|
| `gdrive ls [<folder>]` | List a folder (My Drive root if omitted) |
| `gdrive search <query>` | Search files by name / full text |
| `gdrive info <file>` | Show file metadata |
| `gdrive download <file> [-o <path>]` | Download / export (stdout if no `-o`) |
| `gdrive upload <local> [--parent <folder>]` | Upload (`--as-doc`/`--as-sheet` to convert) |
| `gdrive mkdir <name> [--parent <folder>]` | Create a folder |
| `gdrive mv <file> <folder>` | Move |
| `gdrive cp <file> <folder> [--name <name>]` | Copy |
| `gdrive rm <file> [--permanent]` | Trash (default) or delete permanently |

`<file>` / `<folder>` accept a Drive **ID** or a root-relative **path**
(`"Reports/2026/summary"`). See [`../decisions/0008`](../decisions/0008-drive-commands.md).

## Sharing (`gdrive share`)

| Command | Description |
|---------|-------------|
| `share list <file>` | List all permissions |
| `share add <file> (--to <email> \| --domain <d> \| --anyone) [--role reader\|commenter\|writer] [--notify]` | Grant access |
| `share remove <file> (--to <email> \| --permission-id <id>)` | Revoke access |
| `share link <file> [--role reader]` | Ensure "anyone with link" and print the URL |

Ownership transfer is not yet supported. See
[`../decisions/0011`](../decisions/0011-sharing-commands.md).

## Docs (`gdrive docs`)

| Command | Description |
|---------|-------------|
| `read <file> [--as markdown\|text]` | Export the body (default markdown) |
| `create <title> [--content <text\|@file\|->] [--parent]` | New document |
| `append <file> <text\|@file\|->` | Append a paragraph |
| `replace <file> --find <s> --replace <s> [--match-case]` | Find & replace |
| `insert <file> <text\|@file\|-> (--index <n> \| --at start\|end)` | Insert text |

See [`../decisions/0009`](../decisions/0009-docs-commands.md).

## Sheets (`gdrive sheets`)

| Command | Description |
|---------|-------------|
| `tabs <file>` | List tabs (sheets) |
| `read <file> [<range>] [--tab <name>] [--as table\|csv\|json]` | Read values |
| `write <file> <range> --values <csv\|json\|@file\|->` | Overwrite a range |
| `append <file> [<range>] --values <csv\|json\|@file\|->` | Append rows |
| `clear <file> <range>` | Clear a range |
| `create <title> [--parent <folder>]` | New spreadsheet |

`<range>` is A1 notation, optionally tab-qualified (`Sheet1!A1:C10`). See
[`../decisions/0010`](../decisions/0010-sheets-commands.md).

## Exit codes

`0` success · `1` general/operation error · `2` authentication error ·
`3` argument error. Error codes and JSON envelope:
[`../decisions/0007`](../decisions/0007-output-and-errors.md).
