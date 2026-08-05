# 0045: An insert writes its own slate; it does not inherit the neighbour's style

Date: 2026-08-05
Status: accepted — extends [0021](0021-markdown-writes.md)

## Context

Text written by `docs insert`, `docs append`, `docs replace` and
`docs create --content` arrives wearing whatever formatting was already at the
insertion point: the font, size, colour, bold, underline and link of the
character it lands after, and — once its own newline splits a paragraph — that
paragraph's named style, indent and bullet. Appending after a `Heading 1` makes
the appended body a heading. Inserting inside a bulleted list makes every
inserted paragraph a bullet.

That is the Docs API behaving as documented: `insertText` gives the new
characters the text style of the text at the insertion index, and a paragraph
split leaves both halves with the paragraph style of the paragraph that was
split. Nothing in the API defaults a write to "plain".

Our request builder only ever *adds* style, so nothing undoes any of it:

- `textStyleOf` (`src/lib/markdown-doc.ts`) returns `null` for a span with no
  bold, italic, code or link, so a plain span produces no `updateTextStyle` at
  all.
- Where a style *is* sent, `fields` names only the properties being set, and
  `fields` is exactly what Docs resets. A `**bold**` span landing after 20pt red
  underlined text comes out bold *and* 20pt red underlined.
- `paragraphRequests` returns nothing for a paragraph, a code block or a list
  item, and one field for a heading or a quote. No `deleteParagraphBullets` is
  ever emitted for a non-list block.
- The `--as text` path (`insertText` in `src/lib/docs-api.ts`) sends the insert
  and nothing else.

[0021](0021-markdown-writes.md) §4 already settles what the result should be:
the reference for every construct is Drive's native `text/markdown` import, and
that import produces `NORMAL_TEXT` paragraphs in the document's own default
font. So this is not a new preference — it is 0021 §4's contract, unmet because
its mapping table was read as a list of what to *add* when it also fixes what
must not survive.

Why the unit tests never saw it is the argument
[0043](0043-e2e-runs-before-push.md) makes: they assert the request array, which
is what the author believed Docs would do with it. Inheritance is a property of
the API, and only Google can demonstrate it.

## Decision

### 1. Every insert resets the character style of what it wrote

One `updateTextStyle` covers the whole inserted range with an empty
`textStyle` and the full mask —
`bold, italic, underline, strikethrough, smallCaps, backgroundColor,
foregroundColor, fontSize, weightedFontFamily, baselineOffset, link` — the
complete set of writable `TextStyle` fields. Every per-span request the builder
already emits then applies **on top**, unchanged and in the order it already
runs, so `**bold**` is still bold and `` `code` `` is still Courier New.

Resetting a field does not mean a hard-coded Arial 11: an unset field inherits
from the paragraph's named style, so a document whose `NORMAL_TEXT` is Noto Sans
12 gets Noto Sans 12. "Default" here always means *this document's* default.

This is exact by construction — a character range names our characters and
nobody else's.

### 2. Paragraph style is reset only on paragraphs the insert wholly created

One `updateParagraphStyle` and one `deleteParagraphBullets` over the span of
those paragraphs. The mask is every writable `ParagraphStyle` field except
three: `headingId` and `tabStops` are read-only, and `direction` is not
inherited — including it would force LTR onto a right-to-left document, which is
a new bug, not a fix. `deleteParagraphBullets` is not optional: without it an
insert into a list is the one case where the bullets survive a full style reset.

The exclusion is the point of the rule. A paragraph is the smallest unit
paragraph style has, so resetting the paragraph an insert *merged into* would
restyle text the user did not name — `insert --after "…"` pointing into the
middle of a heading would un-heading it. Those paragraphs keep their style, and
the characters inserted into them still get §1.

A paragraph is wholly ours when our own text opens it and our own newline closes
it. At the edges that is a question about the document, not about the payload:
the first inserted paragraph is ours when the index sits at a paragraph start
(or the payload opens with a newline), and the last is ours when the payload
ends with a newline (or the index sat at a paragraph end). Every caller already
holds the document it resolved the index against, so it answers both and passes
them down. 0021 §5's one-round-trip property is unaffected — a payload without a
table still costs one call.

### 3. `--as text` is about parsing, not about styling

`--as text` says the payload is not Markdown. It has never said "inherit the
formatting next to it", and a log pasted into a document has no more reason to
come out red and bold than a Markdown one. Both paths reset by §1 and §2.

### 4. The live suite is where this is asserted

A unit test can only pin that the reset requests are *sent*; that Docs then
honours them is the part that has to be seen. `docs read` renders headings,
bullets, bold, italic and links, so those become live assertions: append after a
heading and the appended line is not a heading; insert into a list and the
inserted paragraph has no bullet; insert after bold text and it reads back
unbolded.

Font, size and colour are invisible to `read`, so they stay a named manual check
in the task's `Verification` section, which is exactly the split
[0043](0043-e2e-runs-before-push.md) §4 requires.

## Out of scope (deferred)

- **Resetting a paragraph an insert merged into.** §2, by design, not by
  omission. It will not be done.
- **A flag to keep the surrounding style** (`--inherit-style`). Not filed as an
  issue ([0042](0042-deferred-work-is-an-issue.md) §2): nobody has asked for it,
  and 0021 §4's reference — the native `text/markdown` import — has no such
  mode. It will not be done unless someone reports needing it.
- Everything 0021 already defers: images, nested or merged cells, column widths.

## Consequences

- `markdown-doc.ts` gains the two masks and emits the reset requests ahead of
  the style requests it already builds; the per-block builders are untouched.
  `planTextRun` learns whether its first paragraph is its own.
- `docs-api.ts` gains a paragraph-boundary reader and passes it into both write
  paths; `insertText`, `insertMarkdown` and `replaceMarkdown` take it, and
  `insert` / `append` / `create` supply it from the document they already read.
- Two or three extra requests per insert — per call, not per block — and no
  extra round trip.
- The output of all four write commands changes for any document that is not
  already in its default style. It is a breaking change under
  [0014](0014-pre-1.0-compatibility.md), so it is named in `CHANGELOG.md`.
- `docs/commands.md` states the rule and its one exception, next to `--as`.
