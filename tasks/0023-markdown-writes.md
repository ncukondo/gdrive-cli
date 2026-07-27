# Task 0023: `--as markdown` writes Markdown structure into a document

Status: todo
Depends on: — (decision `0021` is written; nothing else is in flight)
Parallel: no — one owner for `src/lib/markdown-doc.ts` and all four
`src/commands/docs/*` write commands.

## Goal

`gdrive docs append <doc> @draft.md --as markdown` puts a real table, real
headings, and real hyperlinks into the document — the same structure
`gdrive docs read --as markdown` would print back. Without the flag every write
command behaves exactly as it does today.

## Context

- [issue #7](https://github.com/ncukondo/gdrive-cli/issues/7).
- Relevant decisions: `decisions/0021` (this change), `decisions/0009` (the
  docs commands and the renderer whose output defines the subset),
  `decisions/0015` (no type assertions; `DocsRequest` vs `docs_v1.Schema$Request`),
  `decisions/0012` (fakes, no network), `decisions/0014` (pre-1.0 changes).
- Relevant docs: `docs/commands.md` §Docs, `README.md`.
- The renderer to mirror is `renderDocument` in `src/lib/docs-api.ts`:
  `paragraphPrefix` (headings, bullets), `styleRun` (bold/italic/link),
  `markdownTable`. Parse must invert exactly these.

## Scope

- `src/lib/markdown-doc.ts` (new) — Markdown → block model → `DocsRequest[]`.
- `src/lib/markdown-doc.test.ts` (new).
- `src/lib/docs-api.ts` — the `DocsRequest` union grows; new wrapper ops for
  the two-phase table path and for `deleteContentRange`.
- `src/lib/google-clients.ts` — `GeneratedParamChecks` entries for the new
  request members.
- `src/commands/docs/{create,append,insert,replace}.ts` + their tests + the
  `--as` wiring in `src/commands/docs/index.ts`.
- `tests/helpers/` — the Docs fake gains a `documents.get` that reflects a
  preceding `batchUpdate`.
- `decisions/README.md` (index row), `docs/commands.md`, `README.md`.

## Out of scope

- Everything in `decisions/0021` §"Out of scope": images, code blocks, block
  quotes, rules, merged cells, a `--lenient` mode, Markdown for `sheets`.
- Changing any default: `read` stays `markdown`, writes stay `text`.

## TDD plan

Five sub-features; commit at each green point.

1. **Parser — blocks** (`markdown-doc.test.ts`)
   1. **Red** — headings `#`…`######`; paragraphs; `-` and `1.` lists with
      two-space nesting; pipe tables including the `| --- |` separator row.
      Error cases: a fenced block, an image, a block quote, and raw HTML each
      raise `INVALID_ARGS` naming the construct **and its line number**.
   2. **Green** — a line-oriented block parser producing the block model.
   3. **Refactor** — one function per block kind; no regex soup in the loop.

2. **Parser — inline**
   1. **Red** — `**bold**`, `*italic*`, `[text](url)`, and the combinations the
      renderer emits (`[**bold link**](url)`); unrecognized inline
      (`` `code` ``, `~~x~~`, a lone `*`) survives as literal text.
   2. **Green/Refactor** — as above.

3. **Round-trip contract** (decision 0021 §2) — the test that pins the pair
   1. **Red** — for each fixture `DocumentRaw`, `parse(renderDocument(doc))`
      equals the block model the document describes. Cover at least: a heading
      + styled paragraph, a nested mixed list, and a table with inline styles
      in cells.
   2. **Green** — fix whichever side is wrong (the renderer may need a nudge;
      `read`'s output is the contract, not its implementation).

4. **Request builder**
   1. **Red** — no-table payload → exactly one `insertText` followed by style
      requests whose ranges are computed from the inserted text (assert on the
      request array, not on a fake's final state). Table payload → phase 1
      requests, then a `documents.get`, then phase-2 cell fills asserted to be
      in **descending index order**. An anchor index other than 1 offsets every
      range.
   2. **Green** — implement the two paths from decision 0021 §4.
   3. **Refactor** — one builder, one entry point; the phase split lives in the
      caller, not in the parser.

5. **Commands**
   1. **Red** — per command: `--as markdown` routes to the builder,
      `--as text` and the absent flag take today's path byte for byte (existing
      tests must not change), an invalid `--as` value is `INVALID_ARGS`
      listing the valid ones. For `replace`: occurrences are edited last-first,
      each as `deleteContentRange` + structured insert; a marker inside a table
      cell is not matched; `replaced` still counts occurrences and the JSON
      shape is unchanged; `--match-case` still applies.
   2. **Green** — wire `--as` through `index.ts` for all four.
   3. **Refactor** — the four commands share one "insert this payload here"
      helper rather than four copies of the phase logic.

## Acceptance criteria

- [ ] A Markdown table in `@draft.md` arrives as a Docs table — verified by
      exporting `.docx` and finding `<w:tbl>`, the comparison issue #7 makes
- [ ] Headings, bold/italic, links, and nested ordered/unordered lists arrive
      as Docs structure, not as their Markdown source
- [ ] `docs read --as markdown` of a document written this way reproduces the
      input (the §3 contract, end to end)
- [ ] Without `--as markdown` every write command is unchanged
- [ ] A fenced code block / image / block quote / raw HTML is `INVALID_ARGS`
      naming the construct and line
- [ ] `replace --as markdown` inserts at a marker and reports the same count
- [ ] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [ ] `docs/commands.md` (all four commands, and the `create` plain-text
      sentence removed), `README.md`, `decisions/README.md` updated

## Verification

- `bun run test src/lib/markdown-doc.test.ts` — parser, builder, round trip.
- `bun run test src/commands/docs` — flag routing and the unchanged default.
- **Manual, against a real account** (the only check that proves §4's index
  math): write the issue's 6×4 table with each of `create` / `append` /
  `insert` / `replace`, then `gdrive download --export-as docx` and confirm `<w:tbl>`
  in `word/document.xml`. Also confirm a link is a hyperlink, not raw text.
