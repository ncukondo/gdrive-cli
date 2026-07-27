# Task 0026: A soft line break round-trips as a `\` hard break

Status: done
Depends on: 0025 — same two files, and its round-trip test is the one this
extends. Landing them in the other order means merging the parser's block
dispatch twice.
Parallel: no — same files as 0025.

## Goal

`gdrive docs read` on a document containing a Shift+Enter line break prints a
CommonMark hard break instead of a raw `U+000B`, and writing that output back
reproduces the break.

## Context

- [issue #9](https://github.com/ncukondo/gdrive-cli/issues/9).
- Relevant decisions: `decisions/0024` (this change), `decisions/0021` §2 (the
  round-trip contract), §3 (nothing is refused), §4 (why the native import is
  usually the reference — and why 0024 §1 deviates from it here).
- Relevant docs: `docs/commands.md` §`gdrive docs read`.
- `insertText` accepts `U+000B` and produces a real break; measured for 0024, so
  no new request type is needed.
- The one-source-line-is-one-block premise in `markdown-doc.ts`'s header comment
  is deliberate and stays. A hard break is its single explicit exception
  (0024 §3) — update that comment, do not quietly contradict it.

## Scope

- `src/lib/markdown-doc.ts` + `markdown-doc.test.ts` — the continuation rule.
- `src/lib/docs-api.ts` + `docs-api.test.ts` — `U+000B` → `` \ `` in
  `renderDocument`.
- `docs/commands.md`.

## Out of scope

- `<br>` and any other HTML the native import maps to structure; it stays
  literal-and-reported per 0021 §3 (0024 §4).
- Breaks inside table cells, which `read` does not emit.
- The trailing double spaces Google's exporter adds to every line of
  `download --export-as md` output.

## TDD plan

1. **Red — render** (`docs-api.test.ts`)
   - a paragraph holding `a<VT>b` renders `a\` + newline + `b`;
   - two breaks in one paragraph render two;
   - a break inside a heading, a quote, and a list item renders the same way;
   - a paragraph with no break is byte-for-byte unchanged.
2. **Red — parse** (`markdown-doc.test.ts`)
   - a line ending in `\` joins the next line into one block with `U+000B`;
   - a line ending in two or more spaces does the same;
   - `a\\` (an escaped backslash at end of line) is a literal backslash and does
     **not** join — the existing escape rule wins;
   - a trailing break on the last line of the input is dropped, not left
     dangling;
   - a break inside a heading or list item stays within that block and does not
     turn the continuation into a new one;
   - a blank line still separates paragraphs, and a bare newline still does not
     join (the 0021 premise is intact).
3. **Red — round-trip** — extend the 0021 §2 test with a document whose
   paragraph holds an internal break, and one whose heading does.
4. **Green** — implement; the continuation runs ahead of the block dispatch so
   every span-shaped block inherits it.
5. **Refactor** — the continuation is one function that yields logical lines, so
   the block loop keeps reading "one line, one block" and does not grow a second
   notion of where a block ends.

## Acceptance criteria

- [x] `docs read` never emits a raw `U+000B`
- [x] Both hard-break spellings parse; an escaped backslash still does not
- [x] A document with an internal break survives `read` → write → `read`
- [x] The blank-line and bare-newline behavior of 0021 is unchanged, pinned by
      tests that were already there
- [x] `markdown-doc.ts`'s header comment states the exception
- [x] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [x] `docs/commands.md` documents how a break is written and read

## Outcome notes

- **The join needed a guard the decision did not name.** 0024 §2 says a line
  ending in two spaces joins the next one, and that is CommonMark — but trailing
  whitespace is invisible and routinely left behind, so `- a  ` followed by
  `- b` would have silently fused two list items into one. The continuation now
  stops at any line that opens a block of its own. This is the same property
  §1 used to argue *against* the double-space spelling on output; it applies to
  input too, and the guard is what makes accepting both spellings safe.
- **Rendering drops trailing spaces**, for the mirror-image reason: a Docs
  paragraph ending in two spaces would otherwise read back as a break nobody
  wrote. Not in 0024, and the same argument.
- Plain-text output converts `U+000B` to a newline. 0024 is written about
  Markdown, but `--as text` had the identical defect and it is one line.
- The continuation runs *after* the branches that consume raw lines themselves —
  fences, indented code, table rows — rather than as a pre-pass over all lines,
  so a trailing backslash inside a code block stays content. The task said
  "ahead of the block dispatch"; that would have been wrong.
- A break inside a styled run moves out of the emphasis and comes back attached
  to the preceding plain span. The renderer already keeps whitespace outside the
  markers and treats `U+000B` as whitespace. A break carries no styling either
  way, so the document reads the same; the round-trip test records which span
  ends up owning it.

## Verification

- `bun run test:unit` — 542 passed; `typecheck`, `lint`, `lint:casts`,
  `format:check` clean.
- **Manual, against a real account** — a document written from three lines
  joined by backslashes came back as *one* paragraph holding two `U+000B`
  breaks, with a blank-line-separated paragraph still separate and a heading
  keeping its own break, all confirmed from the raw `documents.get` response.
  `docs read` printed backslash hard breaks and no control character; written to
  a second document and read again, the output is byte-identical. Both were
  trashed.
