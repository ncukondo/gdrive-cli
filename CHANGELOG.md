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

## 0.9.0 — 2026-08-05

**Text written into a document arrives in the document's default style.** It
used to arrive wearing whatever formatting sat at the insertion point.

### Breaking changes

Pre-1.0 output changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x.

1. **`docs create --content`, `docs append`, `docs insert` and `docs replace`
   no longer inherit the style at the insertion point**, with one exception
   named below. The Docs API gives
   inserted characters the style of the text they land after, and gives a
   paragraph split the style of the paragraph it split — so appending after a
   `Heading 1` produced a heading, inserting into a bulleted list produced
   bullets, and inserting after 20pt red bold text produced 20pt red bold text.
   They now reset what they wrote: the character style always, and the
   paragraph style of every paragraph the write wholly created, bullets
   included. `--as text` is included — it says the content is not Markdown, not
   that it should inherit formatting.

   **`replace --as text` is the exception** and still inherits. It substitutes
   through the API's own `replaceAllText` in one request, which reaches headers,
   footers and footnotes that nothing else in this CLI can address, and which
   reports how many occurrences it changed but never where — and a style reset
   needs a range.
   [Decision 0046](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0046-replace-as-text-keeps-its-reach.md)
   records why keeping the reach won, and
   [issue #21](https://github.com/ncukondo/gdrive-cli/issues/21) is what would
   close the gap. `replace` without `--as text` resets like the rest.

   "Default" means *your document's* default: a reset field inherits from the
   named style, so a document whose body is Noto Sans 12 gets Noto Sans 12, not
   Arial 11.

   **A second exception, by design**: an insert that lands inside an existing
   paragraph — which `--index` and `--before` / `--after` can do — leaves that
   paragraph's own style alone, because a paragraph cannot be half-heading. The
   characters it wrote are still reset.

   What to do: nothing, if you wanted plain text. If you were relying on an
   append picking up the surrounding formatting, apply that formatting in the
   Docs UI afterwards — there is no flag to restore the old behaviour.
   [Decision 0045](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0045-inserted-content-is-default-styled.md)
   is the reasoning, and
   [0021](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0021-markdown-writes.md) §4
   is the contract it meets: a document this CLI writes should be
   indistinguishable from one Drive imported from the same Markdown.

## 0.8.0 — 2026-08-03

**A command that is not told a format now prints JSON, not text**, with three
exemptions spelled out below. Alongside that, Drive shortcuts and Google Forms:
`gdrive` now knows what a shortcut is and follows it where following is right,
and `gdrive forms read` / `forms responses` read a form and its answers.

### Breaking changes

Pre-1.0 output changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x.

1. **JSON is what a command prints when it is not told otherwise.** Text was
   the default; it is now the convenience layer, asked for with `-f text` or
   with `default_format = "text"` in your config. It applies to every command
   but the three exempted below — the tables from `ls`, `search`, `drives`,
   `share list`, `sheets tabs`, `sheets read` and `forms responses`, the
   labelled block from `info`, and every one-line confirmation such as
   `Uploaded Budget (1S6cRd...)` — all of which now arrive as the envelope.
   **Errors move with them**: a failure that wrote `Error: <message>` to stderr
   now writes `{"success":false,"error":{"code":…}}` there instead, so anything
   matching stderr by prefix needs `-f text` too. `docs read` is the exception:
   a command keeps one format on both streams, and its is still Markdown's, so
   its stderr still reads `Error: …`. `forms read` behaves the same way, but it
   is new here and so changes nothing.

   **Three things are deliberately exempt**, because in each a JSON default
   would have broken something that was already right:

   - **`gdrive docs read` still prints Markdown and `gdrive forms read` still
     prints YAML**, with no flag. Those outputs already *are* the machine
     representation ([decision 0036](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0036-machine-format-by-default.md) §1),
     so `gdrive forms read X > form.yaml` keeps writing YAML. `-f json` wraps
     one in the envelope, in `data.content` / `data.form`.
   - **`-q` still prints the bare value**, whatever the default is
     ([decision 0038](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0038-quiet-asks-for-a-value.md) §1), so
     `FOLDER=$(gdrive mkdir 2027 -q)` needs no `-f`. A format you *name* still
     outranks it: `gdrive ls -f json -q` is JSON, which is
     [0007](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0007-output-and-errors.md)'s rule and unchanged (§2).
   - **`gdrive auth` still prompts** for OAuth client credentials on a fresh
     install at a terminal. [Decision 0005](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0005-auth-and-scopes.md)
     suppresses that prompt "to preserve automation", and the format was only
     ever a proxy for the question it is asking, so the CLI now asks it
     directly: **with no tty on stdin, a missing client is `AUTH_REQUIRED` and
     exit 2 under every format**, and `gdrive -f json auth` refuses even at a
     terminal. What changes for you: `gdrive auth` piped or in CI used to depend
     on the format resolving to json, and now does not depend on the format at
     all; interactively it prompts where an unasked-for json default would have
     refused.

   **If your config already said `default_format = "json"`**, or you export
   `GDRIVE_CLI_FORMAT=json`, the exemptions above are *changes* for you rather
   than reassurances — what grants them is whether a format was named on the
   command line, and a config key is not that:

   | with `default_format = "json"` | 0.7.0 | 0.8.0 |
   |---|---|---|
   | `gdrive docs read X` | envelope | **Markdown** |
   | `gdrive ls -q` | envelope | **bare ids** |
   | `gdrive sheets read S --as csv` | envelope | **CSV** |
   | `gdrive auth` with no terminal | `AUTH_REQUIRED`, exit 2 | `AUTH_REQUIRED`, exit 2 |

   `gdrive forms read` is new in 0.8.0, so it has no 0.7.0 behaviour to change;
   it prints YAML unless you name `-f json`, like `docs read`.

   Add `-f json` to those invocations to keep the envelope. Everything else your
   config already covered is unaffected.

   What to do: add `-f text` where you were reading or redirecting a table or a
   confirmation line, or set `default_format = "text"` once and change nothing
   else. `gdrive init` now writes `default_format = "json"`, so regenerating a
   config does not quietly restore the old default.
   [Decision 0036](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0036-machine-format-by-default.md) §1 is the reasoning:
   0007 opens by saying the primary consumer is an AI agent, and eleven lines
   later made the convenience layer the default.

2. **Text output is tab-separated and pads nothing.** `ls`, `search`, `drives`,
   `share list`, `sheets tabs`, `sheets read --as table`, `forms responses --as
   table` and `gdrive info` now join their fields with a single tab. No column
   is measured, so no column can be measured wrongly. Alignment was dropped
   rather than fixed again because no oracle for "how wide is this character"
   agrees with the others. Measured in this project's own dependency tree:
   `🟰` U+1F7F0 is `W` — two columns — in Unicode's `EastAsianWidth` data, and
   `Bun.stringWidth` agrees at 2, while `string-width@5.1.2` returns 1 — two
   answers inside one dependency tree, before a terminal and a font get a say. A
   wrong width is not cosmetic when the field to the right of it is the id the
   next command takes.

   What to do: split a row on `\t` instead of slicing it at fixed offsets. For
   columns on screen, pipe it through something that has a terminal and a font
   in front of it — `gdrive ls -f text | column -t -s $'\t'`.

   **`--as csv` and `--as json` are unchanged, and reach you without a flag.**
   Naming an encoding is a preference, so it selects text on its own:
   `gdrive sheets read S --as csv > out.csv` writes CSV as it always did, and
   `--as json` still gives the bare 2-D array. A named `-f` outranks it, so
   `--as csv -f json` is the envelope. `-q` prints CSV either way, for both
   `sheets read` and `forms responses`.

   Text is lossy on purpose now. Every value the CLI *interpolates* into text
   has its tabs, newlines and other control characters replaced with a space:
   a table field, a `--quiet` value, and a confirmation like
   `Created folder <name> (<id>)` or `Cleared <range>`. **No value can add a
   row, a line or a field the record did not have** — a table has as many rows
   as records, `-q` one line per value, and a message keeps the shape it was
   written with, which is one line for most and two for `gdrive share link`,
   whose newline belongs to the message rather than to a value. Drive accepts a
   newline in a file name — a sheet title and an A1 range reach the same
   messages — and one there used to split a row in half.

   This reaches values you supplied as well as values Google did: a path given
   to `download -o` or `init --config` is sanitised on its way back out, so
   `OUT=$(gdrive download X -o "$P" -q)` stops round-tripping a `$P` that holds
   a control character. `-f json` keeps it exact, which is the trade
   [decision 0036](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0036-machine-format-by-default.md)
   §2 makes on purpose: text is the lossy layer and JSON is the exact one.

   Three kinds of output are deliberately left as they are, because in each the
   content *is* the point: a document (`docs read`'s Markdown, `forms read`'s
   YAML), an encoding that quotes for itself (`--as csv`, `--as json`, and
   `-q`'s CSV), and the `Error: …` diagnostic on stderr. `-f json` carries the
   real value everywhere, sanitised nowhere.

3. **`type` gains two members, `shortcut` and `form`.** A Drive shortcut used to
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

4. **The file object gains `target_id` and `target_type`**, on every file, `null`
   on everything that is not a shortcut ([decision
   0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md)
   §2). This is additive, so it only bites a consumer that rejects unknown
   fields or compares whole objects. In text output, `gdrive info` on a shortcut
   gains a `Target:` line carrying `<id> (<type>)`, directly after `Created`.

5. **A shortcut is followed, or not, according to what the argument is for.**
   Previously nothing was followed, and the commands that should have followed
   failed or did nothing. Now `ls <folder>`, `download`, `docs read/append/insert/replace`,
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

### Added

- **`gdrive forms read` and `gdrive forms responses`.** A form reads as a single
  YAML document — ids, questions, options and all — and its responses read as a
  table headed by a `submitted` column and then the question titles, with
  `--as csv` and `--as json`
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

The `ls` / `search` table used to lose a file's name and ID to each other. A
name of 27 or more UTF-16 units met the column width exactly, so the padding
added nothing and the ID abutted the name — `…xxxxxxx1AbCdEf`, with no way to
tell where one ended. A full-width character costs one UTF-16 unit and two
display columns, so `研修医へのフィードバックシート` pushed every column right of
it out by 15, and rows in one table disagreed about where the ID began. A
newline in a name — Drive accepts one — split a row in half. The first two are
gone with the padding rather than repaired; the newline went to the sanitizer
described in the second breaking change above, which also covers spreadsheet
cells, form answers and one-line confirmations such as `Trashed <name> (<id>)`.

The rest was broken because the CLI had no idea shortcuts existed
([decision 0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md)
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
  "specify `--export-as`", and passing `--export-as` does not help: nothing in
  the CLI rejects it for a form, so the request reaches Drive's `files.export`,
  which answers 400 — `API_ERROR`, "Request failed with status code 400",
  measured against a real form. Use `gdrive forms read`.
- **Creating a shortcut is not supported** (`gdrive ln`), and neither is writing
  a form. Both are planned.
