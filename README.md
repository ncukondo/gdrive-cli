# gdrive-cli

A command-line tool for **Google Drive, Docs, Sheets, Forms, and Slides** —
listing and managing files, reading and making simple edits to Documents,
Spreadsheets and Forms, reading Form responses, reading Slides decks — with
**multiple-account switching**. A sibling of
[`gcal-cli`](https://github.com/ncukondo/gcal-cli), designed for both human and
AI-agent use.

## Highlights

- **Multiple accounts** — authenticate several Google accounts, switch with
  `gdrive account use` or per-command `-a work@example.com` / `-a work`.
- **Drive** — `ls`, `search`, `info`, `download`, `upload`, `mkdir`, `mv`,
  `cp`, `ln`, `rename`, `rm` (trash by default). Files addressed by ID or
  `Folder/name` path. `mv` only moves and `rename` only renames, so neither has
  to guess which the second argument meant. `cp -r` copies a whole folder tree —
  Drive has no request that does — and a run that cannot finish reports every
  file it already copied.
- **A name you can address afterwards** — every command that gives a file a name
  refuses one you could not then pass back as a path: one the folder already
  holds, one with a space at either end, one containing `/`, one spelled like the
  root or like an ID, one starting with `drive:`. Drive allows every one of them
  and leaves you a file no path can reach; this says so at the moment it happens,
  and names a replacement it has checked
  ([details](docs/commands.md#a-name-has-to-be-addressable)).
- **Shared drives** — any shared-drive ID works in any command that takes one,
  with no flag, and `drive:<name>/<path>` addresses one by path; `gdrive drives`
  lists the drives and their IDs. Only `search` stays on My Drive by default,
  widened with `--all-drives` / `--drive <name>`.
- **Shortcuts** — paths walk through a folder shortcut and reading one reads
  what it points at, while `rm`, `mv`, `cp`, `rename`, `share`, and `info` keep
  acting on the shortcut itself — the rule POSIX applies to symlinks. `info`
  reports `type: shortcut` with `target_id` / `target_type`, and `ln` makes one.
- **Docs** — Markdown in both directions: `read` renders it, and `create`,
  `append`, `insert`, and `replace` write it back as real headings, tables,
  lists, and links. `--as text` writes the exact bytes instead.
- **Sheets** — `tabs`, `read` (table/CSV/JSON), `write`, `append`, `clear`,
  `create`.
- **Forms** — one YAML document in both directions: `read` prints a whole form,
  ids and all, and `write` applies an edited one back, matching items **by id**
  so a renamed question keeps every answer already attached to it. Every write
  reports its plan, `--dry-run` writes nothing, and deleting a question needs
  `--prune`, because deleting one severs its responses for good. `create` makes
  a form from a document. `forms responses` tabulates the answers with the
  question titles as column headers (table/CSV/JSON), with or without a linked
  spreadsheet. A form reports `type: form`, so `ls --type form` finds one.
- **Slides** — one YAML document in both directions: `read` prints a deck —
  each slide's layout, its placeholder text and its speaker notes, with
  everything else (hand-placed shapes, images, tables, charts) listed read-only
  under `elements` — and `write` applies an edited one back, matching slides
  **by id** and rewriting only the placeholders whose text changed. There is no
  request that sets a shape's text, so a rewritten placeholder loses its inline
  formatting; the plan warns on each one, and `--dry-run` shows the warning
  before anything is written. `create` builds a deck from a document. No
  coordinates in it, in either direction.
- **Sharing** — `share list / add / remove / link` to manage permissions.
- **Agent-first** — the primary consumer is an AI agent, so **JSON is what a
  command emits when it is not told otherwise**, except where the output already
  *is* a document (`docs read` prints Markdown, `forms read` and `slides read`
  print YAML). `-f text` asks for the human-facing layer: one record per line,
  tab-separated, padded nowhere. `-q` prints the bare value whatever the default
  is, and exit codes are stable.

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
the **Drive**, **Docs**, **Sheets**, **Forms**, and **Slides** APIs, create
**OAuth 2.0 Desktop app** credentials, and provide the Client ID / Secret when
`gdrive auth` prompts (or via `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
Step-by-step:
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
gdrive ln "Reports/2026" Shared      # make one, named after its target

gdrive rename "Reports/Notes" "Notes 2026"   # a new name, same folder

gdrive docs read "Notes/Meeting"     # Markdown to stdout
gdrive docs append "Notes/Meeting" @draft.md   # …and Markdown back in
gdrive sheets read "Reports/2026/Budget" "Sheet1!A1:C10" --as csv
gdrive ls Surveys --type form        # the files `forms read` can take
gdrive forms read "Surveys/2026" > form.yaml          # the whole form as YAML
gdrive forms write "Surveys/2026" --file form.yaml    # …and the edited one back
gdrive forms responses "Surveys/2026" --as csv        # answers, by question title
gdrive slides read "Decks/Q3" > deck.yaml             # the whole deck as YAML
gdrive slides write "Decks/Q3" --file deck.yaml --dry-run   # what it would change
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
gdrive ls | jq '.data.files[].name'               # JSON needs no flag
FOLDER=$(gdrive mkdir 2027 --parent Reports -q)   # quiet mode prints the ID
gdrive sheets read 1GhI... -q > out.csv           # quiet read prints CSV
gdrive ls -f text | column -t -s $'\t'            # a table, for a person
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
bun run test            # vitest, once; `test:watch` re-runs on change
bun run typecheck
bun run lint            # oxlint
bun run format          # oxfmt
```

`bun run test` never touches Google. The live suite is separate and runs on
`git push`:

```sh
export GDRIVE_CLI_E2E_FOLDER=<the id of a Drive folder you can lose>
bun run test:e2e
```

Each test file creates its own subfolder there — three, today, since vitest
gives each file a process — does every write inside it, and trashes it when that
file passes. A file that fails anywhere, including in its setup, keeps its folder
so you can look at what happened. No test addresses anything outside its own
subfolder; the only thing the suite touches elsewhere is a sandbox an earlier
run left, which it trashes once that is a day old. The variable must name a
folder id you own: a path, a trashed folder, a drive root, or anything inside a
shared drive is refused before the first write. With the variable
unset the suite skips and `git push` is not blocked, so a clone with no Google
account needs no setup at all.

The workflow — decisions, tasks, TDD — is described in
[`CLAUDE.md`](CLAUDE.md) and [`decisions/0001`](decisions/0001-development-process.md).

## License

MIT
