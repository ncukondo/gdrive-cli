# Command reference

Every command, with an example and its JSON shape. Design rationale lives in
[`../decisions/`](../decisions/); authentication, accounts, and the config file
have their own pages:

- [`authentication.md`](authentication.md) — Google Cloud setup, scopes, login
- [`accounts.md`](accounts.md) — multiple accounts, aliases, `-a`
- [`configuration.md`](configuration.md) — config file and environment variables

## Global options

| Option | Description |
|--------|-------------|
| `-a, --account <email\|alias>` | Account to use (overrides the default) |
| `-f, --format <text\|json>` | Output format (default `text`) |
| `-q, --quiet` | Minimal output for piping |
| `--config <path>` | Config file path |
| `-h, --help`, `-V, --version` | Help / version |

Account resolution: `-a` > `$GDRIVE_CLI_ACCOUNT` > `default_account` in config >
the sole authenticated account. Format resolution: `-f` > `$GDRIVE_CLI_FORMAT` >
`default_format` in config > `text`.

## Output modes

Three modes, chosen with `-f` and `-q`:

- **text** (default) — human-readable tables and sentences.
- **`-q` quiet** — one value per line, made for pipes: usually IDs. Some
  commands (`rm`, `share remove`, `sheets clear`) print nothing at all.
- **`-f json`** — a stable envelope. `--quiet` is ignored in JSON mode.

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

The `data` shapes below are what goes in that envelope.

## Addressing files

Anywhere a command takes `<file>` or `<folder>`, you can pass a Drive **ID**, a
**path** relative to My Drive root, or a path on a shared drive:

```sh
gdrive info 1AbCdEf...                    # by ID
gdrive info "Reports/2026/summary"        # by path, in My Drive
gdrive info "drive:Finance/2026/Budget"   # by path, on a shared drive
```

Paths are resolved segment by segment; a segment that matches nothing is
`NOT_FOUND`, and one that matches several files is `INVALID_ARGS`.

An argument that *looks like* an ID — 20 or more characters of
`[A-Za-z0-9_-]` with no slash, or a shared drive's 19-character root ID
(`0A` + 17 characters) — is always treated as an ID, so a file whose name
happens to match one of those shapes has to be addressed by its real ID.

### Shared drives

**Every command that takes a file or folder ID accepts one from a shared
drive**, and treats it exactly like a My Drive file — `ls`, `info`, `download`,
`upload`, `mkdir`, `mv`, `cp`, `rm`, `share`, `docs`, and `sheets` alike. Copy
the ID out of the Drive URL (`https://docs.google.com/document/d/<ID>/edit`)
and pass it. No flag is involved.

That includes a shared drive's **root** ID, which `gdrive drives` prints and
`info` reports in `parents`, so you can put a file at the top level of a shared
drive:

```sh
gdrive drives                            # names and IDs
gdrive ls 0ABcDeFgHiJkLmNoPqR            # a shared drive's root
gdrive mkdir 2027 --parent 0ABcDeFgHiJkLmNoPqR
```

**Paths reach a shared drive through a `drive:` prefix.** A bare path is always
a My Drive path — `"Finance/2026"` is the My Drive folder even when a shared
drive is also called `Finance`. Put `drive:<name>/` in front to mean the drive:

```sh
gdrive ls   "drive:Finance"                   # the drive's root
gdrive ls   "drive:Finance/2026"              # a folder inside it
gdrive mv   1AbCdEf... "drive:Finance/2026"   # as a destination, too
```

The name must match what `gdrive drives` prints, exactly and case-sensitively.
An unknown name is `NOT_FOUND` listing the ones that exist; a name shared by two
drives is `INVALID_ARGS` listing their IDs. A drive whose name contains a `/`
cannot be written this way — use its root ID.

When a plain path fails on its first segment and a shared drive has that name,
the error says so:

```console
$ gdrive ls "Finance/2026"
Error: No such file or folder: Finance. A shared drive has that name — did you
mean "drive:Finance/2026"?
```

`search` is the one command that still looks only at My Drive by default,
because it asks an open question rather than following an ID; `--all-drives`
and `--drive <name>` widen it (see below).

Sharing works on shared-drive files too, including the two roles only they have:
[`share add --role organizer | fileOrganizer`](#gdrive-share-add-file). A drive
root ID as the `<file>` argument makes that a membership change on the drive
itself.

## The file object

`ls`, `search`, `info`, `upload`, `mkdir`, `mv`, `cp`, and `rm` all report files
in one normalized shape. `size` is `null` for Google-native files (Docs, Sheets,
Slides, folders):

```json
{
  "id": "1AbCdEf...",
  "name": "photo.png",
  "mime_type": "image/png",
  "type": "file",
  "size": 6172242,
  "parents": ["0AIhndZ..."],
  "trashed": false,
  "web_view_link": "https://drive.google.com/file/d/1AbCdEf.../view",
  "created": "2026-07-23T23:59:15.000Z",
  "modified": "2026-07-23T23:59:15.000Z",
  "owners": ["me@gmail.com"]
}
```

`type` is one of `folder`, `doc`, `sheet`, `slides`, `file`.

---

## Auth & accounts

Covered in detail in [`authentication.md`](authentication.md) and
[`accounts.md`](accounts.md).

| Command | Description |
|---------|-------------|
| `gdrive auth [login]` | OAuth login; detects the account email |
| `gdrive auth status` | Show the resolved account's auth state |
| `gdrive auth logout [<email\|alias>]` | Revoke and remove an account |
| `gdrive account list` | List accounts, aliases, and the default |
| `gdrive account use <email\|alias>` | Set the default account |
| `gdrive account alias <email\|alias> <alias>` | Assign/rename an alias |
| `gdrive account remove <email\|alias>` | Remove an account (revoke + drop alias) |

---

## Drive

### `gdrive ls [<folder>]`

Lists a folder's direct children; My Drive root when the argument is omitted.

| Option | Description |
|--------|-------------|
| `--type <t>` | `folder` \| `doc` \| `sheet` \| `slides` \| `file` |
| `--trashed` | List trashed files instead |
| `-n, --limit <n>` | Cap the number of results |
| `--order <o>` | `name` \| `modified` \| `created` |
| `--drive <name>` | List the root of this shared drive (not with `<folder>`) |

```console
$ gdrive ls "Reports/2026" --type sheet -n 2 --order modified
Type    Modified          Name                       ID
sheet   2026-07-24 06:17  Budget                     1S6cRd...
sheet   2026-06-02 11:40  Headcount                  1QwErT...
```

```json
{ "files": [ { /* file object */ } ] }
```

Quiet: one file ID per line.

A folder ID from a shared drive works with no flag at all — `ls` follows
whatever folder it is given:

```console
$ gdrive ls 1FoLdErOnAsHaReDdRiVe          # a folder inside a shared drive
$ gdrive ls 0ABcDeFgHiJkLmNoPqR            # a shared drive's root, by ID
$ gdrive ls --drive "Team Drive"           # the same root, by name
```

`--drive <name>` is a convenience for the last form: it names the shared drive
whose root to list, so it **cannot be combined with a `<folder>` argument** —
that would be a second answer to the same question, and the combination is
`INVALID_ARGS`. To name a folder inside a shared drive, put it in the path —
`gdrive ls "drive:Finance/2026"` — or pass its ID.

The name must match exactly: an unknown one is `NOT_FOUND` and lists the names
that do exist, and two drives sharing a name are `INVALID_ARGS` listing their
IDs. Run [`gdrive drives`](#gdrive-drives) to see them.

There is no `--all-drives` on `ls`: every listing is the children of one
folder, so there is no wider corpus for it to reach. Use
[`gdrive drives`](#gdrive-drives) to enumerate shared drives, and
`--all-drives` on `search`.

### `gdrive search <query>`

Searches file names and full text across My Drive.

| Option | Description |
|--------|-------------|
| `--type <t>`, `-n, --limit <n>`, `--order <o>` | As for `ls` |
| `--all-drives` | Search every shared drive as well as My Drive |
| `--drive <name>` | Search only the shared drive with this name |

```console
$ gdrive search budget --type sheet
Type    Modified          Name                       ID
sheet   2026-07-24 06:17  Budget                     1S6cRd...

$ gdrive search budget --drive "Finance"   # one shared drive
$ gdrive search budget --all-drives        # My Drive + every shared drive
```

```json
{ "files": [ { /* file object */ } ] }
```

Quiet: one file ID per line.

Shared drives are excluded unless you ask for them: on an account with
organizational drives attached, widening the search is usually noise, so the
default answers "my files". Both flags together are `INVALID_ARGS`.

### `gdrive drives`

Lists the shared drives this account can see. Takes no arguments and no
options.

```console
$ gdrive drives
Name                            ID
Team Drive                      0ABcDeFgHiJkLmNoPqR
Finance                         0AZyXwVuTsRqPoNmLkJ
```

```json
{ "drives": [ { "id": "0ABcDeFgHiJkLmNoPqR", "name": "Team Drive" } ] }
```

Quiet: one drive ID per line.

The ID column answers two things: it is a folder ID like any other, so it goes
straight into `ls`, `--parent`, `mv`, and `cp`, and the name column is what
`--drive` matches against.

```sh
gdrive mkdir 2027 --parent "$(gdrive drives -q | head -1)"
```

Text output is `No shared drives.` when the account has none; JSON is an empty
`drives` array.

### `gdrive info <file>`

```console
$ gdrive info "Reports/2026/Budget"
Name:      Budget
Type:      sheet
ID:        1S6cRd...
MIME:      application/vnd.google-apps.spreadsheet
Size:      -
Modified:  2026-07-24T06:17:02.000Z
Created:   2026-07-24T06:17:00.000Z
Owners:    me@gmail.com
Trashed:   false
Link:      https://docs.google.com/spreadsheets/d/1S6cRd.../edit
```

```json
{ "file": { /* file object */ } }
```

Quiet: the file ID.

Given a shared drive's root ID, `info` reports the drive's own name — the same
one `gdrive drives` prints — and `type: folder`, because that is what a drive
root behaves as. (Drive's own API answers `Drive` there, identically for every
drive; see [`../decisions/0020`](../decisions/0020-drive-root-name.md).)

### `gdrive download <file>`

Downloads binary content, or exports a Google-native file. With no `-o`, the
bytes go to stdout so you can pipe them.

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Write to a local file instead of stdout |
| `--export-as <fmt>` | `pdf` \| `docx` \| `xlsx` \| `csv` \| `md` \| `txt` |

A Doc or Sheet with no `--export-as` defaults to `pdf` / `csv`. Binary files are
downloaded as-is; passing `--export-as` for one is `INVALID_ARGS`.

```console
$ gdrive download "Reports/2026/Notes" --export-as md -o notes.md
Downloaded Notes to notes.md

$ gdrive download 1AbC... > photo.png
```

```json
{ "file": "Notes", "id": "1AbC...", "path": "notes.md", "bytes": 20481 }
```

Quiet: the output path (nothing when writing to stdout).

### `gdrive upload <local>`

| Option | Description |
|--------|-------------|
| `--parent <folder>` | Parent folder ID or path |
| `--name <name>` | Name in Drive (defaults to the local filename) |
| `--as-doc` / `--as-sheet` | Convert to a Google Doc / Sheet on upload |

```console
$ gdrive upload ./data.csv --parent Reports --name Budget --as-sheet
Uploaded Budget (1S6cRd...)
```

```json
{ "file": { /* file object */ } }
```

Quiet: the new file ID.

### `gdrive mkdir <name>`

```console
$ gdrive mkdir 2027 --parent Reports
Created folder 2027 (1FoLdEr...)
```

```json
{ "file": { /* file object */ } }
```

Quiet: the new folder ID.

### `gdrive mv <file> <folder>` / `gdrive cp <file> <folder>`

`mv` detaches the file from its current parents; `cp` takes an optional
`--name` for the copy.

```console
$ gdrive mv "Inbox/Budget" "Reports/2026"
Moved Budget to 1FoLdEr...

$ gdrive cp "Reports/2026/Budget" Archive --name "Budget (2026)"
Copied to Budget (2026) (1CoPy...)
```

```json
{ "file": { /* file object */ } }
```

Quiet: the file ID.

### `gdrive rm <file>`

Moves the file to the trash. `--permanent` deletes it outright — that cannot be
undone.

```console
$ gdrive rm "Reports/2026/Draft"
Trashed Draft (1DrAfT...)
```

```json
{ "file": { /* file object */ }, "trashed": true }
{ "id": "1DrAfT...", "deleted": true }
```

The second shape is what `--permanent` returns. Quiet: prints nothing.

---

## Sharing (`gdrive share`)

Permission management. Ownership transfer is not supported — see
[`../decisions/0011`](../decisions/0011-sharing-commands.md).

The permission object:

```json
{ "id": "perm-abc", "type": "user", "role": "writer",
  "email": "alice@example.com", "display_name": "Alice",
  "domain": null, "allow_file_discovery": false, "deleted": false }
```

`type` is `user`, `group`, `domain`, or `anyone`.

### `gdrive share list <file>`

```console
$ gdrive share list "Reports/2026/Budget"
Role       Type    Grantee                 Permission ID
owner      user    me@gmail.com            15586974644968362332
writer     anyone  (anyone with link)      anyoneWithLink
```

```json
{ "id": "1S6cRd...", "permissions": [ { /* permission object */ } ] }
```

Quiet: one permission ID per line.

### `gdrive share add <file>`

Exactly one grantee option is required.

| Option | Description |
|--------|-------------|
| `--to <email>` | A user, or a group for a `@googlegroups.com` address |
| `--domain <domain>` | Everyone in a domain |
| `--anyone` | Anyone with the link |
| `--role <role>` | `reader` (default) \| `commenter` \| `writer` \| `fileOrganizer` \| `organizer` |
| `--notify` | Send a notification email (off by default) |
| `--message <text>` | Message included in that email |
| `--allow-discovery` | Make the file discoverable in search |

```console
$ gdrive share add "Reports/2026/Budget" --to alice@example.com --role writer
Granted writer to alice@example.com (perm-abc)
```

```json
{ "id": "1S6cRd...", "permission": { /* permission object */ } }
```

Quiet: the new permission ID. `--role owner` is rejected with `INVALID_ARGS`.

`fileOrganizer` and `organizer` exist only on **shared drives**, spelled as the
API spells them so `share list` output can be fed straight back. Pass a drive's
root ID (from `gdrive drives`) as `<file>` to add a member to the drive itself:

```console
$ gdrive share add 0ANPgzMZtaAa6Uk9PVA --to alice@example.com --role organizer
Granted organizer to alice@example.com (perm-abc)
```

`organizer` is drive-level: granting it on a *folder inside* a drive is
refused by Drive with `PERMISSION_DENIED` — `Organizer role is only valid for
shared drives.` Use `fileOrganizer` there, or pass the drive root ID.
`--anyone` with either role is `INVALID_ARGS`, since an anyone-with-link
permission cannot hold them. See
[`../decisions/0018`](../decisions/0018-shared-drive-roles.md).

### `gdrive share remove <file>`

Requires `--to <email>` (resolved to its permission ID) or an explicit
`--permission-id <id>`. An email with no permission on the file is `NOT_FOUND`.

```console
$ gdrive share remove "Reports/2026/Budget" --to alice@example.com
Removed permission perm-abc from 1S6cRd...
```

```json
{ "id": "1S6cRd...", "permission_id": "perm-abc", "removed": true }
```

Quiet: prints nothing.

### `gdrive share link <file>`

Ensures an "anyone with link" permission and prints the shareable URL. An
existing one is reused, and upgraded when `--role` differs. `--role` takes
`reader` (default), `commenter`, or `writer` only — the shared-drive roles are
not link roles.

```console
$ gdrive share link "Reports/2026/Budget" --role writer
Anyone with the link (writer)
https://docs.google.com/spreadsheets/d/1S6cRd.../edit
```

```json
{ "id": "1S6cRd...", "web_view_link": "https://docs.google.com/...",
  "permission": { /* permission object */ } }
```

Quiet: just the URL.

---

## Docs (`gdrive docs`)

Text arguments accept a literal string, `@file` to read a local file, or `-` to
read stdin.

### `gdrive docs read <file>`

`--as markdown` (default) maps headings, bold/italic, links, bulleted and
numbered lists, and — best effort — tables. `--as text` emits plain paragraph
text. Both print the body to stdout, in quiet mode too.

Rendering is best effort: a numbered list becomes `1.` only when Docs reports
its glyph, and documents converted from HTML report no glyph information, so
their numbered lists come back as `-`.

```console
$ gdrive docs read "Notes/Meeting"
# Meeting notes
Discussed the **budget** and [the plan](https://example.com).
- ship on Friday
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes", "format": "markdown",
  "content": "# Meeting notes\n..." }
```

### `gdrive docs create <title>`

| Option | Description |
|--------|-------------|
| `--content <text\|@file\|->` | Initial body content |
| `--parent <folder>` | Parent folder ID or path |

The Docs API always creates in My Drive, so `--parent` is applied as a move
right after creation.

```console
$ gdrive docs create "Meeting notes" --content @agenda.md --parent Notes
Created Meeting notes (1BzqpK...)
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes", "parent_id": "1FoLdEr..." }
```

Content is inserted as plain text — Markdown in the input is not converted to
Docs formatting. Quiet: the new document ID.

### `gdrive docs append <file> <text|@file|->`

Appends the text as a new paragraph at the end of the body.

```console
$ echo "decided: ship on Friday" | gdrive docs append "Notes/Meeting" -
Appended to Meeting notes (1BzqpK...)
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes" }
```

Quiet: the document ID.

### `gdrive docs replace <file>`

Replaces every match and reports how many. `--find` and `--replace` are
required; matching is case-insensitive unless `--match-case` is given. `--all`
is accepted for clarity but changes nothing — all matches are always replaced.

```console
$ gdrive docs replace "Notes/Meeting" --find Q3 --replace Q4 --match-case
Replaced 3 occurrences
```

```json
{ "id": "1BzqpK...", "replaced": 3, "message": "Replaced 3 occurrences" }
```

Quiet: the document ID.

### `gdrive docs insert <file> <text|@file|->`

Exactly one position is required: `--index <n>` (Docs' 1-based character index
in the body) or `--at start|end`.

```console
$ gdrive docs insert "Notes/Meeting" "DRAFT — " --at start
Inserted into Meeting notes (1BzqpK...)
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes", "index": 1 }
```

Quiet: the document ID.

---

## Sheets (`gdrive sheets`)

`<range>` is A1 notation, optionally tab-qualified (`Sheet1!A1:C10`). A range
that names a tab wins; otherwise `--tab <name>` qualifies it, and with neither
the first *visible* tab is used. Omitting the range targets the whole tab.

`--values` takes CSV (RFC 4180 quoting) or a JSON 2-D array, directly or via
`@file` / `-`; input starting with `[` is treated as JSON.

### `gdrive sheets tabs <file>`

```console
$ gdrive sheets tabs "Reports/2026/Budget"
Index  Rows  Cols  Title
0      1000  26    Sheet1
1      50    10    Summary
```

```json
{ "id": "1S6cRd...", "tabs": [
  { "index": 0, "title": "Sheet1", "sheet_id": 0, "rows": 1000, "cols": 26, "hidden": false }
] }
```

Quiet: one tab title per line.

### `gdrive sheets read <file> [<range>]`

`--as` is `table` (default), `csv`, or `json`.

```console
$ gdrive sheets read "Reports/2026/Budget" "Sheet1!A1:B3"
name   score
alice  90
bob    80
```

```json
{ "id": "1S6cRd...", "range": "Sheet1!A1:B3",
  "values": [["name","score"],["alice","90"],["bob","80"]],
  "rows": 3, "cols": 2 }
```

Quiet: CSV to stdout.

### `gdrive sheets write <file> <range>`

`--values` is required. Values are sent RAW by default; `--input-mode user`
lets Sheets parse formulas and dates.

```console
$ gdrive sheets write "Reports/2026/Budget" A1:B2 --values 'name,score
alice,90'
Updated 4 cells in Sheet1!A1:B2
```

```json
{ "id": "1S6cRd...", "updated_range": "Sheet1!A1:B2", "updated_rows": 2,
  "updated_columns": 2, "updated_cells": 4,
  "message": "Updated 4 cells in Sheet1!A1:B2" }
```

Quiet: the updated cell count.

### `gdrive sheets append <file> [<range>]`

Appends rows after the existing table. Same options as `write`; the range is
where to look for that table (the whole tab if omitted).

```console
$ gdrive sheets append "Reports/2026/Budget" --values '[["carol","70"]]'
Appended 1 rows to Sheet1!A4:B4
```

```json
{ "id": "1S6cRd...", "updated_range": "Sheet1!A4:B4", "updated_rows": 1,
  "updated_columns": 2, "updated_cells": 2,
  "message": "Appended 1 rows to Sheet1!A4:B4" }
```

Quiet: the updated cell count.

### `gdrive sheets clear <file> <range>`

Clears values, leaving formatting alone.

```console
$ gdrive sheets clear "Reports/2026/Budget" A4:B4
Cleared Sheet1!A4:B4
```

```json
{ "id": "1S6cRd...", "cleared_range": "Sheet1!A4:B4",
  "message": "Cleared Sheet1!A4:B4" }
```

Quiet: prints nothing.

### `gdrive sheets create <title>`

`--parent <folder>` places the spreadsheet in a folder (created in My Drive
first, then moved).

```console
$ gdrive sheets create Budget --parent "Reports/2026"
Created Budget (1S6cRd...)
```

```json
{ "id": "1S6cRd...", "title": "Budget", "parent_id": "1FoLdEr..." }
```

Quiet: the new spreadsheet ID.

---

## Setup & maintenance

### `gdrive init [--local] [--force]`

Generates the config file, seeded from the authenticated accounts. See
[`configuration.md`](configuration.md).

```json
{ "path": "/home/me/.config/gdrive-cli/config.toml",
  "accounts": ["work@example.com"], "default_account": "work@example.com",
  "created": true }
```

### `gdrive upgrade [--dry-run]`

Updates a **binary** install in place: fetches the latest GitHub release,
verifies its SHA-256 against `SHA256SUMS`, and swaps the executable atomically.
`--dry-run` reports the target version and downloads nothing; a checksum
mismatch aborts without touching the binary. Running under Node or Bun (npm,
npx, bunx), it prints the package-manager command instead.

```console
$ gdrive upgrade --dry-run
Would upgrade v0.1.0 -> v0.2.0 using gdrive-linux-x64.
```

```json
{ "status": "dry-run", "current_version": "0.1.0", "latest_version": "0.2.0",
  "asset": "gdrive-linux-x64" }
{ "status": "upgraded", "current_version": "0.1.0", "latest_version": "0.2.0" }
{ "status": "up-to-date", "current_version": "0.2.0" }
{ "status": "not-binary", "package": "@ncukondo/gdrive-cli" }
```

Quiet: the target version.

Install itself is covered in the [README](../README.md): npm, `npx`, or the
`install.sh` / `install.ps1` binary installers, which verify the checksum and
honor `GDRIVE_CLI_VERSION` and `GDRIVE_CLI_INSTALL_DIR`. See
[`../decisions/0003`](../decisions/0003-distribution.md).

---

## Exit codes

| Code | Meaning | Error codes |
|------|---------|-------------|
| `0` | Success | — |
| `1` | Operation failed | `NOT_FOUND`, `PERMISSION_DENIED`, `API_ERROR`, `CONFIG_ERROR`, `IO_ERROR` |
| `2` | Authentication problem | `AUTH_REQUIRED`, `AUTH_EXPIRED`, `ACCOUNT_NOT_FOUND` |
| `3` | Bad arguments | `INVALID_ARGS` |

Errors go to stderr — as `Error: <message>` in text mode, or as the envelope in
JSON mode. See [`../decisions/0007`](../decisions/0007-output-and-errors.md).

`PERMISSION_DENIED` means the account is signed in and Drive refused anyway —
typically a shared-drive file where you hold `reader` or `commenter` and the
command needs `writer` or `organizer`. Re-running `gdrive auth` will not change
it; ask an organizer of the drive for a higher role. Exit **2** is reserved for
the cases `gdrive auth` really does fix, including a token minted before a
scope was added. See
[`../decisions/0017`](../decisions/0017-permission-denied-error-code.md).
