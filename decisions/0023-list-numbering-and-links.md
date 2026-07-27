# 0023: Ordered lists keep their numbering, and links are links

Date: 2026-07-27
Status: accepted — extends [0021](0021-markdown-writes.md)

## Context

Two things the Markdown writer added in 0021 discards, found transcribing a real
document ([issue #8]).

A document whose sections are numbered `1.` through `12.`, each followed by the
paragraphs belonging to it, comes back numbered `1.` twelve times. CommonMark is
right that a blank line and intervening paragraphs end a list — these *are*
twelve separate lists — and `createParagraphBullets` starts every list it makes
at 1. The literal `2.` the author typed is consumed by the parser on the way in,
so the ordinal is not merely unstyled, it is gone. Any numbered document is
silently renumbered.

And `<https://…>` arrives as literal text, angle brackets included, because the
parser has no autolink rule and `HTML_LINE` matches `<h` at the start of a line
and takes the whole thing for a raw HTML block.

0021 §4 settles questions like these by appeal to Drive's native `text/markdown`
import rather than to taste, so this record is written from measurements of that
import and of the Docs API, not from reasoning about either.

## Decision

### 1. Numbering is list continuation, not a start value

Measured: uploading the issue's shape with `upload --as-doc` puts **all of the
items in one list** whose `startNumber` is 1, with the body paragraphs
interleaved between them and not part of the list. The numbers 1, 2, 3, 4 come
out of the items' order within that one list. A list is split only when another
*list* intervenes, or when the numbering restarts at 1:

| Between two numbered items | Native import |
|---|---|
| heading, paragraph, quote, code block, table | one list, numbering continues |
| a nested sub-list | one list, sub-list at `nestingLevel: 1` |
| a bulleted list | split, and the second list carries `startNumber` |
| a number that restarts at 1 | split, both lists start at 1 |

So the model is: **ordered items separated by non-list blocks belong to one
Docs list when their numbers continue.** `parseMarkdown` keeps each item's
literal number instead of reducing it to `ordered: boolean`, and a run continues
across intervening blocks when the next item's number is the previous one's plus
one.

Within a *contiguous* run the numbers stay insignificant, as in CommonMark: only
the first one is read, and Docs renumbers from it. The number matters for
exactly two things — where a run starts, and whether it continues.

### 2. The API can express this, in three steps

There is no request that sets `listId` or `startNumber`; `NestingLevel.startNumber`
is read-only. Continuation is still reachable, and it was measured end to end:

1. `createParagraphBullets` over the **whole span**, items and intervening
   blocks together;
2. `deleteParagraphBullets` over each intervening run;
3. for an intervening run that is itself a list, `createParagraphBullets` again
   with its own preset.

Step 3 must follow step 2 and cannot replace it. Applying a second preset
directly to a sub-range of an existing list **restyles the entire list** — every
item became `*` in the measurement — because the paragraphs are still members of
it. Removing them first makes step 3 create a genuinely new list.

`deleteParagraphBullets` also clears the `indentStart` / `indentFirstLine` that
step 1 applied, so the intervening paragraphs are left exactly as they were. The
result is `1.` / `2.` / `3.` with the interleaved content between them, which is
what the native import renders and what issue #8 asks for.

This adds `deleteParagraphBullets` to `DocsRequest`, checked against
`docs_v1.Schema$Request` like every other member ([0015](0015-no-type-assertions.md)).

### 3. A run that starts anywhere but 1 stays literal text

`5.` `6.` `7.` as a contiguous list is `startNumber: 5` in a native import and
is **not expressible** through the API — step 2's trick reaches continuation,
not an arbitrary start. Rather than renumber it to 1 and lose the ordinal, such
a run is not bulleted at all: the literal `5. ` stays in the paragraph text.

This follows 0021 §3 — everything outside the subset has a mapping, and nothing
is refused — and it picks the failure that keeps the author's information over
the one that looks tidier. Silently renumbering is the failure mode that
produced issue #7 and issue #8 both.

The cost, stated plainly: this breaks 0021 §2's round-trip for one construct. A
natively-imported document whose list starts at 5 reads back as `5. …` and
parses to a paragraph, not a list. The Markdown round-trips; the Docs structure
does not. That is the honest limit of the API, and §2 is amended to say so
rather than to claim a contract we cannot keep.

`2)` is the same case by a different route. `glyphFormat: "%0)"` is not settable
either, and a run starting at `2` is already literal text by the rule above. A
run that starts at `1)` becomes an ordinary list rendered `1.`: what is lost is
the shape of the delimiter, not a number, and that is not worth a second
mechanism.

### 4. A table breaks the run, for now

The native import continues numbering across a table. We do not, in this
revision. A `createParagraphBullets` range that spans a table **bullets the
paragraphs inside its cells** — all four cells joined the list in the
measurement — and 0021 §5 writes tables in their own pass at a re-read cursor,
so the items on either side are not in one text run to begin with.

Excluding the cell paragraphs is possible (their indices are already read back
for cell fills) but it is a second mechanism for a document shape rarer than the
one §1 fixes. A run therefore ends at a table, and the run after it falls under
§3 — its numbers survive as literal text rather than restarting at 1.

### 5. `read` emits the real ordinal

`renderDocument` prints `1. ` for every ordered item. That hides the bug this
record fixes — the issue's reproduction is a `read` — and it makes §1's
continuation unverifiable from the CLI. It now computes the ordinal from the
item's position within its `listId` at its nesting level, offset by that level's
`startNumber`.

This changes `docs read` output for documents that already exist, which
[0014](0014-pre-1.0-compatibility.md) permits before 1.0. It is listed as
breaking in the release notes.

### 6. Autolinks and bare URLs both become links

Measured: the native import turns `<https://…>`, a bare `https://…`, and
`[text](url)` all into real links. CommonMark links the first and third and
leaves the second as text; 0021 §4 makes the native import the reference, so we
follow it and link all three.

- `<scheme:…>` is an autolink for any scheme, as CommonMark defines it.
- A bare URL is linked for `http` and `https` only. Those are what the measured
  import links in running text, and a wider rule starts guessing at things like
  a trailing `.` on a sentence.
- `HTML_LINE` no longer matches a line whose `<…>` is an autolink, which is what
  made `docs create` report `Kept as plain text: html` for a URL on its own line.

`--as text` is unaffected, as always.

## Out of scope (deferred)

- Nesting inside an intervening run. §2's sweep deletes every leading tab in its
  span, so by the time step 3 re-bullets a bulleted run between two numbered
  items, the tabs that told it the nesting level are gone and the sub-items come
  back flat. Restoring them means re-inserting the tabs before step 3 and
  letting that request consume them, which is index bookkeeping for a shape
  rarer than the one §1 fixes. Found while implementing this record, and pinned
  by a test so it is a known cost rather than a surprise.
- Numbering continued across a table (§4).
- `startNumber` and `glyphFormat` generally, unless the Docs API grows a request
  for them.
- Roman or lettered ordinals in the source (`a.`, `iv.`); CommonMark has no
  syntax for them and `read` does not emit them.
- The soft line break `read` emits as a raw `U+000B` — [issue #9], and
  [0024](0024-soft-line-breaks.md).

## Consequences

- `MarkdownBlock`'s `list` variant carries the item's number, so `parseMarkdown`
  stops reducing the marker to a boolean. `planTextRun`'s run detection grows
  from "contiguous same-kind items" to §1's rule, which means it inspects blocks
  it does not style.
- `DocsRequest` gains `deleteParagraphBullets`.
- `renderDocument` needs each list's `nestingLevels[].startNumber` and a counter
  per `(listId, nestingLevel)`; `lists` is already in `DocumentRaw`.
- The round-trip test that pins 0021 §2 gains the §3 exception explicitly, so
  the limit is recorded as a test rather than as prose someone can miss.
- `docs/commands.md` documents what happens to a list that does not start at 1,
  and mentions the `1\.` escape for a line that only looks like a list — the
  escape already works and is undocumented.

[issue #8]: https://github.com/ncukondo/gdrive-cli/issues/8
[issue #9]: https://github.com/ncukondo/gdrive-cli/issues/9
