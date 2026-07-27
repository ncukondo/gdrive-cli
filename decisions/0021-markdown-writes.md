# 0021: Markdown is the document format on both sides of `gdrive docs`

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

0009 deferred this ("rich round-trip Markdown → Docs structure beyond
best-effort `read`") and the docs say so, but documenting an asymmetry does not
stop anyone hitting it — issue #7 *is* someone hitting it after reading the
docs. It is the difference between writing a document and writing a paragraph:
the workaround is to keep driving a real browser for the one step of a task
whose every other step is a single `gdrive` call.

## Decision

### 1. Writes read Markdown by default; `--as text` is the literal mode

```sh
gdrive docs create <title> --content @draft.md
gdrive docs append <file> @draft.md
gdrive docs insert <file> @draft.md --at start
gdrive docs replace <file> --find "<marker>" --replace @draft.md

gdrive docs append <file> @server.log --as text   # exact bytes, no parsing
```

`--as <markdown|text>` lands on all four write commands with the same default
as `read`. The alternative — keeping `text` as the write default and making
Markdown opt-in — was rejected: a flag only helps the people who already know
the problem exists, and this is a problem you discover by silently damaging a
document. Symmetry is what makes the CLI explainable in one sentence: **this
tool's document format is Markdown, in both directions.** It also makes the
obvious pipe do the obvious thing.

```console
$ gdrive docs read A | gdrive docs append B -    # structure survives
```

This is a breaking change to what `create --content`, `append`, `insert`, and
`replace` write. [0014](0014-pre-1.0-compatibility.md) permits it before 1.0,
and the cost of not taking it now is that the asymmetry becomes permanent.

The consequence to accept: text that was never meant as Markdown is now
reinterpreted — a line starting `# `, `- `, or `1. ` becomes a heading or a list
item. `--as text` is the answer, and it is what logs, code, and any
machine-generated payload should use. The docs say so next to the flag.

### 2. The round-trip subset is exactly what `read` emits

Headings (`#`…`######`), `**bold**`, `*italic*`, `[text](url)`, bulleted and
numbered lists with two-space nesting, and pipe tables — the set
`renderDocument` produces (0009). The contract is round-trip:
**anything `docs read --as markdown` prints must parse back to the structure it
came from**, and that is pinned by a test, not by prose.

This is why the parser is ours rather than a CommonMark dependency. A general
parser would hand back an AST for a much larger language than Docs can express,
and the mapping layer — AST to `batchUpdate` requests — is the whole job either
way.

### 3. Nothing is refused: everything outside the subset has a mapping

An earlier draft of this record made a fenced block or a block quote an
`INVALID_ARGS` error. That is defensible for an opt-in flag and indefensible
for a default: `cat notes.txt | gdrive docs append doc -` would fail because the
file happens to contain ``` or a `>` line, which is the worst possible behavior
for a CLI built for agents.

So the parser accepts everything and maps it:

| Markdown | Docs |
|----------|------|
| Fenced / indented code block, inline `` `code` `` | Courier New paragraph / character style |
| Block quote | paragraph with `indentStart` |
| Horizontal rule | dropped |
| Image, raw HTML block | kept as its literal source text |
| Unmatched `*`, `~~`, stray `[` | literal text, as in any parser |

The two that stay literal are reported rather than hidden: JSON output gains
`"unsupported": [{ "line": 12, "kind": "image" }]`, and text output prints one
line to stderr. Silence is what caused issue #7; a note costs nothing and stdout
stays clean for pipes.

### 4. The mapping follows Google's own `text/markdown` import

Drive converts an uploaded `text/markdown` file to a Doc natively. We do not
use that path — it replaces a whole document and cannot insert at a position —
but we adopt its **result** as the reference for what each construct should look
like. Where our output and a native import of the same source disagree, ours is
the bug. That settles §3's mapping table by appeal to an existing contract
instead of to taste, and it means a document written by this CLI is
indistinguishable from one imported by hand.

### 5. Requests are built text-first, and tables force a re-read

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

### 6. `replace` deletes the marker and inserts structure at its index

`replaceAllText` substitutes text for text and cannot produce structure, so the
Markdown path takes a different route: find the marker's ranges in the body,
then for each occurrence **from the last to the first** `deleteContentRange`
followed by the structured insert at that index. Descending order for the same
reason as §5 — an earlier edit must not move a later target. `--as text` keeps
using `replaceAllText` unchanged.

The search runs over paragraph runs only. A marker inside a table cell is not
matched, because the replacement may itself contain a table and Docs cannot
nest one. `--match-case` keeps its meaning; the reported `replaced` count keeps
counting occurrences, so the JSON shape is unchanged apart from §3's optional
`unsupported`.

## Out of scope (deferred)

- Images as real images (`insertInlineImage` needs an upload path), nested or
  merged table cells, column widths, footnotes.
- Reading structure that `read` does not emit (comments, suggestions, headers
  and footers).
- Marker-relative positioning for `insert` — see [0022](0022-insert-at-marker.md).
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
  the state a preceding `batchUpdate` would have produced, which is what §5's
  second phase reads.
- Every write costs one parse it did not before, and the `--as text` path stays
  byte-for-byte what it was — the old behavior is still reachable, just no
  longer the default.
- `docs/commands.md` drops "Content is inserted as plain text" from `create`,
  documents `--as` on all four write commands, and says plainly which inputs
  want `--as text`. `README.md` gains a line. The change is listed as breaking
  in the release notes.

[issue #7]: https://github.com/ncukondo/gdrive-cli/issues/7
