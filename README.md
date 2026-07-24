# gdrive-cli

A command-line tool for **Google Drive, Docs, and Sheets** — listing and
managing files, reading and making simple edits to Documents and Spreadsheets —
with **multiple-account switching**. A sibling of
[`gcal-cli`](https://github.com/ncukondo/gcal-cli), designed for both human and
AI-agent use.

> Status: **specification / early development.** The design is captured in
> [`decisions/`](decisions/) and the plan in [`tasks/`](tasks/). Commands below
> describe the target behavior.

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

# single-file binary (planned) — see decisions/0003
curl -fsSL https://raw.githubusercontent.com/ncukondo/gdrive-cli/main/install.sh | bash
```

## Quick start

```sh
gdrive auth                       # log in; detects the account email
gdrive account alias me@x.com work
gdrive account use work           # set default account
gdrive ls                         # list My Drive root
gdrive ls "Reports/2026"          # by path
gdrive docs read 1AbC... --as markdown
gdrive sheets read 1GhI... "Sheet1!A1:C10" --as csv
gdrive ls -a personal@gmail.com   # one-off on another account
```

## Google Cloud setup

Create a Google Cloud project, enable the **Drive**, **Docs**, and **Sheets**
APIs, create **OAuth 2.0 Desktop app** credentials, and provide the Client ID /
Secret when `gdrive auth` prompts (or via `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET`). See [`decisions/0005`](decisions/0005-auth-and-scopes.md).

## Documentation

- Design & rationale: [`decisions/`](decisions/)
- Command reference: [`docs/commands.md`](docs/commands.md)
- Development plan: [`tasks/README.md`](tasks/README.md)

## License

MIT
