# 0008: File addressing & Drive commands

Date: 2026-07-24
Status: accepted

## Context

Google Drive is not a strict tree: a file can have multiple parents and names
are not unique. We still want ergonomic addressing without forcing users to
copy file IDs everywhere.

## Decision

### File addressing

A `<file>` argument accepts either:

- A **file ID** (canonical, unambiguous) — e.g. `1AbC...`.
- A **path** relative to the account's My Drive root — e.g.
  `"Reports/2026/summary"`. Path segments are resolved by name against parent
  folders.

Resolution rules:
- An argument matching a Drive ID pattern is treated as an ID first. That
  pattern covers a shared drive's 19-character root ID as well (`0016` §3).
- Path resolution walks segments from root. If a segment name is **ambiguous**
  (multiple matches), the command errors `INVALID_ARGS` listing the candidate
  IDs; the user disambiguates with an ID.
- `NOT_FOUND` if any segment does not resolve.

### Deletion

`gdrive rm <file>` moves the file to **trash** by default. `--permanent`
deletes it irrecoverably. (There is no interactive confirm in JSON mode.)

### Commands

| Command | Description | Key options |
|---------|-------------|-------------|
| `gdrive ls [<folder>]` | List a folder's children (My Drive root if omitted) | `--type <folder\|doc\|sheet\|file>`, `--trashed`, `-n/--limit`, `--order <name\|modified\|created>`, `--drive <name>` (not with `<folder>`) |
| `gdrive search <query>` | Search by name / full text | `--type`, `-n/--limit`, `--order`, `--all-drives`, `--drive <name>` |
| `gdrive drives` | List the account's shared drives with their IDs | |
| `gdrive info <file>` | Show file metadata | |
| `gdrive download <file>` | Download binary content, or export a Doc/Sheet | `-o <path>` (stdout if omitted), `--export-as <pdf\|docx\|xlsx\|csv\|md\|txt>` |
| `gdrive upload <local>` | Upload a local file | `--parent <folder>`, `--name <name>`, `--as-doc`, `--as-sheet` (convert on upload) |
| `gdrive mkdir <name>` | Create a folder | `--parent <folder>` |
| `gdrive mv <file> <folder>` | Move to another folder | |
| `gdrive cp <file> <folder>` | Copy into a folder | `--name <name>` |
| `gdrive rm <file>` | Trash (default) or delete | `--permanent` |

### Output

Text `ls`:
```
Type    Modified          Name                       ID
folder  2026-07-20 14:03  Reports                    1AbC...
doc     2026-07-22 09:10  Meeting notes              1DeF...
sheet   2026-07-23 18:44  Budget 2026                1GhI...
```

Quiet `ls`/`search`/`drives`: one ID per line. Quiet `upload`/`mkdir`/`cp`: new
ID. Quiet `rm`: no output. `download` quiet: output path (or nothing when
piping). `drives` carries a `drives` array of `{ id, name }` in JSON.

JSON `data` carries a `files` array (or single `file`) of the File structure:

```json
{ "id": "1AbC...", "name": "Reports", "mime_type": "application/vnd.google-apps.folder",
  "type": "folder", "size": null, "parents": ["0ABC..."], "trashed": false,
  "web_view_link": "https://...", "created": "…", "modified": "…", "owners": ["me@gmail.com"] }
```

`type` is a friendly label derived from `mime_type`
(`folder`/`doc`/`sheet`/`slides`/`file`).

## Related

- Sharing / permissions (`gdrive share`) are specified in
  [`0011`](0011-sharing-commands.md).
- Shared drives are addressed by **ID** in every command;
  [`0016`](0016-shared-drive-scope.md) covers that and the `ls`/`search` scope
  flags. Path resolution above remains My Drive–only.

## Out of scope (deferred)

- Multiple-parent management, revisions, and shared-drive *paths* (see 0016).

## Consequences

- `lib/api.ts` wraps Drive v3 (list/get/create/copy/update/delete, media
  up/download, export). `lib/resolve-path.ts` implements ID-or-path resolution
  used by every file-taking command.
