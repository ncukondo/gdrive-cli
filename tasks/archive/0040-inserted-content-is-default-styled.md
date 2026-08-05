# Task 0040: An insert stops inheriting the formatting next to it

Status: done — PR [#20](https://github.com/ncukondo/gdrive-cli/pull/20), merged
2026-08-05, after two review rounds.
Depends on: — (0023, 0025 and 0026 built what this changes; all are archived)
Parallel: no — it owns `src/lib/markdown-doc.ts` and `src/lib/docs-api.ts`,
which every `docs` write command goes through.

## Goal

Text written by `docs insert`, `append`, `replace` and `create --content`
arrives in the document's own default style. Appending after a `Heading 1` no
longer produces a heading; inserting into a bulleted list no longer produces a
bullet; inserting after 20pt red bold text no longer produces 20pt red bold
text.

## Context

- Decision: [`0045`](../decisions/0045-inserted-content-is-default-styled.md) is
  the specification. §1 is the character reset, §2 which paragraphs may be
  reset and why the merged-into one may not, §3 `--as text`, §4 where it is
  asserted.
- [`0021`](../decisions/0021-markdown-writes.md) §4 is the contract this meets —
  the native `text/markdown` import is the reference result — and §5 is the
  request-ordering discipline the reset must not break: indices are read against
  the document as of the preceding request, and `createParagraphBullets` deletes
  the leading tabs, which moves everything after them.
- Where the current behaviour comes from, all in `src/lib/markdown-doc.ts`
  unless stated: `textStyleOf` returns `null` for an unstyled span; `fields`
  names only what is set and is exactly what Docs resets; `paragraphRequests`
  is empty for a paragraph, a code block and a list item; no
  `deleteParagraphBullets` is emitted for a non-list block; and `insertText` in
  `src/lib/docs-api.ts` sends the insert alone.
- The fakes cannot show inheritance — it is the API's behaviour, not the request
  array's ([`0043`](../decisions/0043-e2e-runs-before-push.md), and 0021 §5 for
  the same failure on the write side). Plan the live assertions with the unit
  tests, not after them.

## Scope

- `src/lib/markdown-doc.ts` — the two field masks, the reset requests, and
  `planTextRun` learning whether its first paragraph is its own.
- `src/lib/docs-api.ts` — a paragraph-boundary reader, the reset on the
  `--as text` path, and the boundary threaded through `insertMarkdown` and
  `replaceMarkdown`.
- `src/commands/docs/{insert,append,create}.ts` and `src/commands/docs/index.ts`
  — each write command supplies the boundary from the document it already read.
- `tests/e2e/docs.test.ts` — the live assertions of 0045 §4.
- `docs/commands.md`, `CHANGELOG.md`.

## What the first review round changed

Round one of [#20](https://github.com/ncukondo/gdrive-cli/pull/20) found three
things, recorded here rather than annotated later
([`0041`](../decisions/0041-the-task-is-current-during-review.md)):

1. **Every range is measured in characters, and `insertText` drops some of the
   characters it is handed** — U+0000-U+0008, U+000C-U+001F and the private use
   area — so a payload carrying any of them shifted every range past what it
   named and into the text after it. A CRLF log through `--as text` is the
   realistic case. Both entry points now send what they measured
   (`asDocsStoresIt`, applied in `parseMarkdown` and in `insertText`), which is
   the whole class: those two are where text enters the request builders.
2. **`replace --as text` cannot reset what it wrote.** `replaceAllText`
   substitutes without reporting where, and it reaches headers, footers and
   footnotes that `findMarkerRanges` does not.
   [`0046`](../decisions/0046-replace-as-text-keeps-its-reach.md) keeps the
   reach and names the exception; `docs/commands.md` and `CHANGELOG.md` say so,
   and a test pins it. Issue
   [#21](https://github.com/ncukondo/gdrive-cli/issues/21) is what would close
   it.
3. **The live "append after a heading" assertion cannot fail.** A document this
   CLI builds always ends in the empty `NORMAL_TEXT` paragraph
   `documents.create` gave it, so `append` never splits a styled paragraph. The
   test says so above itself and the case it was meant to cover stays in the
   manual list below, where the manual pass did exercise it.

Round two found nothing severe and asked for one thing: 0046 rests on
`replaceAllText` reaching segments the marker walk does not, and that was
written as fact without being measured. It is measured now — see `Verification`.

## Out of scope

- **Resetting a paragraph the insert merged into.** 0045 §2 rules it out by
  design; it will not be done.
- **Resetting what `replace --as text` wrote.** 0046; issue
  [#21](https://github.com/ncukondo/gdrive-cli/issues/21) tracks the work that
  would make it possible.
- **`--inherit-style`.** 0045's Out of scope: no issue, will not be done unless
  someone reports needing it.
- **The `read` side.** Nothing about rendering changes.

## TDD plan

1. **Red — the character reset (`markdown-doc.test.ts`)**
   - `planTextRun` emits one `updateTextStyle` covering the whole inserted text,
     with an empty `textStyle` and the eleven-field mask, *before* any per-span
     request.
   - A `**bold**` span still gets its own `updateTextStyle` after the reset, so
     bold survives and everything else does not.
   - A code block still gets Courier New after the reset.
   - Table cell fills reset the text they write (`planCellFills`).
2. **Green** — the mask constant and the reset request.
3. **Red — the paragraph reset (`markdown-doc.test.ts`)**
   - With `firstParagraphIsNew`, one `deleteParagraphBullets` and one
     `updateParagraphStyle` span every inserted paragraph, ahead of the
     per-block requests, so a heading and a quote still land. The style names
     `NORMAL_TEXT` rather than clearing the field: the live suite's first run
     answered `Named style property is not inherited and cannot be cleared`,
     so the default has to be said out loud.
   - Without it, the span starts at the second block's paragraph; with a single
     block, neither request is emitted at all.
   - A list run still gets its `createParagraphBullets` after the blanket
     delete, and its nesting still reads back from the tabs.
4. **Green.**
5. **Red — the boundary (`docs-api.test.ts`)**
   - `insertText` sends the reset for the range it wrote, and resets paragraphs
     only where the payload's own newlines bound them or the boundary says the
     index did.
   - `insertMarkdown` passes `firstParagraphIsNew` for a segment after a table.
   - `replaceMarkdown` reads the boundary at the marker's own start and end.
6. **Green.**
7. **Red — the commands (`insert.test.ts`, `append.test.ts`, `create.test.ts`)**
   — each passes the boundary it read; `create` inserts into an empty document
   and says so.
8. **Green. Refactor** — one builder shared by both write paths; no second
   round trip anywhere.

## Acceptance criteria

- [x] `docs append` after a heading writes body text, not a heading
- [x] `docs insert` into a bulleted list writes an unbulleted paragraph
- [x] `docs insert` after bold / coloured / resized text writes default text
- [x] `--as text` behaves the same as the Markdown path, except `replace`
      (0045 §3 as corrected by [`0046`](../decisions/0046-replace-as-text-keeps-its-reach.md))
- [x] A payload carrying characters Docs drops still lands with correct ranges
- [x] `insert --after` pointing into the middle of a paragraph leaves that
      paragraph's own style alone (0045 §2)
- [x] Headings, quotes, lists, nesting, links and tables still land as before
- [x] No write costs an extra round trip
- [x] `bun run test` and `bun run typecheck` pass
- [x] `docs/commands.md` and `CHANGELOG.md` updated

## Verification

Two lists, kept apart so that "the automated one passed" cannot stand in for the
part it never ran ([`0043`](../decisions/0043-e2e-runs-before-push.md) §4).

- Automated: `bun run test src/lib/markdown-doc.test.ts src/lib/docs-api.test.ts
  src/commands/docs` — the request arrays and the boundary logic.
  `bun run test:e2e` — appending after a heading, inserting into a list, and
  inserting after bold text, each read back through `docs read` (0045 §4).
- Measured, against a real account, because
  [`0046`](../decisions/0046-replace-as-text-keeps-its-reach.md) rests on it: a
  document with a `MARK` in a header, a footer and a footnote, put through
  `docs replace --find MARK --replace GONE --as text`, answers
  `"replaced": 3` and comes back with all three substituted. So the reach that
  record keeps is real, and routing that path through `findMarkerRanges` would
  have lost it.
- Manual, against a real account: font family, size and colour, which `docs read`
  cannot see — and the `append` case the live suite cannot reach at all, since a
  document built by this CLI always ends in an unstyled paragraph. In a document whose body is 20pt red Courier, run
  `docs append`, `docs insert --after`, and `docs replace`, then look at the
  result in the browser: the new text is the document's default, and the
  paragraph an `--after` insert landed inside keeps its own style.
