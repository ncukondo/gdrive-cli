# gdrive-cli

A command-line tool for **Google Drive, Docs, and Sheets** — listing and
managing files, reading and making simple edits to Documents and Spreadsheets —
with **multiple-account switching**. A sibling of
[`gcal-cli`](https://github.com/ncukondo/gcal-cli), designed for both human and
AI-agent use.

## Highlights

- **Multiple accounts** — authenticate several Google accounts, switch with
  `gdrive account use` or per-command `-a work@example.com` / `-a work`.
- **Drive** — `ls`, `search`, `info`, `download`, `upload`, `mkdir`, `mv`,
  `cp`, `rm` (trash by default). Files addressed by ID or `Folder/name` path.
- **Docs** — `read` (Markdown/text), `create`, `append`, `replace`
  (find & replace), `insert` at a position.
- **Sheets** — `tabs`, `read` (table/CSV/JSON), `write`, `append`, `clear`,
  `create`.
- **Sharing** — `share list / add / remove / link` to manage permissions.
- **Agent-first** — the primary consumer is an AI agent: `-f json` is a stable,
  first-class interface, with `-q` quiet piping and stable exit codes.

## Install

```sh
# npm (global) or npx
npm i -g @ncukondo/gdrive-cli
npx @ncukondo/gdrive-cli --help

# single-file binary (no runtime required)
curl -fsSL https://raw.githubusercontent.com/ncukondo/gdrive-cli/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/ncukondo/gdrive-cli/main/install.ps1 | iex
```

The installer downloads the binary for your platform from GitHub Releases,
verifies its SHA-256 checksum, and installs it to `~/.local/bin`
(`%LOCALAPPDATA%\gdrive-cli` on Windows). Set `GDRIVE_CLI_VERSION` to pin a
release and `GDRIVE_CLI_INSTALL_DIR` to relocate.

Update a binary install in place with `gdrive upgrade` (`--dry-run` reports the
target version without changing anything). npm installs are upgraded with your
package manager instead. See [`decisions/0003`](decisions/0003-distribution.md).

## Google Cloud setup

`gdrive` uses **your own** OAuth client. Create a Google Cloud project, enable
the **Drive**, **Docs**, and **Sheets** APIs, create **OAuth 2.0 Desktop app**
credentials, and provide the Client ID / Secret when `gdrive auth` prompts (or
via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`). Step-by-step:
[`docs/authentication.md`](docs/authentication.md).

## Quick start

```sh
gdrive auth                          # log in; detects the account email
gdrive init                          # write a config seeded from your accounts

gdrive ls                            # list My Drive root
gdrive ls "Reports/2026" --type sheet
gdrive search budget -n 5

gdrive docs read "Notes/Meeting"     # Markdown to stdout
gdrive sheets read "Reports/2026/Budget" "Sheet1!A1:C10" --as csv
gdrive share link "Reports/2026/Budget"
```

Several accounts:

```sh
gdrive auth                          # log in as the second account
gdrive account alias work@example.com work
gdrive account use work              # make it the default
gdrive ls -a personal                # one-off on another account
```

For scripts and agents:

```sh
gdrive ls -f json | jq '.data.files[].name'
FOLDER=$(gdrive mkdir 2027 --parent Reports -q)   # quiet mode prints the ID
gdrive sheets read 1GhI... -q > out.csv           # quiet read prints CSV
```

## Documentation

- Command reference: [`docs/commands.md`](docs/commands.md) — every command
  with an example and its JSON shape
- Authentication & Google Cloud setup: [`docs/authentication.md`](docs/authentication.md)
- Multiple accounts: [`docs/accounts.md`](docs/accounts.md)
- Configuration & environment variables: [`docs/configuration.md`](docs/configuration.md)
- Design & rationale: [`decisions/`](decisions/)
- Development plan: [`tasks/README.md`](tasks/README.md)

## Development

```sh
bun install
bun run dev --help      # run the CLI from source
bun run test:all        # vitest
bun run typecheck
bun run lint            # oxlint
bun run format          # oxfmt
```

The workflow — decisions, tasks, TDD — is described in
[`CLAUDE.md`](CLAUDE.md) and [`decisions/0001`](decisions/0001-development-process.md).

## License

MIT
