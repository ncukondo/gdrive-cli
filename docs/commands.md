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

`gdrive init` writes `~/.config/gdrive-cli/config.toml` (or `./gdrive-cli.toml`
with `--local`, or the path given by the global `--config`), seeding
`[[accounts]]` from the already-authenticated accounts and setting
`default_account` to the first one. It refuses to overwrite an existing file
without `--force`; quiet mode prints the path. See
[`../decisions/0006`](../decisions/0006-configuration.md).

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
| `gdrive init [--local] [--force]` | Generate a config file |

## Drive

| Command | Description |
|---------|-------------|
| `gdrive ls [<folder>] [--type <t>] [--trashed] [-n <limit>] [--order <o>]` | List a folder (My Drive root if omitted) |
| `gdrive search <query> [--type <t>] [-n <limit>] [--order <o>]` | Search files by name / full text |
| `gdrive info <file>` | Show file metadata |
| `gdrive download <file> [-o <path>] [--export-as <fmt>]` | Download / export (stdout if no `-o`) |
| `gdrive upload <local> [--parent <folder>]` | Upload (`--as-doc`/`--as-sheet` to convert) |
| `gdrive mkdir <name> [--parent <folder>]` | Create a folder |
| `gdrive mv <file> <folder>` | Move |
| `gdrive cp <file> <folder> [--name <name>]` | Copy |
| `gdrive rm <file> [--permanent]` | Trash (default) or delete permanently |

`<file>` / `<folder>` accept a Drive **ID** or a root-relative **path**
(`"Reports/2026/summary"`). See [`../decisions/0008`](../decisions/0008-drive-commands.md).

Read-command options:

- `--type` — `folder` | `doc` | `sheet` | `slides` | `file`
- `--order` — `name` | `modified` | `created`
- `-n, --limit <n>` — cap the number of results
- `download --export-as` — `pdf` | `docx` | `xlsx` | `csv` | `md` | `txt`.
  Applies to Google Docs/Sheets/Slides; a Doc/Sheet with no `--export-as`
  defaults to `pdf`/`csv`. Binary files download as-is (error if `--export-as`
  is given). With no `-o`, content is written to stdout for piping.

## Sharing (`gdrive share`)

| Command | Description |
|---------|-------------|
| `share list <file>` | List all permissions |
| `share add <file> (--to <email> \| --domain <d> \| --anyone) [--role reader\|commenter\|writer] [--notify] [--message <s>] [--allow-discovery]` | Grant access |
| `share remove <file> (--to <email> \| --permission-id <id>)` | Revoke access |
| `share link <file> [--role reader]` | Ensure "anyone with link" and print the URL |

- Grantee type is inferred: `--to` → `user` (or `group` for a
  `@googlegroups.com` address), `--domain` → `domain`, `--anyone` → `anyone`.
  Exactly one grantee option is required.
- `--role` defaults to `reader`; `--notify` is off by default so agent runs stay
  quiet (Google may still notify for some grants).
- `share remove --to` resolves the email to its permission id; an email with no
  permission on the file is a `NOT_FOUND` error. Quiet mode prints nothing.
- `share link` reuses an existing anyone-with-link permission and upgrades its
  role when `--role` differs. Quiet mode prints just the URL.

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

- `read --as markdown` maps headings, bold/italic, links, bulleted/numbered
  lists, and (best effort) tables; `--as text` emits plain paragraph text. Both
  print the body to stdout, in quiet mode too.
- `create --parent` places the new document in a folder (the Docs API creates in
  My Drive first, then the file is moved).
- `insert --index` is Docs' 1-based character index in the body; `--at start` is
  index 1 and `--at end` is the end of the body. Exactly one of the two is
  required — `append` is the shorthand for adding a paragraph at the end.
- `replace` always replaces every match (`--all` is accepted for clarity) and
  reports the occurrence count; the count is in the JSON `data.replaced`.
- Quiet `create`/`append`/`replace`/`insert` print the document ID.

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

`<range>` is A1 notation, optionally tab-qualified (`Sheet1!A1:C10`).

- A range that names a tab wins; otherwise `--tab <name>` qualifies it, and
  with neither the first *visible* tab is used. Omitting the range targets the
  whole tab (its used range).
- `--values` accepts CSV (RFC 4180 quoting) or a JSON 2-D array
  (`[["a","b"],["c","d"]]`), directly or via `@file` / `-`; input starting with
  `[` is treated as JSON.
- `write`/`append` send values RAW by default; `--input-mode user` lets Sheets
  parse formulas and dates.
- `read --as` is `table` (default), `csv`, or `json`; quiet `read` prints CSV.
  Quiet `write`/`append` print the updated cell count, quiet `clear` prints
  nothing, quiet `create` prints the new spreadsheet ID.
- `create --parent` places the new spreadsheet in a folder (the Sheets API
  creates in My Drive first, then the file is moved).

See [`../decisions/0010`](../decisions/0010-sheets-commands.md).

## Exit codes

`0` success · `1` general/operation error · `2` authentication error ·
`3` argument error. Error codes and JSON envelope:
[`../decisions/0007`](../decisions/0007-output-and-errors.md).
