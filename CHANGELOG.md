# Changelog

While the version is 0.x, [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
allows a breaking change in a minor release, on the condition that it is called
out in the release notes for the version that ships it. That makes this file the
compatibility record for 0.x rather than a summary of the git log: it lists what
a consumer has to change and what shipped, not every commit. It ships in the npm
package as well as on GitHub, so links here are absolute.

`.github/workflows/release.yml` extracts the section matching the tag with
`bun run changelog <version>` and publishes it as the release body, with
GitHub's generated notes appended below it. A tag whose version has no section
here fails the release job before anything is published, so **the entry is
written before the version is bumped**.

A version heading is exactly `## <version> — <YYYY-MM-DD>`, newest first. The
extractor requires that shape and treats a heading that drifted from it as a
missing version, because nothing else can tell the two apart.

Releases before 0.8.0 are not backfilled; their notes are whatever GitHub
generated at the time.

## 0.8.0 — 2026-08-03

Drive shortcuts and Google Forms. `gdrive` now knows what a shortcut is and
follows it where following is right, and `gdrive forms read` / `forms responses`
read a form and its answers.

### Breaking changes

Pre-1.0 output changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x.

1. **`type` gains two members, `shortcut` and `form`.** A Drive shortcut used to
   report `type: file` and now reports `type: shortcut`; a Google Form used to
   report `type: file` and now reports `type: form`. The full vocabulary is
   `folder`, `doc`, `sheet`, `slides`, `form`, `shortcut`, `file`, and an
   unknown `--type` now lists all seven. A consumer switching exhaustively on
   `type`, or matching `type == "file"` on something it knew to be a form or a
   shortcut, needs updating. [Decision
   0034](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0034-form-is-a-file-type.md)
   states the rule the vocabulary follows: a type exists when a command can act
   on it.

   The `--type` *filter* did not follow the labels all the way. `--type file`
   still means "anything that is not a folder", so it still returns forms and
   shortcuts even though each now reports its own type. Filter with
   `--type form` or `--type shortcut` when you want only those.

2. **The file object gains `target_id` and `target_type`**, on every file, `null`
   on everything that is not a shortcut ([decision
   0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md)
   §2). This is additive, so it only bites a consumer that rejects unknown
   fields or compares whole objects. In text output, `gdrive info` on a shortcut
   gains a `Target: <id> (<type>)` line directly after `Created`.

3. **A shortcut is followed, or not, according to what the argument is for.**
   Previously nothing was followed, and the commands that should have followed
   simply failed. Now `ls <folder>`, `download`, `docs read/append/insert/replace`,
   `sheets tabs/read/write/append/clear`, `forms read/responses`, every
   `--parent`, and the *destination* of `mv` and `cp` resolve through a shortcut
   to its target, while `rm`, `info`, `share list/add/remove/link` and the
   *first* argument of `mv` and `cp` keep acting on the shortcut itself — the
   rule POSIX applies to symlinks. Every intermediate segment of a path is
   followed regardless of the command.

   What changes for an existing script: a command that used to fail or do
   nothing on a shortcut now acts on the target, and a path that traverses a
   folder shortcut now resolves instead of returning `NOT_FOUND`. Nothing that
   used to succeed on a file you can read does something different, and in
   particular `rm <shortcut>` trashed the shortcut before and still does. Three
   new failures exist, each naming the shortcut rather than an id you cannot
   see: a shortcut whose target is gone or invisible is `NOT_FOUND`, a shortcut
   pointing at another shortcut is `API_ERROR`, and a shortcut Drive reports
   with no target at all is `API_ERROR`.

   One cost, not a break: on `ls`, `docs *`, `sheets *`, `forms *`, every
   `--parent`, and the destination of `mv` / `cp`, an argument given as a bare
   **file ID** now costs an extra `files.get`, because nothing in an ID says
   whether it is a shortcut ([decision
   0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md)
   §4). A path pays it only when its last segment really is one, and `download`
   pays nothing either way — it reuses the metadata the lookup already fetched.

4. **The `ls` / `search` text table's `Type` column is two characters wider**
   (8 → 10), because `shortcut` is eight characters and would otherwise run
   straight into the timestamp. Every column after it shifts. Anything parsing
   that table by fixed offsets needs adjusting; `-f json` is unaffected and
   remains the supported machine interface.

### Added

- **`gdrive forms read` and `gdrive forms responses`.** A form reads as a single
  YAML document — ids, questions, options and all — and its responses read as a
  table whose columns are the question titles, with `--as csv` and `--as json`
  alongside the default table. A grid question contributes one column per row,
  headed `<item title> — <row title>`. What the document cannot model is kept
  verbatim under `raw` and reported on stderr (or in an `unsupported` field in
  JSON) rather than silently dropped ([decision
  0027](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0027-forms-document.md)).
  No new OAuth scope is needed, so an existing login keeps working, but the
  **Google Forms API must be enabled** on your Cloud project.
- **Shortcut support throughout.** Paths walk through folder shortcuts,
  `gdrive info` reports what a shortcut points at, and `ls --type shortcut`
  finds them.
- **`--type form` and `--type shortcut`** on `ls` and `search`.

### Fixed

Everything here was broken because the CLI had no idea shortcuts existed
([decision
0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md)
calls them bugs rather than missing features):

- A path could not pass through a folder shortcut:
  `gdrive ls "Reports/link-to-2026/Q3"` was `NOT_FOUND` for a path that opens
  fine in the Drive UI.
- `gdrive ls <folder shortcut>` listed nothing, because a shortcut has no
  children of its own.
- `gdrive download <shortcut>` refused to run — a shortcut reported `type: file`
  with a Google-native MIME, so it asked for an `--export-as` that could not have
  worked either — and `docs read <shortcut>` / `sheets read <shortcut>` answered
  404 for a document that plainly exists. Nothing was ever written to disk, so
  there is nothing on yours to re-download.

### Known gaps

- **A form has two names, and a path only knows one.** The Drive name is what
  `ls`, `search` and `info` report; the `title` inside the document is what
  `forms read` prints, and titling a form in the Forms UI leaves its Drive name
  at `Untitled form`. Every command taking a `<form>` resolves the path by the
  Drive name, so `gdrive forms read "<the Forms title>"` is `NOT_FOUND` for the
  very form that `gdrive search "<the Forms title>"` returns — Drive's full-text
  index covers the internal title, path resolution does not. Take the ID from
  `search`, or the name in its `Name` column.
- **`gdrive download <form>` gives advice that cannot work.** It fails with
  "specify `--export-as`", and `--export-as` on a form fails too: the Forms API
  has no export. Use `gdrive forms read`.
- **Creating a shortcut is not supported** (`gdrive ln`), and neither is writing
  a form. Both are planned.
- **Pre-existing, and worse than the column this release widened:** the `Name`
  column of the `ls` / `search` table has the same defect the `Type` column had,
  twice over. A name of 27 or more UTF-16 units meets the column width exactly,
  so the padding adds nothing and the ID abuts the name — `…xxxxxxx1AbCdEf`,
  with no way to tell where one ends. And a full-width character costs one
  UTF-16 unit but two display columns, so a name containing them pushes every
  column to its right out by that much, and rows in one table disagree about
  where the ID starts. Neither is introduced here, both hit ordinary names, and
  together they are the reason to parse `-f json` rather than the table.
