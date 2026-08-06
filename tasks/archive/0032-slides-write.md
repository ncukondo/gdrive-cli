# Task 0032: `gdrive slides write` / `slides create`

Status: todo (move to `tasks/archive/` when done)
Depends on: 0031 (the projection and the client port) and 0030 (the planner,
`--prune`, `--dry-run`, the plan output and `PRUNE_REQUIRED` all come from
there — do not build a second version of any of them).
Parallel: no — extends the two lib files 0031 creates.

## Goal

An edited deck document goes back into Drive: `slides write` applies it by slide
id, rewrites only the placeholders whose text changed, refuses to touch
`elements`, and `slides create` builds a deck from a document.

## Context

- Decisions: [`0030`](../decisions/0030-slides-write.md), which adopts
  [`0028`](../decisions/0028-forms-write.md) wholesale and adds three things of
  its own — §2 (formatting loss, warned in the plan), §3 (`elements` edits are
  an error), §4 (the default first slide).
- Reuse, do not re-implement: task 0030 built the request planner, the plan
  output, `--dry-run`, `--prune` and `PRUNE_REQUIRED`. If the two planners
  cannot share code, they must at least share their vocabulary and their tests'
  shape.
- The API path for a new slide is `createSlide` with a `slideLayoutReference`
  and `placeholderIdMappings`, then `insertText` per placeholder — never a
  coordinate ([`0029`](../decisions/0029-slides-document.md) §2).
- Changing existing text is `deleteText` over the range then `insertText`; there
  is no set-text request.

## Scope

- `src/lib/slide-document.ts` — the document → request direction.
- `src/lib/slides-api.ts` — `batchUpdate`, `createPresentation`.
- `src/commands/slides/{write,create}.ts` + tests — new.
- `src/commands/slides/index.ts` — register both.

## Out of scope

- Writing `elements`, preserving inline formatting across a change, images,
  tables, charts, transitions — all deferred in 0030.

## TDD plan

1. **The request plan** — pure, no API.
   - **Red (matching, 0030 §1)** — matching `id` → updates; missing `id` →
     `createSlide` at its index with the named layout, followed by `insertText`
     per populated placeholder; a deck slide absent from the document →
     `deleteObject` only with pruning, otherwise `PRUNE_REQUIRED` with no
     partial plan; reordering → `updateSlidesPosition`; an `id` the deck does
     not have → error, not a create; an identical document → an empty plan.
   - **Red (text, 0030 §2)** — a placeholder whose text is unchanged produces
     **no** request; one whose text changed produces `deleteText` + `insertText`
     over the right range; a changed placeholder that had more than one text run
     carries a formatting-loss warning in the plan, and one with a single run
     does not.
   - **Red (elements, 0030 §3)** — a document whose `elements` text differs from
     the deck fails `INVALID_ARGS` naming the element; a document whose
     `elements` are unchanged produces no request and no error, so `read | write`
     with no edits still round-trips; adding or removing an `elements` entry is
     the same error.
   - **Green** — implement the planner.
   - **Refactor** — keep it pure and separately tested, as 0030's is.

2. **`slides write`**
   - **Red** — sends the plan as one `batchUpdate` with
     `writeControl.requiredRevisionId` when the document carries `revision_id`;
     a stale revision surfaces as a clear error; `--file`, `@file` and stdin
     reach the same parser; malformed YAML and schema violations fail
     `INVALID_ARGS` naming the path; `--dry-run` issues no `batchUpdate`
     (assert the call count); every run reports `data.plan`.
   - **Green** — implement.

3. **`slides create`** (0030 §4)
   - **Red** — with a title only, creates a deck and leaves Slides' default
     slide as the deck's only slide; with `--file`, the resulting deck has
     exactly the document's slides and **no** leftover blank first slide;
     with `--parent`, moves the deck afterwards and reports `parent_id`; quiet
     prints the new presentation id.
   - **Green** — implement, following `forms/create.ts`.

4. **Docs**
   - `docs/commands.md`: `write` and `create`, with the formatting-loss rule
     stated where a caller will read it — 0030 §2 asks for it in the decision,
     the plan and the docs, and this is the third.
   - `README.md` highlights: Slides goes from read to read/write.

## Acceptance criteria

- [ ] `gdrive slides read D > d.yaml && gdrive slides write D --file d.yaml`
      makes no change and reports an empty plan, on a deck that has `elements`
- [ ] Changing one slide's title rewrites that placeholder only; the body's
      formatting is intact afterwards
- [ ] A changed placeholder that had bold text warns in the plan before the
      write, and `--dry-run` shows the warning without writing
- [ ] Editing an `elements` entry fails `INVALID_ARGS` naming it
- [ ] Adding a slide without an `id` creates it from its layout with its text
- [ ] Removing a slide fails `PRUNE_REQUIRED` without `--prune`, leaves the deck
      unchanged, and succeeds with it
- [ ] `gdrive slides create "Q4" --file d.yaml --parent Decks` produces a deck
      with no leftover blank first slide
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check` pass
- [ ] `docs/commands.md` and `README.md` updated

## Verification

- `bun run test src/lib/slide-document.test.ts` — both directions and a
  round-trip property over the fixture decks
- `bun run test src/commands/slides` — the planner and both commands
- Manual, against a real account: take a template deck, bold one word in a body
  placeholder, then change only the title and write. The body must still be
  bold — that is 0030 §2's whole claim, and a fake cannot show it. Then change
  the body and confirm the warning fired and the bold is gone, which is the
  other half of the same claim.
