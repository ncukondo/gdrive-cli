# Task 0025: Ordered lists keep their numbering, and links are links

Status: todo
Depends on: 0023 — this changes the parser and request builder that task created.
Parallel: no — same files as 0026, which must land after it.

## Goal

A Markdown document whose sections are numbered `1.` through `12.`, each
followed by the paragraphs belonging to it, comes back numbered `1.` through
`12.` rather than `1.` twelve times; and `<https://…>` arrives as a link rather
than as literal text with the angle brackets showing.

## Context

- [issue #8](https://github.com/ncukondo/gdrive-cli/issues/8).
- Relevant decisions: `decisions/0023` (this change), `decisions/0021` §2
  (the round-trip contract this amends), §3 (nothing is refused), §4 (the
  native import is the reference), §5 (why requests are built text-first).
- Relevant docs: `docs/commands.md` §`gdrive docs`.
- The measurements behind 0023 are in the decision itself; they were taken
  against a real account and the probe documents were trashed. Re-measuring is
  not part of this task.
- The three-step bullet technique in 0023 §2 is the load-bearing part. Step 3
  cannot replace step 2: applying a second preset to a sub-range of an existing
  list restyles the whole list.

## Scope

- `src/lib/markdown-doc.ts` + `markdown-doc.test.ts` — the number on a list
  block, run detection across intervening blocks, the three-step requests,
  autolinks and bare URLs.
- `src/lib/docs-api.ts` + `docs-api.test.ts` — `deleteParagraphBullets` on
  `DocsRequest`, and the real ordinal in `renderDocument`.
- `src/commands/docs/*.test.ts` — only where an expectation encodes `1. `.
- `decisions/README.md` (done), `docs/commands.md`.

## Out of scope

- Numbering continued across a table (0023 §4); a run ends at a table and the
  next run falls under §3.
- `startNumber` / `glyphFormat`, which no request can set (0023 §3).
- The `U+000B` soft line break — task 0026, decision 0024.

## TDD plan

1. **Red — parse** (`markdown-doc.test.ts`)
   - a list item keeps its literal number, so `1.` and `2.` are distinguishable;
   - `1.` / paragraph / `2.` / paragraph / `3.` is one run; the intervening
     paragraphs are not list items;
   - a heading, a quote, and a code block between items also continue the run;
   - a bulleted list between items continues the numbered run *and* stays its
     own bulleted list;
   - `1.` / paragraph / `1.` is two runs (the restart splits);
   - a run starting at `5.` is not a list: the blocks are paragraphs whose text
     still begins `5. `;
   - `2)` likewise stays literal; `1)` becomes an ordinary list;
   - a table between items ends the run (0023 §4).
2. **Red — requests**
   - a run with intervening blocks emits `createParagraphBullets` over the whole
     span, then `deleteParagraphBullets` per intervening run, then
     `createParagraphBullets` per intervening *list* run — in that order;
   - the cursor advance still accounts for the tabs `createParagraphBullets`
     deletes (0021 §5).
3. **Red — inline**
   - `<https://…>` on its own line is a link, and no longer reports
     `unsupported: html`;
   - `<https://…>` mid-line is a link;
   - `<mailto:…>` is a link (any scheme, per CommonMark);
   - a bare `https://…` is a link; a bare `ftp://…` is not;
   - `<div>` at the start of a line is still `unsupported: html`.
4. **Red — render** (`docs-api.test.ts`)
   - three items sharing a `listId` render `1.` `2.` `3.`, with an interleaved
     paragraph between them;
   - a list whose level-0 `startNumber` is 5 renders `5.` `6.` `7.`;
   - nesting levels count independently.
5. **Red — round-trip** — extend the 0021 §2 test: the interleaved-numbering
   document survives `render → parse`, and the `startNumber: 5` document is
   pinned as the documented exception (0023 §3) rather than left to fail.
6. **Green** — implement; `DocsRequest` gains `deleteParagraphBullets` and the
   `docs_v1.Schema$Request` guard in `google-clients.ts` covers it for free.
7. **Refactor** — run detection is one pass producing runs, not a scan repeated
   per block kind; the autolink rule sits with the other inline rules rather
   than as a special case ahead of them.

## Acceptance criteria

- [ ] Numbered sections separated by paragraphs keep their numbers
- [ ] A numbered run survives an intervening heading, quote, code block, or
      bulleted list, and the bulleted list stays bulleted
- [ ] A run that starts at anything but 1 keeps its literal ordinals as text
      rather than being renumbered
- [ ] `<scheme:…>` autolinks and bare `http(s)` URLs become links; a URL on its
      own line no longer reports `unsupported: html`
- [ ] `docs read` prints real ordinals
- [ ] `bun run typecheck` / `lint` / `lint:casts` / `format:check` / `test:unit`
- [ ] `docs/commands.md` covers the not-starting-at-1 behavior and the `1\.`
      escape; the release notes list the `read` output change as breaking

## Verification

- `bun run test:unit` — parse, requests, render, round-trip.
- **Manual, against a real account** — the unit tests cannot see what Docs
  actually renders, which is where 0023's technique was found in the first
  place. Write a document with numbered sections separated by paragraphs and by
  a bulleted list, then confirm with `download --export-as md` (Google's own
  renderer, not ours) that the numbers read 1, 2, 3 and the bullets are bullets.
  Confirm a `<https://…>` line is a live link. Trash the document afterwards.
