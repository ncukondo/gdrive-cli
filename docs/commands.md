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
| `-f, --format <text\|json>` | Output format (default `json`) |
| `-q, --quiet` | Minimal output for piping |
| `--config <path>` | Config file path |
| `-h, --help`, `-V, --version` | Help / version |

Account resolution: `-a` > `$GDRIVE_CLI_ACCOUNT` > `default_account` in config >
the sole authenticated account. Format resolution: `-f` > `$GDRIVE_CLI_FORMAT` >
`default_format` in config > `json`.

Only `-f` *names* a format; everything after it is a default, and three things
outrank a default. `-q` prints the bare value whatever the default is, a named
`--as` prints that encoding
([`../decisions/0038`](../decisions/0038-quiet-asks-for-a-value.md)), and a
command whose output is a document prints the document
([`../decisions/0036`](../decisions/0036-machine-format-by-default.md) §1).
`gdrive auth` asks a further question — whether a terminal is there to prompt —
see [`authentication.md`](authentication.md).

## Output modes

Three modes, chosen with `-f` and `-q`:

- **json** (default) — a stable envelope. A JSON mode you asked for by name
  ignores `--quiet`; a JSON mode that is merely the default yields to it.
- **`-f text`** — the convenience layer: one record per line, fields separated
  by a single tab. Nothing is padded and no column is measured, so a field's
  boundary is always recoverable — and when you want columns on screen, pipe it
  through something that aligns: `gdrive ls -f text | column -t -s $'\t'`.
- **`-q` quiet** — one value per line, made for pipes: usually IDs. Some
  commands (`rm`, `share remove`, `sheets clear`) print nothing at all. `-q`
  asks for the bare value and gets it whatever the default is, so
  `FOLDER=$(gdrive mkdir 2027 -q)` needs no `-f`. A format you *name* still
  wins: `gdrive ls -f json -q` is JSON
  ([`../decisions/0038`](../decisions/0038-quiet-asks-for-a-value.md)).

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

The `data` shapes below are what goes in that envelope.

**Most `console` transcripts on this page pass `-f text`**, because a
transcript is only worth showing when it shows the text. Without it — or without
`default_format = "text"` in your config — those commands print the envelope
instead.

The exception is a command whose output **is** a document: `gdrive docs read`
prints Markdown, and `gdrive forms read` and `gdrive slides read` print YAML,
with no flag at all, because those already are the machine representation and
there is nothing for the JSON default to improve. `-f json` wraps one in the
envelope when you want it there.
See [`../decisions/0036`](../decisions/0036-machine-format-by-default.md) §1.

Text is lossy on purpose. A tab or a newline in a file name — Drive accepts
both — becomes a space, so one record can never render as two rows; `-f json`
carries the real name.

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
$ gdrive ls -f text "Finance/2026"
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

### Shortcuts

A Drive **shortcut** is a pointer: a file of its own, with its own ID, name and
permissions, whose target is another file. The Drive UI does not distinguish one
from what it points at, so a path can run straight through one:

```sh
gdrive ls   "Reports/link-to-2026"          # lists the target folder's children
gdrive ls   "Reports/link-to-2026/Q3"       # …and the path keeps walking
gdrive docs read "Reports/link-to-doc"      # reads the target document
```

**Whether a shortcut is followed depends on what the argument is for, not on
which command it belongs to** — the rule POSIX applies to symlinks, and for the
same reason: `cat link` should read the target, `rm link` should not delete it.

| Role | Follows | Arguments |
|------|---------|-----------|
| **Container** — "look inside this" | always | every intermediate path segment; `ls [folder]`; `--parent` on `mkdir`, `upload`, `docs create`, `sheets create`, `forms create`; the destination of `mv`, `cp` and `ln` |
| **Content** — "read or edit what is in this" | yes | `download <file>`; `docs read/append/insert/replace`; `sheets tabs/read/write/append/clear`; `forms read/responses/write`; `slides read`; `ln <target>` |
| **Entry** — "this file, as an entry in a folder" | never | `rm`; `mv <file>`; `cp <file>`; `rename <file>`; `share list/add/remove/link`; `info` |

The two arguments of `mv link Other` play different roles in one command: the
source is an entry and moves the pointer, the destination is a container and
moves *into* whatever it points at.

`rm` is the case worth spelling out. Deleting a link deletes the link:

```console
$ gdrive info -f text "Reports/link-to-doc"
Name:	link-to-doc
Type:	shortcut
ID:	1LnkAbC...
MIME:	application/vnd.google-apps.shortcut
Size:	-
Modified:	2026-08-01T09:12:44.000Z
Created:	2026-07-30T14:02:10.000Z
Target:	1DocXyZ... (doc)
Owners:	me@gmail.com
Trashed:	false
Link:	https://drive.google.com/file/d/1LnkAbC.../view?usp=drivesdk

$ gdrive rm "Reports/link-to-doc"     # trashes 1LnkAbC..., not 1DocXyZ...
$ gdrive info 1DocXyZ...              # the document is untouched
```

`Link:` opens the **shortcut**, not the target — Drive builds it from the
shortcut's own ID, and it is the one field of a shortcut's `info` that does not
say so in its name. Follow `Target:` instead to reach the document.

`share` stays with the entries for the same reason: a shortcut carries its own
ACL, and a `share add` that quietly widened access to the target instead would
grant a stranger a document rather than a pointer, with nothing in the output to
say so. `info` stays because it is the command that answers *what is this ID*,
and it reports `target_id` — the escape hatch whenever you want the target from
a command that does not follow, since a target ID is just an ID.

A path that names an ordinary file costs nothing extra, because the path walk
already learns which of its segments are shortcuts. Two cases do cost one Drive
call each: an ID-shaped argument that a command follows is fetched to find out
whether it is a shortcut at all, and a shortcut that is actually followed is
checked to be sure its target is still there.

Two failures name the shortcut rather than leaving you with a mysterious
`NOT_FOUND` on an ID you can see in `ls`:

```console
$ gdrive docs read "Reports/link-to-gone"
Error: Shortcut "Reports/link-to-gone" points at a file that is gone or not
accessible (target 1DocXyZ...).
```

and a shortcut to a shortcut is `API_ERROR` — Drive does not create those, so
the chain is not followed a second time. [`gdrive ln`](#gdrive-ln-target-folder)
is how you make one, and for the same reason it links what a shortcut target
points at rather than the shortcut. See
[`../decisions/0025`](../decisions/0025-shortcuts.md) and
[`0026`](../decisions/0026-ln.md).

## The file object

`ls`, `search`, `info`, `upload`, `mkdir`, `mv`, `cp`, `ln`, `rename`, and `rm`
all report files in one normalized shape. `size` is `null` for Google-native
files (Docs, Sheets, Slides, folders):

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
  "owners": ["me@gmail.com"],
  "target_id": null,
  "target_type": null
}
```

`type` is one of `folder`, `doc`, `sheet`, `slides`, `form`, `shortcut`, `file`.

A type exists because a command can act on it, not because Drive can store it
([`../decisions/0034`](../decisions/0034-form-is-a-file-type.md)): `form` is
there because [`forms read`](#forms-gdrive-forms) is. `file` is the residue —
Drawings, Sites, Jamboards, Apps Script and every binary all read `file`,
because nothing here acts on them specifically. Expect the list to grow by one
member each time a command learns a new kind of file.

`target_id` and `target_type` are `null` on every file except a
[shortcut](#shortcuts), where they name what it points at and what kind of thing
that is:

```json
{ "id": "1Lnk...", "name": "2026 Budget", "type": "shortcut",
  "mime_type": "application/vnd.google-apps.shortcut", "size": null,
  "target_id": "1AbC...", "target_type": "sheet" }
```

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
| `--type <t>` | `folder` \| `doc` \| `sheet` \| `slides` \| `form` \| `shortcut` \| `file` |
| `--trashed` | List trashed files instead |
| `-n, --limit <n>` | Cap the number of results |
| `--order <o>` | `name` \| `modified` \| `created` |
| `--drive <name>` | List the root of this shared drive (not with `<folder>`) |

```console
$ gdrive ls -f text "Reports/2026" --type sheet -n 2 --order modified
Type	Modified	Name	ID
sheet	2026-07-24 06:17	Budget	1S6cRd...
sheet	2026-06-02 11:40	Headcount	1QwErT...
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
$ gdrive search -f text budget --type sheet
Type	Modified	Name	ID
sheet	2026-07-24 06:17	Budget	1S6cRd...

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
$ gdrive drives -f text
Name	ID
Team Drive	0ABcDeFgHiJkLmNoPqR
Finance	0AZyXwVuTsRqPoNmLkJ
```

```json
{ "drives": [ { "id": "0ABcDeFgHiJkLmNoPqR", "name": "Team Drive" } ] }
```

Quiet: one drive ID per line.

The ID field answers two things: it is a folder ID like any other, so it goes
straight into `ls`, `--parent`, `mv`, and `cp`, and the name field is what
`--drive` matches against.

```sh
gdrive mkdir 2027 --parent "$(gdrive drives -q | head -1)"
```

Text output is `No shared drives.` when the account has none; JSON is an empty
`drives` array.

### `gdrive info <file>`

```console
$ gdrive info -f text "Reports/2026/Budget"
Name:	Budget
Type:	sheet
ID:	1S6cRd...
MIME:	application/vnd.google-apps.spreadsheet
Size:	-
Modified:	2026-07-24T06:17:02.000Z
Created:	2026-07-24T06:17:00.000Z
Owners:	me@gmail.com
Trashed:	false
Link:	https://docs.google.com/spreadsheets/d/1S6cRd.../edit
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
$ gdrive download -f text "Reports/2026/Notes" --export-as md -o notes.md
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
$ gdrive upload -f text ./data.csv --parent Reports --name Budget --as-sheet
Uploaded Budget (1S6cRd...)
```

```json
{ "file": { /* file object */ } }
```

Quiet: the new file ID.

### `gdrive mkdir <name>`

```console
$ gdrive mkdir -f text 2027 --parent Reports
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
$ gdrive mv -f text "Inbox/Budget" "Reports/2026"
Moved Budget to 1FoLdEr...

$ gdrive cp -f text "Reports/2026/Budget" Archive --name "Budget (2026)"
Copied to Budget (2026) (1CoPy...)
```

```json
{ "file": { /* file object */ } }
```

Quiet: the file ID.

`mv` moves and only moves: its `<folder>` is contractually a folder, so there is
no second argument that could mean a new name.
[`rename`](#gdrive-rename-file-name) is the verb for that.

### `gdrive rename <file> <name>`

Changes the file's Drive name — the name `ls` prints and paths resolve. Nothing
moves, and `<file>` is an entry, so renaming a shortcut renames the shortcut and
leaves its target alone. An empty or whitespace-only `<name>` is `INVALID_ARGS`
before anything is asked of Drive.

```console
$ gdrive rename -f text "Reports/Notes" "Notes 2026"
Renamed to Notes 2026 (1NoTeS...)

$ gdrive ls -f text Reports
Type	Modified	Name	ID
doc	2026-08-06 11:02	Notes 2026	1NoTeS...
```

```json
{ "file": { /* file object */ } }
```

Quiet: the file ID.

### `gdrive ln <target> <folder>`

Creates a shortcut in `<folder>` pointing at `<target>`, named after the target
unless `--name` says otherwise.

`<target>` follows a shortcut and `<folder>` follows one too, so
`gdrive ln Inbox/link-to-doc Archive` files a second link to the *document* —
Drive refuses to store a shortcut to a shortcut.

The default name means `ln` has to know what the target is called. An ID-shaped
`<target>`, or one that is itself a shortcut, was already looked up while
resolving; only a path to an ordinary file costs one extra Drive call, and
`--name` skips it.

```console
$ gdrive ln -f text "Reports/2026 Budget" "Shared/Links"
Created shortcut 2026 Budget (1Lnk...) -> 2026 Budget (1AbC...)

$ gdrive ln -f text "Reports/2026 Budget" "Shared/Links" --name "Budget (2026)"
Created shortcut Budget (2026) (1Lnk...) -> 1AbC...
```

The second line names the target by ID alone because nothing ever looked it up:
`--name` skipped the call a path target would have paid for. The same command
with an ID `<target>` prints the target's name too, since resolving it fetched
that anyway.

```json
{ "file": { /* file object, with target_id and target_type */ } }
```

Quiet: the new shortcut's ID.

Which links a drive will hold is Drive's rule, and it varies with the drives
involved and their sharing settings. `ln` pre-checks none of it: it issues the
create and hands back whatever Drive answers, in Drive's own words rather than
paraphrased here. Retargeting an existing shortcut is not supported:
`rm` the link and make a new one. Nothing stops two shortcuts sharing a name in
one folder, and a path segment that then matches both is `INVALID_ARGS` listing
the candidate IDs — `--name` is the way out.

### `gdrive rm <file>`

Moves the file to the trash. `--permanent` deletes it outright — that cannot be
undone.

```console
$ gdrive rm -f text "Reports/2026/Draft"
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
$ gdrive share list -f text "Reports/2026/Budget"
Role	Type	Grantee	Permission ID
owner	user	me@gmail.com	15586974644968362332
writer	anyone	(anyone with link)	anyoneWithLink
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
$ gdrive share add -f text "Reports/2026/Budget" --to alice@example.com --role writer
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
$ gdrive share add -f text 0ANPgzMZtaAa6Uk9PVA --to alice@example.com --role organizer
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
$ gdrive share remove -f text "Reports/2026/Budget" --to alice@example.com
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
$ gdrive share link -f text "Reports/2026/Budget" --role writer
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

**Markdown is the format in both directions.** `read` renders a document as
Markdown, and `create --content`, `append`, `insert`, and `replace` parse their
content as Markdown, so a heading arrives as a heading and a pipe table as a
real table. Every one of them takes `--as <markdown|text>`, defaulting to
`markdown`, which makes the obvious pipe do the obvious thing:

```console
$ gdrive docs read A | gdrive docs append B -    # structure survives
```

Use `--as text` for content that was never meant as Markdown — logs, code,
anything machine-generated — where a line starting `# `, `- `, or `1. ` should
stay literal:

```console
$ gdrive docs append "Notes/Ops" @server.log --as text
```

Nothing is rejected. Headings, bold, italic, links, bulleted and numbered lists
(two spaces per nesting level), and pipe tables become Docs structure; a fenced
or indented code block and inline `` `code` `` become monospace; a block quote
becomes an indented paragraph; a horizontal rule is dropped. Images and raw HTML
have no Docs equivalent, so they stay literal and are reported — one line on
stderr in text mode, an `unsupported` array in JSON:

```console
$ gdrive docs append -f text "Notes/Meeting" @draft.md
Kept as plain text: image (line 12)
Appended to Meeting notes (1BzqpK...)
```

**What you write arrives in the document's default style**, not in the style of
the text next to it. Appending after a heading writes body text; inserting into
a bulleted list writes an ordinary paragraph; inserting after bold red 20pt text
writes plain text in the document's own body font. `--as text` is no different —
it says the content is not Markdown, not that it should inherit formatting,
with the one exception below.

Two exceptions, both narrow:

- An insert that lands *inside* an existing paragraph, which `--index` and
  `--before` / `--after` can do. The characters written are still plain, but a
  paragraph cannot be half-heading, so the paragraph they joined keeps its own
  style.
- `replace --as text`, which substitutes through the API in one request and so
  keeps the formatting of the text it replaced. That request reaches headers,
  footers and footnotes, which nothing else here can address, and it reports
  only how many occurrences it changed — never where. `replace` without
  `--as text` deletes the marker and writes in the default style like the
  others.

One source line is one paragraph, matching what `read` prints — Markdown's rule
that consecutive lines join into one paragraph does not apply. The exception is
a **hard break**: end a line with a backslash (or with two spaces) to put a line
break *inside* a paragraph, the same break Shift+Enter makes in the Docs UI. A
blank line is still what makes a new paragraph.

```console
$ printf 'first line\\\nsecond line\n' | gdrive docs append "Notes/Ops" -
```

`read` prints such a break as a trailing backslash, so it survives the pipe.

`<https://…>` and a bare `https://…` both become links, as does `[text](url)`.

#### Numbered lists

A numbered list keeps counting across whatever sits between its items, so a
document whose sections are numbered `1.` through `12.` — each followed by its
own paragraphs, headings, or bullets — arrives numbered 1 through 12 rather
than `1.` twelve times. The numbering continues while the ordinals do; writing
`1.` again starts a new list.

A run that starts at anything but `1.` cannot be a Docs list: the API has no way
to set a list's starting number. Rather than renumber it from 1 and lose what
you wrote, those lines stay ordinary paragraphs with their ordinals as text.

```console
$ printf '5. five\n6. six\n' | gdrive docs append "Notes/Ops" -   # text, not a list
```

The same applies to `2)`: a run starting at `1)` becomes a list, rendered `1.`,
because Docs cannot render the parenthesis form either. A table between two
items also ends the run.

When a line only looks like a list, escape the marker with a backslash:

```console
$ printf '1\\. not a list item\n' | gdrive docs append "Notes/Ops" -
```

### `gdrive docs read <file>`

`--as markdown` (default) maps headings, bold/italic, links, bulleted and
numbered lists, and — best effort — tables. `--as text` emits plain paragraph
text. Both print the body to stdout with no flag, in quiet mode too: the body
*is* this command's machine output. `-f json` carries the same body in
`data.content` for a caller that wants the id and title alongside it.

A numbered item prints its real ordinal — its position in its list, from
wherever that list starts — so a list that continues across intervening
paragraphs reads 1, 2, 3 rather than `1.` three times.

Rendering is best effort: a list is numbered only when Docs reports its glyph,
and documents converted from HTML report no glyph information, so their numbered
lists come back as `-`.

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
| `--as <format>` | `markdown` (default) \| `text` |

The Docs API always creates in My Drive, so `--parent` is applied as a move
right after creation.

```console
$ gdrive docs create -f text "Meeting notes" --content @agenda.md --parent Notes
Created Meeting notes (1BzqpK...)
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes", "parent_id": "1FoLdEr..." }
```

Quiet: the new document ID.

### `gdrive docs append <file> <text|@file|->`

Appends the content as new paragraphs at the end of the body. `--as text`
appends it verbatim instead.

```console
$ echo "decided: ship on Friday" | gdrive docs append -f text "Notes/Meeting" -
Appended to Meeting notes (1BzqpK...)
```

```json
{ "id": "1BzqpK...", "title": "Meeting notes" }
```

Quiet: the document ID.

### `gdrive docs replace <file>`

Replaces every match and reports how many. `--find` and `--replace` are
required; `--replace` takes `@file` and `-` like any other content argument.
Matching is case-insensitive unless `--match-case` is given. `--all` is accepted
for clarity but changes nothing — all matches are always replaced.

With the default `--as markdown` the marker is deleted and the replacement is
written as structure, occurrence by occurrence from the last to the first. A
marker inside a table cell is not matched, because the replacement may itself be
a table and Docs cannot nest one. `--as text` is the plain substitution, in one
API call.

```console
$ gdrive docs replace -f text "Notes/Meeting" --find "<!-- schedule -->" --replace @table.md
Replaced 1 occurrence
```

To keep the marker for next time, insert next to it instead of replacing it —
see [`insert --before`](#gdrive-docs-insert-file-textfile-).

```console
$ gdrive docs replace -f text "Notes/Meeting" --find Q3 --replace Q4 --match-case
Replaced 3 occurrences
```

```json
{ "id": "1BzqpK...", "replaced": 3, "message": "Replaced 3 occurrences" }
```

Quiet: the document ID.

### `gdrive docs insert <file> <text|@file|->`

Exactly one position is required:

| Option | Where the content goes |
|--------|------------------------|
| `--index <n>` | Docs' 1-based character index in the body |
| `--at <start\|end>` | The beginning or the end of the body |
| `--before <marker>` | In front of a marker |
| `--after <marker>` | Just after a marker |

The content is Markdown unless `--as text` says otherwise.

```console
$ gdrive docs insert -f text "Notes/Meeting" "DRAFT — " --at start
Inserted into Meeting notes (1BzqpK...)

$ gdrive docs insert -f text "Notes/Meeting" @table.md --before "<!-- schedule -->"
Inserted into Meeting notes (1BzqpK...)
```

A marker must match **exactly once**. No match is `NOT_FOUND`; two or more is
`INVALID_ARGS` reporting the count, and `--match-case` is usually the way to
narrow it (matching is case-insensitive by default, as in `replace`). Use
`replace` when you do want every occurrence.

The marker is matched against the document's **text**, not against Markdown:
a heading written `## 次回` is the text `次回` in the document, so that is what
`--after` takes. A marker inside a table cell is never matched, because the
content may itself be a table and Docs cannot nest one.

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
$ gdrive sheets tabs -f text "Reports/2026/Budget"
Index	Rows	Cols	Title
0	1000	26	Sheet1
1	50	10	Summary
```

```json
{ "id": "1S6cRd...", "tabs": [
  { "index": 0, "title": "Sheet1", "sheet_id": 0, "rows": 1000, "cols": 26, "hidden": false }
] }
```

Quiet: one tab title per line.

### `gdrive sheets read <file> [<range>]`

`--as` is `table` (default), `csv`, or `json`; `table` is tab-separated.

**Naming `--as` selects text**, because an encoding is a preference and a flag a
default can switch off is not a flag: `gdrive sheets read S "A1:B3" --as csv >
out.csv` writes CSV with no `-f` needed. A named `-f` still wins, so `--as csv
-f json` gives the envelope with the values in `data`. `-q` prints CSV whatever
the default is.

```console
$ gdrive sheets read -f text "Reports/2026/Budget" "Sheet1!A1:B3"
name	score
alice	90
bob	80
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
$ gdrive sheets write -f text "Reports/2026/Budget" A1:B2 --values 'name,score
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
$ gdrive sheets append -f text "Reports/2026/Budget" --values '[["carol","70"]]'
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
$ gdrive sheets clear -f text "Reports/2026/Budget" A4:B4
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
$ gdrive sheets create -f text Budget --parent "Reports/2026"
Created Budget (1S6cRd...)
```

```json
{ "id": "1S6cRd...", "title": "Budget", "parent_id": "1FoLdEr..." }
```

Quiet: the new spreadsheet ID.

---

## Forms (`gdrive forms`)

A form is **one YAML document** (see
[`../decisions/0027`](../decisions/0027-forms-document.md) and
[`0028`](../decisions/0028-forms-write.md)). `read` prints it and `write`
accepts the same document back; there are no per-question commands, so to change
question 3 you read the form, edit that node, and write the document back.

The Forms API must be enabled on your Google Cloud project
([`authentication.md`](authentication.md)); no new OAuth scope is needed, so an
existing login keeps working.

`<form>` is a *content* argument in `read`, `responses` and `write`, so it
follows a [shortcut](#shortcuts) to the form it points at; `forms create
--parent` is a container and follows one too.

### Finding a form

A form reports [`type: form`](#the-file-object), so `--type form` lists the
files these commands can take:

```console
$ gdrive ls -f text Surveys --type form
Type	Modified	Name	ID
form	2026-08-03 04:51	2026 Engagement survey	1FoRm...
form	2026-07-11 16:20	Untitled form	1OtHeR...
```

A form has **two names**, and they often differ: the Drive name that `ls`,
`search` and `info` report, and the `title` inside the document that `forms
read` prints. Titling a form in the Forms UI leaves its Drive name at
`Untitled form` — which is what `1OtHeR...` above is.

`search` finds a form under either. It matches the Drive name *and* Drive's
full-text index, and that index covers the title inside the form:

```console
$ gdrive search -f text "Onboarding feedback"   # the title inside 1OtHeR...
Type	Modified	Name	ID
form	2026-07-11 16:20	Untitled form	1OtHeR...
```

A **path** does not: every command taking a `<form>` resolves it by Drive name,
so `gdrive forms read "Onboarding feedback"` is `NOT_FOUND` for the very form
`search` just returned. Take the ID from `search`, or the name in its `Name`
column — or give the form the name you want with
[`gdrive rename`](#gdrive-rename-file-name), which is the Drive name a path
resolves by.

`gdrive forms create` sets both names to its `<title>`, so a form made here is
reachable by path from the start.

### The document

```yaml
id: 1FoRm...
title: 2026 Engagement survey
description: |-
  Takes about five minutes.
  Answers are anonymous.
revision_id: "00000007"
responder_uri: https://docs.google.com/forms/d/e/1FAIpQ.../viewform
linked_sheet_id: 1ShEeT...
items:
  - id: 1a2b3c4d
    question_id: 5e6f7g8h
    type: choice
    choice_type: radio
    title: Which team are you on?
    required: true
    options:
      - Sales
      - Engineering
      - value: Other
        other: true
```

Top level:

| Field | Description |
|-------|-------------|
| `id` | The form ID. Output only |
| `title` | The title responders see |
| `description` | Optional; block scalars keep paragraphs readable |
| `revision_id` | The revision `read` saw. Output only here; a later `forms write` sends it back so a concurrent browser edit fails instead of being clobbered |
| `responder_uri` | The link to share. Output only |
| `linked_sheet_id` | The response spreadsheet, when the form has one — `gdrive sheets read` on it is often what you want. Output only |
| `items` | The form's items, in order |

Every item carries `id` (the API's item ID) and a `type`; every question also
carries `question_id`, which is the key responses are joined on. Both are output
only. `title` and `description` are optional on every item, and `required`
(default `false`) on every question.

| `type` | Fields |
|--------|--------|
| `choice` | `choice_type`: `radio` \| `checkbox` \| `dropdown`; `options`; `shuffle` |
| `scale` | `low`, `high`, `low_label`, `high_label` |
| `text` | `paragraph` — `true` is the multi-line answer box |
| `date` | `include_time`, `include_year` |
| `time` | `duration` — `true` is an elapsed time rather than a time of day |
| `file_upload` | `folder_id`, `max_files`, `max_file_size`, `types`. **Read only** — the Forms API cannot create a file upload question, so `write` never sends one ([below](#what-a-write-leaves-out)) |
| `page_break` | — (a section; its `title`/`description` head the new page) |
| `text_item` | — (a title and description block, asks nothing) |
| `unsupported` | `raw` (see below) |

An `options` entry is a plain string, or a mapping when it is more than its
label: `value` plus `other: true` (the "Other…" write-in) and the section
navigation `go_to_action` / `go_to_section_id`.

On an `other: true` option, **`value` is read-only**. Google owns the label of
the write-in choice and the API refuses to be sent one, so `write` drops it the
way it drops a `question_id`; `{other: true}` on its own is a complete option,
and that is how `read` prints one Google gave no label. Editing the `value`
beside `other: true` changes nothing in the form.

`go_to_section_id` is **an item id** — the `id` of the `page_break` to jump to
— so it only means anything within one form. `write` sends it as given;
[`create`](#gdrive-forms-create-title---file-path---parent-folder) drops it,
because a new form has none of the ids the document was read with.

### What is not modelled

An item the schema cannot hold reads as `type: unsupported`, with the API
resource verbatim under `raw`. It is never dropped or approximated, so a round
trip cannot destroy it, and **both** commands say so: one line on stderr in text
mode, an `unsupported` array in JSON.

```console
$ gdrive forms read "Surveys/2026" > form.yaml
Kept as raw: videoItem (item 3c4d5e6f)
```

That covers whole kinds — a video, an image, a grid (question group), a rating
question — and also a *field* inside an otherwise ordinary question that the
document has no way to express:

| `kind` in the report | Why |
|---|---|
| `videoItem`, `imageItem`, `questionGroupItem`, `ratingQuestion`, … | The item's kind is not modelled |
| `questionItem.image`, `option.image` | An image cannot round-trip: the API returns a `contentUri` that is read-only and expires, while creating one needs a `sourceUri` it never returns. Projecting it would invite a write that deleted the image |
| `choiceQuestion.type` | A choice kind newer than this CLI |
| `scaleQuestion` | A scale the API returned without both of its bounds |

**On an `unsupported` node, `raw` is the only field that counts.** The `id`,
`question_id`, `title` and `description` beside it are a legible echo of what is
inside `raw` — enough to tell one opaque node from another in a diff, and enough
for `forms responses` to head a column with the question's title and join on its
`question_id`, so its answers are not lost with it. They are not an edit point:
[`0028`](../decisions/0028-forms-write.md) §2 says `forms write` emits neither an
update nor a delete for an `unsupported` item — only a `moveItem`, if the item
changed position, and that carries no content. So changing a `title` there
changes nothing in the form and will not appear in the plan that `write` reports.
Where the two copies disagree, `raw` is the form.

Some things are not carried at all, and so do not appear in the `unsupported`
report either — the report is a per-item list, and these are not items:

| Not carried | What that means |
|---|---|
| `settings.quizSettings.isQuiz`, `settings.emailCollectionType` | Form-level settings. A form reads as its items; whether it is a quiz, and whether it collects email addresses, are simply not in the document |
| `grading` on a question, and a response's scores | Deferred by [`0027`](../decisions/0027-forms-document.md); a quiz reads as its questions |
| `document_title` | The Drive file name, which `gdrive info` and `gdrive ls` report. Nothing can change it through this API, so nothing here loses it |
| `publish_settings` | Output-only, and form lifecycle rather than content |

A form that is a quiz therefore reads with no sign that it is one. What the
document does not carry, `forms write` never sends: a quiz stays a quiz and its
grading survives an edit, and `forms create` cannot make a quiz. If you edit a
quiz's document, keep in mind that these settings live outside it.

### `gdrive forms read <form>`

Text output **is** the document, ready to redirect to a file with no flag: a
form's YAML is already exact and already parseable, so it is what this command
emits unasked ([`../decisions/0036`](../decisions/0036-machine-format-by-default.md)
§1). `-f json` carries the same structure — not a YAML string — in `data.form`,
so a JSON caller never needs a YAML parser to read a form.

```console
$ gdrive forms read "Surveys/2026 Engagement" > form.yaml
```

```json
{ "id": "1FoRm...", "form": { "title": "2026 Engagement survey", "items": [ ... ] },
  "unsupported": [ { "id": "3c4d5e6f", "kind": "videoItem" } ] }
```

Quiet: the form ID.

### `gdrive forms responses <form>`

Tabulates the responses, one column per question, headed by the question's
title. The form is fetched as well as the responses — two Forms calls, always,
whatever the form — because the API keys answers by question ID and never says
what was asked. A `<form>` given as a bare ID costs one Drive lookup on top, to
find out whether the ID is a [shortcut](#shortcuts); a path pays only when its
last segment really is one, to check the target is still there.

`--as` is `table` (default), `csv`, or `json`; `table` is tab-separated. As with
`sheets read`, naming `--as` selects text and a named `-f` outranks it; `-q`
prints CSV whatever the default is.

```console
$ gdrive forms responses -f text "Surveys/2026 Engagement"
submitted	Which team are you on?	How satisfied are you?
2026-07-01T10:22:00Z	Sales	4
2026-07-01T11:05:00Z	Engineering	5
```

- A checkbox or file-upload answer is several values: `table` and `csv` join
  them with `; `, `json` keeps the array.
- A file-upload answer reports Drive file IDs, which `gdrive info` accepts.
- Two questions with the same title — or one titled `submitted` — get
  ` (<question_id>)` appended rather than a silently duplicated column. An
  untitled question is headed by its question ID. Anything still colliding after
  that — which takes two questions sharing a question ID, so only malformed
  input — gets ` #2`, ` #3` …, because a distinct header is a guarantee here and
  the ID rule cannot separate columns that share an ID.
- A question with no answer in a response is an empty cell (`[]` in `json` for
  a multi-valued column).
- A **grid** (question group) is one item holding one question per row, so it
  becomes one column per row, headed `<item title> — <row title>`. The item is
  still reported as unmodelled — its structure is not something `forms write`
  will be able to edit — but its answers are all here.
- A form with no responses prints the header row alone.
- A form need not have a linked spreadsheet; this works either way.
- Column titles are always distinct — by construction, not by convention — so
  no answer can overwrite another in `json`'s title-keyed rows.

```json
{ "id": "1FoRm...",
  "columns": ["submitted", "Which team are you on?"],
  "responses": [ { "submitted": "2026-07-01T10:22:00Z", "Which team are you on?": "Sales" },
                 { "submitted": "2026-07-01T11:05:00Z", "Which team are you on?": "Engineering" } ],
  "count": 2 }
```

`unsupported` joins the envelope here too, on the same terms as `read`.

Quiet: CSV to stdout.

The respondent's email address and the response ID are not columns; response
filtering, fetching one response by ID, and quiz grades are not implemented.

### `gdrive forms write <form> [--file <path>] [--prune] [--dry-run]`

Applies a document to a form. Items are matched **by `id` alone** — nothing
compares titles, and nothing guesses that a renamed question is the same
question — so the three edits an agent actually makes are exactly expressible:

| In the document | In the form | What happens |
|---|---|---|
| `id` present, matches | yes | The item is updated in place, keeping its `question_id` and every answer already joined to it |
| no `id` | — | The item is created at the position it holds in the document |
| — | `id` not in the document | The item is deleted, and **only** with `--prune` |
| the order differs | — | The item is moved |

An `id` the form does not have is an `INVALID_ARGS` error, not a create: it
means the document was written against a different form, and creating the item
would half-apply that mistake. Drop the `id` to add the item as new.

`--file` names a path; `@path` and `-` (stdin) work as they do everywhere else,
and with no `--file` at all the document is read from stdin — so
`gdrive forms read F | gdrive forms write F` is a round trip that changes
nothing.

The read-only fields `read` emitted — `id`, `revision_id`, `responder_uri`,
`linked_sheet_id`, each item's `question_id`, and the [`value` of an `other:
true` option](#the-document) — are **ignored**, not rejected, so the round trip
needs no stripping step. `revision_id` is the one exception to "ignored": it is
sent back as the revision the write requires (see below).

For the fields the document *does* model, the document is the desired state. A
form `description` deleted from the document is deleted from the form.

```console
$ gdrive forms read "Surveys/2026" > form.yaml
$ $EDITOR form.yaml
$ gdrive forms write -f text "Surveys/2026" --file form.yaml
action	position	id	title
create	3		Anything else?
update	0	1a2b3c4d	Which team do you work in?
Applied 2 changes to 1FoRm...
```

#### Deleting a question needs `--prune`

An item in the form and not in the document is **not** deleted by default;
`write` refuses the whole thing with `PRUNE_REQUIRED` (exit 3), names the items
and names the flag, and writes nothing at all — not the creates, not the
updates. The plan is built whole or not at all.

This is deliberate. Deleting a form question deletes the question *and* severs
its responses, which are keyed by `question_id`; there is no trash to recover
them from, unlike [`gdrive rm`](#gdrive-rm-file). The likely mistake
is an agent that assembles a document programmatically and drops an item it did
not understand, so `--prune` is the same shape of promise as `rm --permanent`:
available, spelled out, never the default.

```console
$ gdrive forms write "Surveys/2026" --file form.yaml
Error: Applying this document would delete 1 item the form has and the document does not: "How satisfied are you?" (2b3c4d5e). Deleting a question deletes its responses with it, and nothing has been changed. Re-run with --prune to delete them, or put them back in the document.
```

`--dry-run` reports the plan and issues no write. It refuses a deletion on the
same terms, so the sequence to run when you are not sure is `--dry-run --prune`
first and `--prune` after — one extra `forms.get` and nothing else.

#### The plan

Every `write` reports what it did, or would do, as `data.plan`: one entry per
create, update, move and delete, each naming the item.

```json
{ "id": "1FoRm...", "applied": true,
  "plan": [ { "action": "move", "id": "2b3c4d5e", "title": "How satisfied are you?", "from": 3, "index": 1 },
            { "action": "create", "title": "Anything else?", "index": 3 },
            { "action": "update", "id": "1a2b3c4d", "title": "Which team do you work in?", "index": 0 } ] }
```

- `action` is `form_info`, `create`, `update`, `move` or `delete`. `form_info`
  is the form's own `title` and `description`; it names no item.
- `id` is absent on a create — the API assigns one — and on `form_info`.
- **The entries are 1:1 with the requests that were sent**, grouped in the order
  those requests run: `form_info`, then `delete`, then `move`, then `create`,
  then `update`. That grouping is what keeps each index below valid as the batch
  runs, so it is neither the order you edited in nor the order the form ends up
  in. (Within the deletions the plan lists items in form order while the
  requests run last-first, since deleting an earlier item would shift a later
  one's position.)
- **`index` is a position at the moment that request runs, not one coordinate
  system throughout.** A `delete`'s `index` is where the item sat in the form as
  it was read. A `move`'s `from` and `index` count the list *after* the
  deletions and *before* the creations. A `create`'s and an `update`'s `index`
  is the position in the document, which is where the item ends up. Read the
  plan as a report of what was sent, not as coordinates to look items up by
  afterwards — `id` and `title` are what identify an item across the whole plan.
- `applied` is `false` for a `--dry-run` and for an empty plan, and `dry_run`
  is `true` on a dry run.
- In text mode the plan is a table: `action`, `position`, `id`, `title`, with
  `position` reading `3->1` for a move. A trailing line says whether it reached
  the form.
- Quiet: the number of changes.

That is what makes the deletion rule checkable rather than merely promised. A
caller asking *did my deletion happen* has three answers to tell apart, and the
envelope tells them apart without reading the exit code: a successful write
whose plan holds a `delete` entry **applied** it, a `PRUNE_REQUIRED` error
**refused** it, and a successful write with no `delete` entry was **never
asked** to (the item was already gone).

#### What a write leaves out

Two kinds of item produce **no request at all** — not an update, not a delete —
so each stays exactly as it is while the questions around it change, and only a
`move` can name one:

| Item | Why |
|---|---|
| `type: unsupported` | `raw` holds the API's own shape, not a request's, so re-sending it invites a mismatch |
| `type: file_upload` | "The API currently does not support creating file upload questions" — Google's words. A `batchUpdate` is atomic, so one in a request would take every other edit down with it |

Asking for one anyway — adding it, or editing one that is already there — is
reported through the `unsupported` channel rather than silently succeeding: one
line on stderr in text mode, a `data.unsupported` array in JSON, each entry
naming the document position, the title and the `kind` that could not be sent.
Nothing is in `data.plan` for them, because nothing was planned.

So a file upload question survives an edit to the form around it, and a form
containing one can be read, but this CLI cannot create one or change it. Use
the Forms UI for that question and `write` for the rest.

Nothing about form **settings** is ever sent. The document carries none, so an
update derived from it would say `isQuiz: false` — which, per Google's own
field documentation, deletes every question's grading. A quiz stays a quiz, and
`write` cannot turn a form into one.

#### A browser edit between `read` and `write`

When the document carries the `revision_id` that `read` emitted, `write` sends
it as the revision the form must still be at. A form edited elsewhere in the
meantime makes the write fail, and it fails before anything is written:

```console
$ gdrive forms write "Surveys/2026" --file form.yaml
Error: The form changed since it was read at revision 00000007, so nothing was written: ... Read the form again and apply your edit to the fresh document.
```

There is no merge. Re-read the form and re-apply the edit. Deleting the
`revision_id` line writes unconditionally, which is what a hand-authored
document does — so the safe behavior is what the round trip gives you for free.

### `gdrive forms create <title> [--file <path>] [--parent <folder>]`

Creates a form. With `--file`, the new form is filled from a document; without
one, it is an empty form with that title.

The Forms API creates a form with a title and nothing else, so this is up to
three calls: create, then one `batchUpdate` carrying the whole document, then a
Drive move when `--parent` is given. `docs create` and `sheets create` have the
same shape for the same reason.

The `<title>` argument names the form and **wins over the document's `title`**;
everything else — the description and the items — comes from the document.

`<title>` becomes **both** of a form's [two names](#finding-a-form): the title
responders see and the Drive name that `ls`, `search` and `info` report and that
a path resolves by. No `batchUpdate` can set the Drive name, so this is the only
place the two are written together; a form created any other way starts out
`Untitled form` in Drive, and [`gdrive rename`](#gdrive-rename-file-name) is what
makes it addressable by path.

Every **id** in the document is ignored, because a new form has none of them:
`id`, `question_id`, and the `go_to_section_id` of an option, which names a
`page_break` of the form the document was read from. Ignoring them is what makes
reading one form and creating another a copy rather than an error about unknown
IDs — at the cost of the branching, which is reported and left out rather than
pointed at nothing. Set it again in the new form if you need it.

```console
$ gdrive forms create -f text "2027 Engagement survey" --file form.yaml --parent Surveys
Created 2027 Engagement survey (1NeWfOrM...)
```

```json
{ "id": "1NeWfOrM...", "title": "2027 Engagement survey", "parent_id": "1FoLdEr...",
  "plan": [ { "action": "form_info", "title": "2027 Engagement survey" },
            { "action": "create", "title": "Which team are you on?", "index": 0 } ] }
```

Quiet: the new form ID.

A copy is a copy of the *questions*, not of the form. The responses stay with
the original; a form that is a quiz copies as a form that is not one; and what
[a write leaves out](#what-a-write-leaves-out) a create leaves out too — an
`unsupported` item (a video, an image, a grid) and a `file_upload` question
cannot be made at all, so each is reported in `data.unsupported` rather than
carried. Everything left out is named, so the diff between the two forms is
never a surprise.

---

## Slides (`gdrive slides`)

A presentation is **one YAML document** (see
[`../decisions/0029`](../decisions/0029-slides-document.md)), as a form is. A
slide is its **layout, its placeholders and its speaker notes** — everything
else on the slide is listed, read-only, under `elements`.

The Slides API must be enabled on your Google Cloud project
([`authentication.md`](authentication.md)); no new OAuth scope is needed, so an
existing login keeps working.

`<presentation>` is a *content* argument, so it follows a
[shortcut](#shortcuts) to the deck it points at. A presentation reports
[`type: slides`](#the-file-object), so `gdrive ls --type slides` lists the files
this command takes.

### The document

```yaml
id: 1PrEs...
title: Q3 review
revision_id: abc123
slides:
  - id: g2a1b3c
    layout: TITLE_AND_BODY
    title: The quarter in one slide
    body: |-
      Revenue up 12%
      Churn flat
    notes: Take questions here

  - id: g5d6e7f
    layout: SECTION_HEADER
    title: What we do next

  - id: g4b5c6d
    layout: TITLE_AND_TWO_COLUMNS
    title: Two ways to read it
    body: The left column
    elements:
      - id: g8j9k0l
        kind: shape
        placeholder: BODY      # a layout placeholder with no field left
        text: The right column

  - id: g7h8i9j
    layout: BLANK
    skipped: true
    elements:
      - id: g1k2l3m
        kind: shape            # no `placeholder`: outside every layout
        text: A heading someone placed by hand
      - id: g4n5o6p
        kind: image
```

Top level:

| Field | Description |
|-------|-------------|
| `id` | The presentation ID. Output only |
| `title` | The deck's title |
| `revision_id` | The revision `read` saw. Output only here; a later `slides write` will send it back so a concurrent browser edit fails instead of being clobbered |
| `slides` | The slides, in deck order |

Per slide:

| Field | Description |
|-------|-------------|
| `id` | The slide's object ID, and the key a write matches on. Output only |
| `layout` | The layout the slide is built on (below) |
| `skipped` | Present only when the slide is skipped in presentation mode |
| `title`, `subtitle`, `body` | The text of the matching placeholder, when it has any |
| `notes` | The speaker notes — the `BODY` placeholder of the slide's notes page, promoted to a field of its own so nobody has to know that |
| `elements` | Everything the document has no field for — a shape outside the layout, an image, and also a placeholder whose field is already taken. Read-only (below) |

**No geometry appears, in either direction.** A slide in the API is a canvas of
positioned boxes: every element carries a transform and a size in EMU, and the
element order is z-order rather than reading order. None of it is in this
document. What a deck *says* is here; what it looks like stays in the template
([`../decisions/0029`](../decisions/0029-slides-document.md) §2).

A placeholder with no text is left out entirely rather than written as `""`, so
a template's empty boxes do not fill the document with blanks.

Where a layout offers two placeholders of one type — `TITLE_AND_TWO_COLUMNS`
has two `BODY`s — the named field goes to the one with the **lowest placeholder
index**, which is the API's own numbering and does not move. Re-ordering the
boxes on the slide, "bring to front" included, cannot change which column is
`body`; the other one is listed under `elements`.

### Layouts

`layout` is the name the slide's layout carries. A deck built on one of Slides'
own themes reports one of the eleven predefined layouts:

`BLANK`, `CAPTION_ONLY`, `TITLE`, `TITLE_AND_BODY`, `TITLE_AND_TWO_COLUMNS`,
`TITLE_ONLY`, `SECTION_HEADER`, `SECTION_TITLE_AND_DESCRIPTION`,
`ONE_COLUMN_TEXT`, `MAIN_POINT`, `BIG_NUMBER`.

A slide built on a layout that has no such name — an imported theme, a layout
edited in the Slides UI — reports the **layout's object ID** instead. It is
still a stable identifier for that layout; it is just not a name.

Which placeholders a layout offers is the layout's business: `TITLE` gives you
`title` and `subtitle`, `TITLE_AND_BODY` gives `title` and `body`, `BLANK`
gives neither.

### `elements`: what the document has no field for

**`elements` is not "what is not a placeholder"** — it is what this document
cannot name
([`../decisions/0051`](../decisions/0051-elements-holds-placeholders-too.md)
§1). A text box someone dragged on, an image, a table, a chart, and equally the
second `BODY` of a two-column slide: each is listed with its ID, its `kind`, its
`placeholder` where it is one, and its `text` where it has any.

| `kind` | |
|--------|---|
| `shape` | Any shape, with its text — including a placeholder whose field is already taken |
| `image` | |
| `table` | Listed with no text: a table's cells are not modelled ([`../decisions/0029`](../decisions/0029-slides-document.md)) |
| `chart` | A chart linked from Sheets |
| `video`, `line`, `word_art`, `speaker_spotlight` | Listed with an ID and a kind; none of them carries text |
| `group` | A group is listed **as its members**, flattened, however deeply nested — grouping two text boxes is ordinary, and reporting the group alone would lose every word in it. Only a group holding nothing is listed as itself |
| `unknown` | An element kind newer than this CLI. Listed rather than dropped, so the slide's contents are never under-reported |

`placeholder` carries the API's placeholder type — `BODY`, `SLIDE_NUMBER`, … —
and is **absent on anything that is not a placeholder**. That one field is the
difference between two entries that otherwise look identical, and the difference
matters: a displaced `BODY` is a box the Slides API would rewrite as readily as
the `body` above it, while a hand-placed text box is outside every layout and
nothing can put it back under one.

**Editing an `elements` entry does not change the deck, and `slides write`
refuses the document rather than report success for an edit that did not
happen**
([`../decisions/0030`](../decisions/0030-slides-write.md) §3). Both sorts of
entry are refused, for different reasons: for a shape outside the layout there
is no way to honour the change, and for a displaced placeholder this CLI has
simply not implemented the write yet
([`../decisions/0051`](../decisions/0051-elements-holds-placeholders-too.md) §3;
[issue #28](https://github.com/ncukondo/gdrive-cli/issues/28)). Listing them and
refusing to write them is the honest half of the trade — text outside a named
field is how a large share of real decks are built, and hiding it would make the
common deck read as empty, the one outcome worse than reading it partially.

Leaving the key out entirely is not an edit: a document that never mentions a
slide's `elements` is accepted, and only a key that is *there* is compared with
what `read` emitted.

So a deck built without a template reads as `BLANK` slides full of `elements`.
That is accurate, and it is also the signal that very little of it will be
editable from here.

### `gdrive slides read <presentation>`

Text output **is** the document, ready to redirect to a file with no flag, on
the same terms as [`forms read`](#gdrive-forms-read-form): the YAML is already
the machine representation
([`../decisions/0036`](../decisions/0036-machine-format-by-default.md) §1).
`-f json` carries the same structure — not a YAML string — in
`data.presentation`.

```console
$ gdrive slides read "Decks/Q3" > deck.yaml
```

```json
{ "id": "1PrEs...", "presentation": { "title": "Q3 review", "slides": [ ... ] } }
```

Quiet: the presentation ID.

Not implemented: a Markdown rendering, thumbnails, and a table's contents.

### `gdrive slides write <presentation> [--file <path>] [--prune] [--dry-run]`

Applies a document to a presentation. Slides are matched **by `id` alone** —
nothing compares titles — so the edits an agent actually makes are exactly
expressible, on the same terms as
[`forms write`](#gdrive-forms-write-form---file-path---prune---dry-run):

| In the document | In the deck | What happens |
|---|---|---|
| `id` present, matches | yes | The slide is updated in place |
| no `id` | — | A slide is created at the position it holds, from its `layout` |
| — | `id` not in the document | The slide is deleted, and **only** with `--prune` |
| the order differs | — | The slide is moved |

An `id` the deck does not have is an `INVALID_ARGS` error, not a create: it
means the document was written against a different deck. Drop the `id` to add
the slide as new.

`--file` names a path; `@path` and `-` (stdin) work as they do everywhere else,
and with no `--file` at all the document is read from stdin — so
`gdrive slides read D | gdrive slides write D` is a round trip that changes
nothing, `elements` and all.

A new slide is built from its `layout` and nothing else: a `createSlide` naming
that layout, then the text inserted into the placeholders the layout provides.
There are no coordinates in either direction
([`../decisions/0029`](../decisions/0029-slides-document.md) §2), so a slide
this CLI creates is laid out by the template rather than by the document. The
`layout` must be one the deck has (by name or by object ID) or one of the
[eleven predefined layouts](#layouts); anything else is an error rather than a
silent `BLANK`.

```console
$ gdrive slides read "Decks/Q3" > deck.yaml
$ $EDITOR deck.yaml
$ gdrive slides write -f text "Decks/Q3" --file deck.yaml
action	position	id	title	fields
update	0	g2a1b3c	The quarter in a sentence	title
create	3	gdrive_slide_1	One more thing	title,body
Applied 2 changes to 1PrEs...
```

#### Rewriting a placeholder loses its formatting

**The Slides API has no request that sets a shape's text.** Changing a title
means deleting what is there and inserting the replacement, and the inline
styling of what was deleted — bold, links, colour, per-run styling — goes with
it ([`../decisions/0030`](../decisions/0030-slides-write.md) §2).

The cost is paid narrowly and stated loudly:

- **narrowly** — a placeholder whose text is unchanged produces no request at
  all, so a one-word fix to a title cannot strip the formatting from the body;
- **loudly** — the plan carries `formatting_loss` on every rewritten
  placeholder that had more than one text run, which is every one with styling
  to lose, and `--dry-run` shows it before anything is written.

```console
$ gdrive slides write -f text "Decks/Q3" --file deck.yaml --dry-run
action	position	id	title	fields
update	0	g2a1b3c	The quarter in one slide	body
Rewriting body on slide g2a1b3c drops the inline formatting it had — bold, links, colour.
Planned 1 change to 1PrEs...; --dry-run wrote nothing
```

A placeholder split into several runs by paragraphs alone is warned about too:
the count is the API's own, and a paragraph break can carry a bullet.

#### Deleting a slide needs `--prune`

A slide in the deck and not in the document is **not** deleted by default;
`write` refuses the whole thing with `PRUNE_REQUIRED` (exit 3), names the
slides and names the flag, and writes nothing at all. The plan is built whole
or not at all, exactly as
[`forms write`](#deleting-a-question-needs---prune) builds it, and `--dry-run`
refuses on the same terms.

#### The plan

Every `write` reports what it did, or would do, as `data.plan`: one entry per
slide changed.

```json
{ "id": "1PrEs...", "applied": true,
  "plan": [ { "action": "update", "id": "g2a1b3c", "title": "The quarter in one slide",
              "index": 0, "fields": ["body"], "formatting_loss": ["body"] } ] }
```

- `action` is `create`, `update`, `move` or `delete`.
- `id` is the slide's object ID — **present on a create too**, unlike a form's:
  this CLI supplies the ID a new slide gets, because the `insertText` that
  fills it travels in the same batch as the `createSlide` that makes it. The
  IDs it generates are prefixed `gdrive_`.
- `fields` names what the entry writes: `title`, `subtitle`, `body`, `notes`,
  `skipped`. An entry is one slide, so it may stand for several requests.
- `formatting_loss` names the fields whose rewrite costs their formatting.
- **`index` is a position at the moment that request runs.** A `delete`'s is
  where the slide sat in the deck as it was read; a `move`'s `from` and `index`
  count the deck *after* the deletions and *before* the creations; a `create`'s
  and an `update`'s is the position in the document. Read the plan as a report
  of what was sent, not as coordinates to look slides up by afterwards.
- `applied` is `false` for a `--dry-run` and for an empty plan, and `dry_run`
  is `true` on a dry run.
- In text mode the plan is a table: `action`, `position`, `id`, `title`,
  `fields`, with `position` reading `3->1` for a move.
- Quiet: the number of changes.

#### What a write leaves out

Reported through the `unsupported` channel — one line on stderr in text mode, a
`data.unsupported` array in JSON — rather than silently succeeding:

| What | Why |
|---|---|
| `title`, `subtitle` or `body` on a slide whose layout has no such placeholder | The layout decides what a slide has, and this CLI adds no shapes |
| `layout` changed on an existing slide | No request re-applies a layout; create a new slide instead |
| `notes` on a **new** slide | A slide's notes page has no ID until the slide exists |
| `elements` on a **new** slide | `elements` is read-only, and a create cannot reproduce one |
| the deck's own `title`, changed | A deck's title is its Drive name, which no `batchUpdate` request changes |

Editing an [`elements`](#elements-what-the-document-has-no-field-for) entry of
an **existing** slide is the one thing that fails the write instead:
`INVALID_ARGS`, naming the element and saying which of the two reasons applies.
An `elements` key the document does not carry at all is not an edit — a
hand-authored slide that never mentions the deck's text boxes is accepted — but
a key that is there must match what `read` emitted, entry for entry.

```console
$ gdrive slides write "Decks/Q3" --file deck.yaml
Error: Slide g7h8i9j: the text of an element changed, but `elements` is read-only — g1k2l3m is a shape outside every layout, which this document does not model well enough to write. Nothing was written; restore the slide's `elements` as `slides read` emitted them and edit the fields above them instead.
```

#### A browser edit between `read` and `write`

When the document carries the `revision_id` that `read` emitted, `write` sends
it as the revision the deck must still be at, exactly as
[`forms write`](#a-browser-edit-between-read-and-write) does. A deck edited
elsewhere in the meantime makes the write fail before anything is written.
Deleting the `revision_id` line writes unconditionally.

### `gdrive slides create <title> [--file <path>] [--parent <folder>]`

Creates a presentation. With `--file`, the new deck is built from a document;
without one, it is what Slides itself makes: a deck with that title and one
empty slide.

`presentations.create` takes a title and nothing else, so this is up to three
calls: create, then one `batchUpdate` carrying the whole document, then a Drive
move when `--parent` is given. That one batch **also deletes the slide the
create came with** ([`../decisions/0030`](../decisions/0030-slides-write.md)
§4), so `--file` leaves no blank first slide ahead of the document's own.

The `<title>` argument names the deck and **wins over the document's `title`**.
Every slide `id` in the document is ignored, because a new deck has none of
them — which is what makes reading one deck and creating another a copy.

```console
$ gdrive slides create -f text "Q4 review" --file deck.yaml --parent Decks
Created Q4 review (1NeWdEcK...)
```

Quiet: the new presentation ID.

A copy is a copy of the *text*, not of the deck. What
[a write leaves out](#what-a-write-leaves-out-1) a create leaves out too, and
on a create that includes every slide's `notes` and every `elements` entry —
each named in `data.unsupported`, so the diff between the two decks is never a
surprise.

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
$ gdrive upgrade -f text --dry-run
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
| `3` | Bad arguments | `INVALID_ARGS`, `PRUNE_REQUIRED` |

Errors go to stderr — as `Error: <message>` in text mode, or as the envelope in
JSON mode. See [`../decisions/0007`](../decisions/0007-output-and-errors.md).

`PERMISSION_DENIED` means the account is signed in and Drive refused anyway —
typically a shared-drive file where you hold `reader` or `commenter` and the
command needs `writer` or `organizer`. Re-running `gdrive auth` will not change
it; ask an organizer of the drive for a higher role. Exit **2** is reserved for
the cases `gdrive auth` really does fix, including a token minted before a
scope was added. See
[`../decisions/0017`](../decisions/0017-permission-denied-error-code.md).

`PRUNE_REQUIRED` is raised by
[`gdrive forms write`](#gdrive-forms-write-form---file-path---prune---dry-run)
and [`gdrive slides write`](#gdrive-slides-write-presentation---file-path---prune---dry-run),
and shares exit **3** with `INVALID_ARGS` while staying a separate code,
because the two ask for different next actions: `INVALID_ARGS` means fix the
document, `PRUNE_REQUIRED` means confirm you meant to delete a question or a
slide and re-run with `--prune`. Nothing was written either way.
