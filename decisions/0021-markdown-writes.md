# 0021: `--as markdown` writes Markdown structure into a document

Date: 2026-07-27
Status: accepted — extends [0009](0009-docs-commands.md)

## Context

`docs read` renders a document as Markdown. Every write command inserts its
argument as literal text, so what `read` just showed you cannot be written back
([issue #7]). A 6×4 table drafted in Markdown and inserted with `docs replace`
arrives in `word/document.xml` as one `<w:t>` holding
`| 枠 | 企画名 | 部署 | 担当 |`; the same table pasted through a browser's
`text/html` clipboard arrives as a real `<w:tbl>`. Both were observed in the
same document.

0009 called this out as deferred ("rich round-trip Markdown → Docs structure
beyond best-effort `read`"), and the docs say so. It is still the difference
between writing a document and writing a paragraph: the workaround is to keep
driving a real browser for the one step of a task whose every other step is a
single `gdrive` call.

## Decision

### 1. `--as <markdown|text>` on every write, defaulting to `text`

```sh
gdrive docs create <title> --content @draft.md --as markdown
gdrive docs append <file> @draft.md --as markdown
gdrive docs insert <file> @draft.md --at start --as markdown
gdrive docs replace <file> --find "<marker>" --replace @draft.md --as markdown
```

The flag is the write-side spelling of `read --as markdown` and takes the same
two values. Its **default is the opposite of `read`'s** — `read` defaults to
`markdown`, writes default to `text` — because a default that reinterprets
`| a | b |` in an existing script is a silent change to what a command writes
into someone's document. 0014 permits the breaking change; this is a case where
not taking it costs one flag and buys certainty.

### 2. The supported subset is exactly what `read` emits

Headings (`#`…`######`), `**bold**`, `*italic*`, `[text](url)`, bulleted and
numbered lists with two-space nesting, and pipe tables — the set
`renderDocument` produces (0009). The contract is round-trip:
**anything `docs read --as markdown` prints must parse back to the structure it
came from**, and that is pinned by a test, not by prose.

This is why the parser is ours rather than a CommonMark dependency. A general
parser would hand back an AST for a much larger language than Docs can express,
and the mapping layer — AST to `batchUpdate` requests — is the whole job either
way. What we would gain is fidelity on constructs we reject anyway.

### 3. Unrecognized *blocks* are an error; unrecognized *inline* text is text

A fenced code block, an image, a block quote, or raw HTML is `INVALID_ARGS`
naming the construct and its line number. Inserting them as literal text is the
exact failure this record exists to fix, and doing it under a flag that promises
structure is worse than refusing. Plain text mode remains one word away.

Inline sequences we do not recognize (backticks, `~~`, footnote markers) stay
literal. They carry decoration, not structure, and a parser treating an
unmatched `*` as an error would fail on ordinary prose.

### 4. Requests are built text-first, and tables force a re-read

Indices inside a `batchUpdate` refer to the document *as of the preceding
request*, so a naive request-per-element list is wrong the moment anything
before it grows.

- **No table in the payload** — one `insertText` places the whole rendered text
  at the anchor, then `updateParagraphStyle` / `updateTextStyle` /
  `createParagraphBullets` apply over ranges computed from that text. The
  offsets are known before the call, and one round trip does it.
- **A table in the payload** — the payload splits at table boundaries. One
  `batchUpdate` inserts the text segments and the `insertTable`s; then
  `documents.get` reads back the cells' real indices; then a second
  `batchUpdate` fills the cells and applies styles, emitting its requests in
  **descending index order** so no request shifts a later one's target.

The re-read is deliberate. A table's internal index geometry is derivable from
the row/column counts, but it is a detail of Docs' model rather than a
documented contract, and a wrong guess writes cell text into the wrong cell —
a failure that looks like success. Two extra round trips for a table is a price
worth paying; documents without tables pay nothing.

### 5. `replace --as markdown` deletes the marker and inserts at its index

`replaceAllText` substitutes text for text and cannot produce structure, so the
markdown path takes a different route: find the marker's ranges in the body,
then for each occurrence **from the last to the first** `deleteContentRange`
followed by the structured insert at that index. Descending order for the same
reason as §4 — an earlier edit must not move a later target.

The search runs over paragraph runs only. A marker inside a table cell is not
matched, because the replacement may itself contain a table and Docs cannot
nest one. `--match-case` keeps its meaning; the reported `replaced` count keeps
counting occurrences, so the JSON shape is unchanged.

This keeps working the pattern that `replace` is currently the only way to do —
insert at a marker without computing a character index — which is what issue #7
reports people actually doing.

## Out of scope (deferred)

- Images (`insertInlineImage`), code blocks as a Docs style, block quotes,
  horizontal rules, nested or merged table cells, column widths.
- Reading structure that `read` does not emit (comments, suggestions, headers
  and footers), and any `--lenient` mode that flattens §3's rejected blocks
  instead of refusing them. Add it if refusing proves to be the annoyance.
- A Markdown path for `sheets`.

## Consequences

- A new `src/lib/markdown-doc.ts` owns parse (Markdown → block model) and
  build (block model → `DocsRequest[]`). `lib/docs-api.ts` keeps the port and
  the renderer; the two sit either side of the same block vocabulary, and the
  round-trip test in §2 is what keeps them honest.
- `DocsRequest` grows `insertTable`, `updateTextStyle`, `updateParagraphStyle`,
  `createParagraphBullets`, and `deleteContentRange`. Each is checked against
  `docs_v1.Schema$Request` under [0015](0015-no-type-assertions.md), like every
  other member.
- The Docs fake in `tests/helpers/` gains a `documents.get` that answers with
  the state a preceding `batchUpdate` would have produced, which is what §4's
  second phase reads.
- 0009's table row ("Edits are applied via … insertText / replaceAllText") is
  extended, not replaced: the `text` default takes exactly the path it always
  did.
- `docs/commands.md` drops "Content is inserted as plain text" from `create`
  and documents the flag on all four commands; `README.md` gains a line.

[issue #7]: https://github.com/ncukondo/gdrive-cli/issues/7
