# Task 0057: A marker is addressable in a header, footer or footnote

Status: todo
Depends on: 0055
Parallel: no — it rewrites `findMarkerRanges` and everything built on it, which
0055 adds a third caller to.

## Goal

`docs read` shows a document's headers, footers and footnotes, and `insert`,
`replace` and `delete` can address a marker in any of them (issue #21).

## Context

- Relevant decisions:
  [`0064`](../decisions/0064-a-marker-is-addressable-anywhere.md) (the
  position), [`0046`](../decisions/0046-replace-as-text-keeps-its-reach.md)
  (the exception it removes), [`0022`](../decisions/0022-insert-at-marker.md) §2
  (the exactly-once rule, which changes meaning),
  [`0045`](../decisions/0045-inserted-content-is-default-styled.md) (what this
  unblocks and does **not** do).
- `findMarkerRanges` walks `document.body.content` only. `docs read` renders the
  body only. `replace --as text` goes through `replaceAllText`, which already
  covers four segments — which is why 0046 had to write down an exception.
- **Every Docs request that takes a `Location` or a `Range` takes a
  `segmentId`.** An index is meaningless without one: index 42 in the body and
  index 42 in a footer are different characters. This is the change that reaches
  furthest, because every request builder gains a field.
- A `DocumentRaw` carries `headers`, `footers` and `footnotes` as maps keyed by
  segment id, each holding a `content` array shaped like the body's.

## Scope

- `src/lib/docs-api.ts` — the walk, the range type, every request builder
- `src/lib/markdown-doc.ts` — if rendering the extra segments needs it
- `src/commands/docs/read.ts`, `insert.ts`, `replace.ts`, `delete.ts` and tests
- `tests/helpers/` — the fake Docs client gains the segments
- `docs/commands.md`, and `CHANGELOG.md` is **not** touched here (it is written
  at release, and this is a breaking change the release note has to carry)
- `tests/e2e/docs.test.ts`

## Out of scope

- Applying [`0045`](../decisions/0045-inserted-content-is-default-styled.md)'s
  style reset to the `--as text` path. 0064 §4 removes the reason it could not
  be done and explicitly does not do it. **Tracked by issue #21**, which stays
  open for that if anyone asks; disowned at archive time if nobody does.
- Rendering a header's *position* — first-page, even-page, default. `read` shows
  the content and says which segment it came from, not how Docs chooses to show
  it. **This work will not be done**; nothing has asked.

## TDD plan

1. **Red** — the fake Docs client gains a document with a header, a footer and a
   footnote. `findMarkerRanges` finds a marker in each, and every range carries
   the segment it came from.
2. **Red** — **a marker in the body and in a header matches twice**, so
   `insert --before` is `INVALID_ARGS` naming the count. This is the breaking
   change, and it is the case that tells an implementation the segment is part
   of the identity rather than a decoration.
3. **Red** — `insert` into a footer sends `segmentId` on its `Location`, and a
   body insert sends none (or the empty one the API expects — measured, not
   assumed).
4. **Red** — `docs replace` in Markdown mode reaches a footnote, and a Markdown
   table there is refused through the unsupported channel rather than written as
   text, because Docs does not allow a table in a footnote.
5. **Red** — `docs read` renders the extra segments, marked as what they are,
   and a document with none reads exactly as it does today.
6. **Red** — `docs delete` (task 0055) can remove a footer's paragraph.
7. **Green** — implement, one segment kind at a time.

## Acceptance criteria

- [ ] `docs read` shows header, footer and footnote content
- [ ] `insert`, `replace` and `delete` address a marker in any of them
- [ ] A marker in two segments matches twice and is refused
- [ ] A document with no headers or footnotes reads and writes as before
- [ ] `replace --as text` and `replace` in Markdown mode now agree on reach
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/commands.md` drops 0046's exception and states the new match rule

## Verification

- Automated: `bun run test src/lib/docs-api.test.ts src/commands/docs`.
  `bun run test:e2e` — **at least two new cases**: a live document with a header
  and a footnote, read back with both; and an `insert --before` a marker in the
  header, confirming the API accepts the `segmentId` this sends. The
  `segmentId`-on-a-body-request question is one only Docs can answer.
- Manual, against a real account: create a Doc with a first-page-only header and
  an even-page header, and confirm `read` shows both rather than one. The API
  returns several header segments and which is which is not something a test
  fixture can be trusted to have got right.
