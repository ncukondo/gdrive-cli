# Task 0056: An `elements` entry's text is writable

Status: todo
Depends on: —
Parallel: yes (worktree-safe) — beside 0055 and 0057; it owns
`src/commands/slides/` and `src/lib/slide-document.ts`, which neither touches.

## Goal

A `TITLE_AND_TWO_COLUMNS` deck round-trips: `slides read` then `slides write`
can change either column, instead of half a deck's text being unwritable
(issue #28).

## Context

- Relevant decisions:
  [`0063`](../decisions/0063-an-element-is-addressed-by-its-id.md) (the
  position), [`0051`](../decisions/0051-elements-holds-placeholders-too.md) §3
  (which deferred it, and which schema question it said had to be answered
  first), [`0030`](../decisions/0030-slides-write.md) §3 (the refusal being
  narrowed) and §4 (the formatting warning being extended).
- **The schema question was already answered by the document.** Every `elements`
  entry carries the API object id, and `insertText` / `deleteText` address a
  shape by exactly that. Nothing new is invented; 0063 §1 is three lines of
  position and the rest is mechanism.
- `src/commands/slides/plan.ts` already rewrites a changed placeholder as
  delete-then-insert against an `objectId`. An element is the same request with
  a different id.
- The refusal at `plan.ts` (0030 §3) currently covers any edit to `elements`. It
  narrows to a **structural** edit — a new entry, a removed one, a changed
  `kind`, `placeholder` or `id` — and stops covering `text`.

## Scope

- `src/lib/slide-document.ts` — the write-side schema for an element
- `src/commands/slides/plan.ts`, `plan.test.ts`
- `src/commands/slides/write.test.ts`
- `docs/commands.md`
- `tests/e2e/slides.test.ts`

## Out of scope

- Creating or moving an element, or expressing where one sits.
  [`0029`](../decisions/0029-slides-document.md) §1 models no geometry and 0063
  §2 leaves that untouched. **This work will not be done**, and no issue is
  opened: nothing has asked for it.
- `slides create --file` carrying elements. 0063 §4 keeps them skipped there,
  because a new deck has none of the ids that would address them.

## TDD plan

1. **Red** — `plan.test.ts`, against the two-column fixture that already exists
   in that file: changing the `text` of the displaced `BODY` entry plans a
   `deleteText` + `insertText` against **that entry's own id**, not the slide's
   and not the first `BODY`'s. Assert the object ids in the requests.
2. **Red** — changing the text of a **hand-placed** shape does the same. 0063 §2
   is the rule that makes these one case, and a test for only the placeholder
   would let an implementation split them again.
3. **Red** — an unchanged entry plans nothing, so a round trip with no edit is
   still empty (0030 §4: only a changed one is rewritten, because the rewrite
   loses inline formatting).
4. **Red** — the structural refusals stay: adding an entry, removing one,
   changing an `id` or a `kind` is still `INVALID_ARGS`, and the message no
   longer claims the text cannot be written.
5. **Red** — an entry with no `text` (a table, an image) accepts no text edit.
6. **Red** — the plan warns that a rewrite loses the element's formatting.
7. **Green** — implement.

## Acceptance criteria

- [ ] Editing either column of a `TITLE_AND_TWO_COLUMNS` slide writes
- [ ] Editing a hand-placed text box's text writes
- [ ] A structural change to `elements` is still refused, with a message that is
      true
- [ ] An unedited round trip still plans nothing
- [ ] `bun run test` and `bun run typecheck` pass
- [ ] `docs/commands.md` says `elements` text is writable and geometry is not

## Verification

- Automated: `bun run test src/commands/slides`. `bun run test:e2e` — **one new
  case**: create a deck on `TITLE_AND_TWO_COLUMNS`, read it, change the
  `elements` entry's text, write it, read it back. This is exactly the class of
  defect task 0045 exists for — an encoding a fake accepts and the API refuses —
  and the two-column layout is the case that produced the issue.
- Manual, against a real account: open the written deck and confirm the text
  landed in the **second column** rather than replacing the first. A read
  reports text per element; only a person can see which column it is in.
