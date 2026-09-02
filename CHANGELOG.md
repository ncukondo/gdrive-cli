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

## 0.11.0 — 2026-09-02

**Every open issue on the tracker is closed in this release.** Nine of them, and
what they have in common is worth knowing before the list: the two that will be
felt first are both `docs` — a document's headers, footers and footnotes stop
being invisible, and `insert` finally has an inverse.

The rest is smaller and mostly protective. `gdrive auth` stops hanging for ever
where nobody can finish it, a truncated listing stops passing for a complete one,
and a branching form can be copied at all.

### Breaking changes

Pre-1.0 behaviour changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x. Each was measured — against a real Google account where the change
is about what Google accepts, and by running the command where it is about the
terminal.

1. **A marker that appears in the body *and* in a header now matches twice, and
   `docs insert --before|--after` refuses it.** The marker walk covers headers,
   footers and footnotes now, so "matches exactly once" means once in the whole
   document rather than once in the body. An `insert` that worked yesterday can
   become `INVALID_ARGS` naming the count.

   This is the correct failure: the alternative is a write landing in a segment
   you did not mean, which nothing in the output would tell you about.

   What to do: narrow the marker, or add `--match-case`. `docs replace` is
   unaffected — it changes every occurrence, as it always did.
   [Decision 0064](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0064-a-marker-is-addressable-anywhere.md)
   §2.

2. **`gdrive docs read` prints a document's headers, footers and footnotes.**
   Anything parsing that output sees new content for a document that has them.
   Each is labelled with its kind and the id the API knows it by —
   `<!-- header: kix.… -->` in Markdown, `[header: kix.…]` under `--as text`,
   which takes no markup. A document with none reads exactly as before.

   What to do: nothing, unless you were treating `docs read` as body-only.
   [Decision 0064](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0064-a-marker-is-addressable-anywhere.md)
   §3.

3. **`gdrive auth` needs a terminal on stderr, and refuses in a second where it
   used to hang for ever.** The consent URL — and the `Client ID:` prompt beside
   it — moved to stderr, where a person reads rather than a caller consumes, and
   that is now the stream the command checks.

   Three measured consequences, on a machine with credentials already in place:

   | | before | now |
   |---|---|---|
   | `gdrive auth </dev/null`, nothing attached | blocked until killed | exit 2, naming the terminal |
   | `gdrive auth > file` at a terminal | hung, with the URL in the file | works; the URL is on your terminal and the file gets the envelope alone |
   | `gdrive auth 2> file` at a terminal | worked | exit 2, naming the terminal |

   What to do: stop redirecting stderr. The rule is that stderr must be a
   terminal, so `2> log`, `2>&1 | tee log` and `|& less` are all refused;
   redirecting stdout is the case worth having and it now works.
   [Decision 0059](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0059-the-browser-flow-needs-a-reader.md).

4. **`gdrive -f json auth` is refused.** It used to complete the login, printing
   a consent URL and a JSON envelope interleaved on one stream — so nothing
   could parse the result, but a person watching it did get a token.

   What to do: drop the flag. The refusal says so.
   [Decision 0059](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0059-the-browser-flow-needs-a-reader.md)
   §4.

5. **A new error code, `LISTING_INCOMPLETE`** (exit 3). A consumer that switches
   exhaustively over the codes has a new member to handle. It is raised only by
   `cp -r`, below.
   [Decision 0060](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0060-a-listing-says-when-it-stopped.md)
   §4.

6. **`gdrive cp -r` fails on a folder with more than 100,000 children** instead
   of reporting a partial copy as a success. Nothing that was correct becomes
   incorrect; a run that used to lie now stops and says where.

   What to do: copy the large subfolders one at a time. The error names the
   folder, and the usual `cp -r` report still lists everything already copied.

7. **`gdrive ls` and `gdrive search` gain a `complete` field** in the JSON
   envelope. A consumer that asserted the exact key set needs to stop; one that
   ignores it behaves as before.

### Added

- **`gdrive docs delete <file>`** — `insert`'s inverse, and the only command
  here that can remove a **table**. `--from <marker> --to <marker>` names two
  ends and never anything inside, so a table between them goes with the range;
  `--index <n> --length <n>` is the escape hatch. Removing a whole paragraph
  takes its paragraph mark, so no blank line is left — which an empty
  `--replace` cannot do. `--dry-run` reports the range, the character count and
  the document's own text at each end. There is no undo: Google Docs' version
  history in the browser is the backstop.
  [Decision 0062](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0062-a-write-has-an-inverse.md).
- **`docs insert`, `docs replace` and `docs delete` reach headers, footers and
  footnotes.** Two limits are the API's rather than this CLI's, and both are
  reported rather than passed through: a table cannot go in a footnote (the rest
  of the payload is still written, and the loss is reported), and a page break
  before a paragraph is a body idea, so the style reset drops that one field
  outside the body.
- **`gdrive slides write` can edit an `elements` entry's text**, addressed by
  the object id the entry already carries. That is what makes a
  `TITLE_AND_TWO_COLUMNS` deck round-trip: its second column reads as an
  `elements` entry and now writes as one. A displaced placeholder and a
  hand-placed text box are treated alike, because `insertText` does not
  distinguish them. Structure — an entry's `id`, `kind` or `placeholder`, and
  adding or removing one — is still refused, and an *empty* placeholder is still
  not listed, so a blank second column cannot be filled from here.
  [Decision 0063](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0063-an-element-is-addressed-by-its-id.md).
- **A `PRUNE_REQUIRED` refusal carries the plan it refused.** `forms write` and
  `slides write` put the items they would have deleted in the error envelope's
  `data` — `{id, plan, applied: false}`, the same `plan` shape a success reports
  — and `-q` prints their ids, one per line. The deletions only: the refusal is
  decided before the rest of the plan is built, and `--dry-run --prune` is the
  one call that answers the rest.
- **`ls` and `search` report `complete`.** `false` means the listing stopped at
  100,000 entries rather than at the end of the folder; the rows are real, there
  are just more of them. Text mode prints a note, `-q` is unchanged, and the
  exit code is still 0. A listing you cut short yourself with `-n` is
  `complete: true` — you asked for that many.

### Fixed

- **`gdrive forms create --file` can copy a branching form.** Stripping an
  option's `go_to_section_id` while keeping its `go_to_action` left the option
  list half-navigated, and the Forms API refuses that outright — so an ordinary
  branching form could not be copied **at all**, the whole atomic batch failing
  with *Invalid Options, Either all or no options should be go to enabled*. The
  navigation now leaves as a unit; the question itself is still copied, with its
  wording and its options. A list that navigates only with `go_to_action` names
  no id and is copied untouched. Confirmed both ways against a real account.
  [Decision 0061](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0061-navigation-is-all-or-nothing.md).
- **`gdrive auth` no longer blocks for ever on a machine that has credentials.**
  The guard covered the credential prompt and not the OAuth flow underneath it,
  so the *configured* machine — the one that gets past the prompt — was the one
  that hung. See breaking change 3.
- **A listing is four to ten times fewer round trips.** Drive is asked for pages
  of 1,000 rather than 100, so an ordinary thousand-child folder costs one
  request instead of ten.
- **A truncated `search` no longer reports "No files found".** Drive can return
  an empty page while still having more, and the old message inverted the answer:
  it had not found none, it had stopped looking.
- **The generated-type guard reaches inside a Drive `requestBody`.** A field in
  `files.create`, `files.copy`, `files.update` or a permission body is now
  checked against the googleapis types, which
  [decision 0026](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0026-ln.md)
  §6 wrongly claimed was already true. Two guards beside it turned out not to
  guard: an optional field's inner keys were compared against nothing, and the
  `extends` assertion in the Docs, Forms and Slides checks had asserted nothing
  since it was written. Invisible to a user; it is what stops a googleapis bump
  from breaking a request silently.

### Development

- **`bun run test` no longer depends on the shell to exclude the live suite.**
  The exclusion moved from `--exclude 'tests/e2e/**'` — POSIX quoting that
  `cmd.exe` does not honour — into `vitest.config.ts`, with `test:e2e` getting
  its own config. On Windows the old form could hand vitest a literal that
  matched nothing, and `bun run test` would have reached for a real Google
  account. No test script contains a quote or a glob character now.

## 0.10.0 — 2026-08-07

**Slides can be read and written, forms can be written, and Drive gains `ln`,
`rename` and `cp -r`.** Every Workspace file type this CLI names now has a read
and a write path.

The other half of this release is narrower and will be felt sooner: **this CLI
no longer lets you give a file a name it could not then find by path.** Five
refusals are new, and each one names the remedy.

### Breaking changes

Pre-1.0 behaviour changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x. All five were confirmed against a real Google account.

1. **`gdrive cp <file> <folder>` keeps the source's name.** It used to get
   Drive's default, which is not one rule: a binary file kept its name and a
   Google-native document became `Copy of <name>`. A copy now keeps its name at
   every level of a tree, whatever its type.

   What to do: nothing, if you wanted the file called what it is called. To get
   the old name back, ask for it — `gdrive cp Budget Archive --name "Copy of
   Budget"`.
   [Decision 0054](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0054-a-copy-keeps-its-name.md).

2. **A name another file in the same folder already holds is `INVALID_ARGS`.**
   This reaches `cp`, `ln`, `mkdir`, `mv`, `rename`, `upload` and every
   `create`. Drive permits the duplicate; this CLI cannot address the result,
   and afterwards a path naming either file answers *Ambiguous path segment* —
   including the file that was already there and was never touched.

   What to do: pass `--name`, or choose a different one. The error names the
   file it collided with and suggests a name; `mv` has no `--name`, so its
   message points at `gdrive rename`.

3. **A name a path could not carry back is `INVALID_ARGS`.** Two of these apply
   everywhere: a name that begins or ends with whitespace, and a name
   containing `/`. Four more apply only where the name would be the whole path
   argument — that is, at the top of My Drive or of a shared drive: `root`,
   `/`, the empty string, a name shaped like a Drive id (20 or more of
   `A-Za-z0-9_-` with no `/`, or a drive root's `0A` and 17 more), and a name
   beginning with `drive:`.

   In an ordinary subfolder those four are fine: `gdrive mkdir --parent Reports
   Meeting_notes_2026_08` creates it, and `Reports/Meeting_notes_2026_08` finds
   it.

   What to do: the error names what is wrong and offers a repaired name.
   [Decisions 0055](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0055-a-name-has-to-be-addressable.md)
   and [0056](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0056-the-class-was-wider-than-0055-drew-it.md).

4. **`--quiet` writes to stdout on a failure that changed something.** A
   partially completed `cp -r` and a `create` that failed after making the file
   both print the new ids there, one per line; previously the whole rendered
   error including those values went to stderr, so nothing could capture them.
   The reason still goes to stderr.

   What to do: `ID=$(gdrive forms create "…" --file f.yaml --parent X -q)` now
   captures the id of what was left behind. **Check the exit code** — that same
   line is a successfully created file's id when the command succeeds, and the
   capture alone cannot tell you which happened.

5. **A failure can carry `data`.** The error envelope is
   `{success: false, error: {code, message}}` as before when nothing happened,
   and gains a `data` key when something did — the ids `cp -r` created before it
   stopped, or `{id, title, parent_id?}` for a file a failed `create` left. A
   consumer that asserted the failure envelope has exactly two keys needs to
   stop.
   [Decision 0031](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0031-recursive-copy.md)
   §3–§4.

### Added

- **`gdrive slides read | write | create`** — a deck as one YAML document:
  each slide's layout, its placeholder text and its speaker notes. Everything
  else — hand-placed shapes, images, tables — is listed read-only under
  `elements`, with a `placeholder` field naming the type where the entry is a
  placeholder the document had no field for. A write rewrites only the
  placeholders whose text changed, and warns that rewriting one drops its inline
  formatting. `create` does not carry speaker notes: a new slide's notes page has
  no id until the slide exists.
- **`gdrive forms write | create`** — an edited form document applied back,
  matching items **by id**, so a renamed question keeps every answer already
  attached to it. Every write reports its plan; `--dry-run` writes nothing;
  deleting a question needs `--prune`, because deleting one severs its responses
  for good.
- **`gdrive ln <target> <folder> [--name]`** — creates a Drive shortcut. The
  target is followed and the folder is entered, per the role table in
  [decision 0025](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0025-shortcuts.md).
- **`gdrive rename <file> <name>`** — changes a file's Drive name. `<file>` is an
  entry, so renaming a shortcut renames the shortcut. For a Doc, a Sheet and a
  deck the Drive name *is* the in-document title; for a form the editor's title
  follows a few seconds later.
- **`gdrive cp -r <folder> <folder>`** — reproduces a folder tree, which Drive
  has no single request for. A shortcut inside the tree is copied as a shortcut
  and its target is not copied. The first non-transient failure stops the run,
  and the failure reports every folder and file already copied, so a caller can
  tell how far it got.

### Fixed

- **A form created by `forms create` is named in Drive**, not left as `Untitled
  form`. `documentTitle` can only be set when a form is created, so every form
  this CLI made before this release is still called `Untitled form` in Drive and
  unreachable by path — `gdrive rename` repairs one.
- **A `create` that fails after making the file no longer leaves it in My Drive's
  root.** All four now move into `--parent` before writing anything into it, and
  a failure names the file.
  [Decision 0057](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0057-a-create-moves-before-it-fills.md).
- **`gdrive cp -r /` no longer copies My Drive into itself without stopping.**
  The cycle guard compared the alias `resolvePath` returns for `/` against the
  real id `parents` carries, so it never matched.
- **`forms create` no longer copies another form's item ids into a new form.**
  An option's `go_to_section_id` is an item id and was carried through, so
  copying a branching form either failed or produced navigation pointing at
  nothing.
- **`forms write` no longer sends an option's label beside `isOther`**, which
  the API refuses, and no longer builds a `file_upload` question the API cannot
  create — that item is reported as skipped instead of failing the whole batch.
- **A grouped shape's text is no longer lost** by `slides read`.

### Internal

`tests/e2e/` now covers the write paths — shortcuts, Forms, Slides and `cp -r` —
so the encodings only Google can refuse are checked by `.husky/pre-push` rather
than by a manual pass. Six write-side defects reached review through a full unit
suite during this cycle; every one was an encoding a fake client accepted and the
API refused.

## 0.9.0 — 2026-08-05

**Text written into a document arrives in the document's default style.** It
used to arrive wearing whatever formatting sat at the insertion point.

### Breaking changes

Pre-1.0 output changes, permitted by [decision
0014](https://github.com/ncukondo/gdrive-cli/blob/main/decisions/0014-pre-1.0-compatibility.md)
and listed here because that record makes the release notes the compatibility
log for 0.x.

1. **`docs create --content`, `docs append`, `docs insert` and `docs replace`
   no longer inherit the style at the insertion point**, with two exceptions
   named below. The Docs API gives inserted characters the style of the text
   they land after, and gives a paragraph split the style of the paragraph it
   split — so appending after a
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

   **One byte-level change comes with this**, on the `--as text` path only: the
   payload is now sent as Docs would have stored it, because every reset range
   is measured in characters and a character the API drops on the way in would
   push those ranges past what they name. The API drops U+0000-U+0008,
   U+000C-U+001F and the private use area, so those disappear as they always
   did — but a lone carriage return, which Docs would have dropped, now becomes
   a newline instead. A classic-Mac text file therefore arrives as separate
   paragraphs rather than one run-together line. CRLF is unaffected: it was
   already a newline either way.
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
