# Task 0055: `gdrive docs delete` removes a range

Status: todo
Depends on: —
Parallel: no — it owns `src/lib/docs-api.ts` and `src/commands/docs/`, which
0057 also rewrites. 0055 lands first: 0057 changes what a marker *is*, and doing
that under a command that does not exist yet is harder than doing it after.

## Goal

An `insert` that turned out to be wrong can be undone from the CLI, including
one that created tables (issue #41).

## Context

- Relevant decisions: [`0062`](../decisions/0062-a-write-has-an-inverse.md) (the
  position and what is declined), [`0022`](../decisions/0022-insert-at-marker.md)
  §2 (the exactly-once rule this reuses),
  [`0021`](../decisions/0021-markdown-writes.md) §6 (why a table's cells are not
  reachable by marker).
- The report is a real one, from use. Read `gh issue view 41` before the code:
  it says exactly what both workarounds do, and the second — that a table built
  by `insert` cannot be named at all — is the one that decides the shape.
- `deleteContentRange` is the only Docs request that removes content.
- `findMarkerRanges` (`src/lib/docs-api.ts`) already returns body ranges and
  already skips table cells. `resolveInsertIndex` in
  `src/commands/docs/insert.ts` already has the exactly-once refusal; take the
  rule, not necessarily the function.

## Scope

- `src/commands/docs/delete.ts` and its test (new)
- `src/commands/docs/index.ts` — one import, one registration (append-only)
- `src/lib/docs-api.ts` — a `deleteRange` and whatever the paragraph rule needs
- `docs/commands.md`, `README.md` if it lists the command surface
- `tests/e2e/docs.test.ts`

## Out of scope

- Making an empty `--replace` drop the paragraph. 0062 §5 declines it, with a
  reason. **This work will not be done.**
- `docs undo`, or having `insert` return a handle. Issue #41's third suggestion;
  it needs state between invocations, which nothing here has. **Not done, and no
  issue is opened** — `docs delete` covers the case that prompted it.
- Reaching a marker in a header, a footer or a footnote. That is issue #21 and
  task 0057; this command inherits the body-only limit rather than adding one,
  and `docs/` says so.

## TDD plan

1. **Red** — `src/commands/docs/delete.test.ts`, against the fake Docs client:
   `--from`/`--to` sends one `deleteContentRange` from the start of the first
   marker to the end of the second. Assert the request, not the return value.
2. **Red** — a range that covers a whole paragraph takes the paragraph mark, so
   what is left has no blank line where it was. This is the defect the report is
   actually about, and it is the case an implementation gets wrong by being
   off by one.
3. **Red** — a deletion that would reach the document's **last** paragraph mark
   stops one character short, because Docs refuses to remove it. Measured from
   the API's own constraint, not guessed.
4. **Red** — a marker matching twice is `INVALID_ARGS` naming the count; a
   marker matching none is `NOT_FOUND`; `--to` before `--from` is refused
   before any request is sent. Assert that the client was never called.
5. **Red** — `--index n --length m` sends the same request shape.
6. **Red** — `--dry-run` reports the range, its length, and the text at each end,
   and sends nothing.
7. **Green** — implement.
8. **Refactor** — `resolveInsertIndex` and this share the exactly-once rule.
   Share it only if the shared thing reads as one idea.

## Acceptance criteria

- [ ] `gdrive docs delete <file> --from "A" --to "B"` removes A through B
- [ ] A range that spans a table removes the table
- [ ] Removing a whole paragraph leaves no blank line
- [ ] `--dry-run` writes nothing and reports the range
- [ ] Each marker must match exactly once; the errors say which rule was broken
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/commands.md` covers it, says the deletion is not undoable from here,
      and names Google Docs' version history as the backstop

## Verification

- Automated: `bun run test src/commands/docs`. `bun run test:e2e` — **one new
  case, and it is the one that matters**: insert a Markdown document containing
  a pipe table into a live Doc, then delete it by `--from`/`--to` and read back
  an empty document. A fake accepts any range; only Docs knows whether a range
  that spans a table is a legal `deleteContentRange`, and whether the last
  paragraph mark is really refused.
- Manual, against a real account: open the document in the browser after the
  live case and confirm no empty paragraphs are left behind. A read cannot see a
  blank paragraph that renders as one; a person can.
