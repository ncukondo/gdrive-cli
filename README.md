# gdrive-cli

A command-line tool for **Google Drive, Docs, Sheets, and Forms** — listing and
managing files, reading and making simple edits to Documents and Spreadsheets,
reading Forms and their responses — with **multiple-account switching**. A sibling of
[`gcal-cli`](https://github.com/ncukondo/gcal-cli), designed for both human and
AI-agent use.

## Highlights

- **Multiple accounts** — authenticate several Google accounts, switch with
  `gdrive account use` or per-command `-a work@example.com` / `-a work`.
- **Drive** — `ls`, `search`, `info`, `download`, `upload`, `mkdir`, `mv`,
  `cp`, `rm` (trash by default). Files addressed by ID or `Folder/name` path.
- **Shared drives** — any shared-drive ID works in any command that takes one,
  with no flag, and `drive:<name>/<path>` addresses one by path; `gdrive drives`
  lists the drives and their IDs. Only `search` stays on My Drive by default,
  widened with `--all-drives` / `--drive <name>`.
- **Shortcuts** — paths walk through a folder shortcut and reading one reads
  what it points at, while `rm`, `mv`, `cp`, `share`, and `info` keep acting on
  the shortcut itself — the rule POSIX applies to symlinks. `info` reports
  `type: shortcut` with `target_id` / `target_type`.
- **Docs** — Markdown in both directions: `read` renders it, and `create`,
  `append`, `insert`, and `replace` write it back as real headings, tables,
  lists, and links. `--as text` writes the exact bytes instead.
- **Sheets** — `tabs`, `read` (table/CSV/JSON), `write`, `append`, `clear`,
  `create`.
- **Forms** — `forms read` prints a whole form as one YAML document, ids and
  all; `forms responses` tabulates the answers with the question titles as
  column headers (table/CSV/JSON), with or without a linked spreadsheet.
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
the **Drive**, **Docs**, **Sheets**, and **Forms** APIs, create **OAuth 2.0 Desktop app**
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
gdrive search budget --all-drives    # shared drives too (opt-in)

gdrive drives                        # shared drive names and IDs
gdrive info 1AbCdEf...               # any file ID, shared drive or not
gdrive ls 0ABcDeFgHiJkLmNoPqR        # a shared drive's root, by ID
gdrive ls "drive:Finance/2026"       # …or by name and path

gdrive ls "Reports/link-to-2026"     # a folder shortcut: lists the target
gdrive rm "Reports/link-to-2026"     # …but this trashes the shortcut

gdrive docs read "Notes/Meeting"     # Markdown to stdout
gdrive docs append "Notes/Meeting" @draft.md   # …and Markdown back in
gdrive sheets read "Reports/2026/Budget" "Sheet1!A1:C10" --as csv
gdrive forms read "Surveys/2026" > form.yaml          # the whole form as YAML
gdrive forms responses "Surveys/2026" --as csv        # answers, by question title
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
