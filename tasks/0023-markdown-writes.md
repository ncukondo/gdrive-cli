# Task 0023: `docs` writes take Markdown by default

Status: todo
Depends on: — (decision `0021` is written; nothing else is in flight)
Parallel: no — one owner for `src/lib/markdown-doc.ts` and all four
`src/commands/docs/*` write commands.

## Goal

`gdrive docs append <doc> @draft.md` puts a real table, real headings, and real
hyperlinks into the document — the same structure `gdrive docs read` would print
back. `--as text` still writes the exact bytes it always did.

## Context

- [issue #7](https://github.com/ncukondo/gdrive-cli/issues/7).
- Relevant decisions: `decisions/0021` (this change — note §1 flips a default
  and §3 refuses nothing), `decisions/0009` (the docs commands and the renderer
  whose output defines the round-trip subset), `decisions/0014` (why the
  breaking change is allowed), `decisions/0015` (no type assertions;
  `DocsRequest` vs `docs_v1.Schema$Request`), `decisions/0012` (fakes, no
  network).
- Relevant docs: `docs/commands.md` §Docs, `README.md`.
- The renderer to mirror is `renderDocument` in `src/lib/docs-api.ts`:
  `paragraphPrefix` (headings, bullets), `styleRun` (bold/italic/link),
  `markdownTable`. Parse must invert exactly these.
- **This is a breaking change.** Existing command tests assert the plain-text
  path on the default; they change, and the change is the point. Say so in the
  release notes.

## Scope

- `src/lib/markdown-doc.ts` (new) — Markdown → block model → `DocsRequest[]`.
- `src/lib/markdown-doc.test.ts` (new).
- `src/lib/docs-api.ts` — the `DocsRequest` union grows; new wrapper ops for
  the two-phase table path, `deleteContentRange`, and the marker search.
- `src/lib/google-clients.ts` — `GeneratedParamChecks` entries for the new
  request members.
- `src/commands/docs/{create,append,insert,replace}.ts` + their tests + the
  `--as` wiring in `src/commands/docs/index.ts`.
- `tests/helpers/` — the Docs fake gains a `documents.get` that reflects a
  preceding `batchUpdate`.
- `decisions/README.md` (index row), `docs/commands.md`, `README.md`.

## Out of scope

- Everything in `decisions/0021` §"Out of scope": real images, merged cells,
  column widths, Markdown for `sheets`.
- `insert --before/--after` — task 0024, decision 0022.
- `read`'s default, which is already `markdown`.

## TDD plan

Six sub-features; commit at each green point.

1. **Parser — blocks** (`markdown-doc.test.ts`)
   1. **Red** — headings `#`…`######`; paragraphs; `-` and `1.` lists with
      two-space nesting; pipe tables including the `| --- |` separator row.
   2. **Green** — a line-oriented block parser producing the block model.
   3. **Refactor** — one function per block kind; no regex soup in the loop.

2. **Parser — inline**
   1. **Red** — `**bold**`, `*italic*`, `[text](url)`, and the combinations the
      renderer emits (`[**bold link**](url)`); an unmatched `*`, a stray `[`,
      and `~~x~~` survive as literal text.
   2. **Green/Refactor** — as above.

3. **Nothing is refused** (decision 0021 §3–§4)
   1. **Red** — a fenced block and inline `` `code` `` map to Courier New; a
      block quote maps to an indented paragraph; a horizontal rule is dropped;
      an image and a raw HTML block stay literal **and** are reported in
      `unsupported: [{line, kind}]`, with one stderr line in text mode and
      nothing extra on stdout.
   2. **Green** — no parse path throws; the reporting channel is a return
      value, not a side effect in the parser.

4. **Round-trip contract** (decision 0021 §2) — the test that pins the pair
   1. **Red** — for each fixture `DocumentRaw`, `parse(renderDocument(doc))`
      equals the block model the document describes. Cover at least: a heading
      + styled paragraph, a nested mixed list, and a table with inline styles
      in cells.
   2. **Green** — fix whichever side is wrong (`read`'s output is the contract,
      not its implementation).

5. **Request builder**
   1. **Red** — no-table payload → exactly one `insertText` followed by style
      requests whose ranges are computed from the inserted text (assert on the
      request array, not on a fake's final state). Table payload → phase 1
      requests, then a `documents.get`, then phase-2 cell fills asserted to be
      in **descending index order**. An anchor index other than 1 offsets every
      range.
   2. **Green** — implement the two paths from decision 0021 §5.
   3. **Refactor** — one builder, one entry point; the phase split lives in the
      caller, not in the parser.

6. **Commands — the default flips**
   1. **Red** — per command: no flag and `--as markdown` route to the builder;
      `--as text` reproduces today's request byte for byte (the existing
      assertions move under that flag); an invalid `--as` value is
      `INVALID_ARGS` listing the valid ones. For `replace`: the Markdown path
      edits occurrences last-first as `deleteContentRange` + structured insert,
      a marker inside a table cell is not matched, `replaced` still counts
      occurrences, and `--as text` still calls `replaceAllText` once.
   2. **Green** — wire `--as` through `index.ts` for all four.
   3. **Refactor** — the four commands share one "insert this payload here"
      helper rather than four copies of the phase logic.

## Acceptance criteria

- [ ] `docs append <doc> @draft.md` — no flag — puts a Markdown table into the
      document as a Docs table, verified by exporting `.docx` and finding
      `<w:tbl>`, the comparison issue #7 makes
- [ ] Headings, bold/italic, links, and nested ordered/unordered lists arrive
      as Docs structure, not as their Markdown source
- [ ] `gdrive docs read A | gdrive docs append B -` preserves structure
- [ ] `--as text` writes the exact bytes, unchanged from today
- [ ] No input is rejected: fences, quotes, rules, images, and raw HTML each
      land per decision 0021 §3, with images and HTML reported in `unsupported`
- [ ] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [ ] `docs/commands.md` (all four commands, the `create` plain-text sentence
      removed, and which inputs want `--as text`), `README.md`,
      `decisions/README.md` updated, and the breaking change in the release notes

## Verification

- `bun run test src/lib/markdown-doc.test.ts` — parser, mappings, builder,
  round trip.
- `bun run test src/commands/docs` — the flipped default and `--as text`.
- **Manual, against a real account** (the only check that proves §5's index
  math): write the issue's 6×4 table with each of `create` / `append` /
  `insert` / `replace`, then `gdrive download --export-as docx` and confirm
  `<w:tbl>` in `word/document.xml`. Also confirm a link is a hyperlink, not raw
  text, and that a fenced block came out monospace.
- Compare one converted document against a native import of the same source
  (upload `draft.md` to Drive as a Doc) — decision 0021 §4 makes that the
  reference.
