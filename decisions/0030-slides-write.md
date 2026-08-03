# 0030: `slides write` applies a deck document by object id

Date: 2026-08-03
Status: accepted

Extends [0029](0029-slides-document.md).

## Context

[0029](0029-slides-document.md) defines the deck document and the read side.
This record puts an edited one back.

The machinery is [0028](0028-forms-write.md)'s: `presentations.batchUpdate`
takes a request list, there is no "replace the deck with this", so something has
to turn a document into edits. Everything 0028 decided for forms — id as the
match key, `--prune` for deletion, a reported plan, `revision_id` for
concurrency — applies here for the same reasons, and this record adopts it by
reference rather than re-deriving it.

Two things are new, and both come from Slides rather than from the pattern.

**There is no request that sets a shape's text.** The API offers `insertText`
and `deleteText` over character ranges. Changing a title means deleting what is
there and inserting the replacement, which discards the inline styling of what
was deleted.

**Half of what [0029](0029-slides-document.md) shows cannot be written.**
`elements` — text boxes, images, tables, charts — is read-only, and it is the
part of a real deck a caller is most likely to try to edit.

## Decision

### 1. [0028](0028-forms-write.md) applies unchanged, with slide ids

```
gdrive slides write <file> [--file <path>|-] [--prune] [--dry-run]
gdrive slides create <title> [--file <path>|-] [--parent <folder>]
```

Slides match on `id` (the API's `objectId`): present and known → update, absent
→ `createSlide` at its position, known but missing from the document →
`deleteObject` and only with `--prune`, reordered → `updateSlidesPosition`. An
`id` the deck does not have is an error, not a create.

`--prune` refuses with `PRUNE_REQUIRED` and applies nothing
([0028](0028-forms-write.md) §3); every write reports a plan and `--dry-run`
produces one without writing (§4); `revision_id` becomes
`writeControl.requiredRevisionId` (§5); read-only fields are ignored (§6),
except as §3 below overrides for `elements`.

A new slide is created from its `layout`, which is what makes
[0029](0029-slides-document.md) §2's coordinate-free document sufficient: a
`createSlide` naming a predefined layout, then `insertText` into the
placeholders that layout provides.

### 2. Only changed placeholders are rewritten, and the plan says what that costs

A placeholder whose text is unchanged gets no request at all. A placeholder
whose text changed is rewritten whole — `deleteText` over its range, then
`insertText` — and **the inline formatting inside that placeholder is lost**:
bold, links, colour, per-run styling.

That is the API's floor, not a shortcut. What this record decides is that the
cost is paid narrowly and stated loudly:

- narrowly, because untouched placeholders are never rewritten, so a one-word
  fix to a title cannot strip the formatting from the body;
- loudly, because the plan ([0028](0028-forms-write.md) §4) carries a warning on
  each rewritten placeholder that had more than one text run — i.e. exactly the
  ones with formatting to lose — and `--dry-run` shows them before anything is
  written.

Refusing the write instead, and requiring a `--force`, was the alternative. It
was rejected because a template's title placeholder is routinely styled, so the
refusal would fire on the most ordinary edit there is, and a flag that must be
passed every time stops being read.

### 3. Editing `elements` is an error, not a silent no-op

`elements` is read-only ([0029](0029-slides-document.md) §3). A document whose
`elements` differ from the deck's fails with `INVALID_ARGS`, naming the element
and saying that its text cannot be written from here.

This is the one place this record departs from
[0028](0028-forms-write.md) §6, which ignores read-only fields. Ignoring is
right for `question_id` and `responder_uri`: no one edits them on purpose, and
rejecting them would break the round trip. `elements[].text` is the opposite —
it is the visible text of a slide, it looks exactly like something a caller
would change, and there is no way to honour the change. Ignoring it would return
success for an edit that did not happen, which is the failure mode
[0028](0028-forms-write.md) §3 exists to prevent, arriving through a different
door.

Elements that are unchanged are ignored as before, so `read | write` with no
edits still round-trips.

### 4. `create` reconciles Slides' default first slide

`presentations.create` takes a title and produces a deck that already contains
one slide. `create --file` must not leave it stranded ahead of the document's
own first slide.

So `create` is: `presentations.create`, then one `batchUpdate` that both removes
the default slide and builds the document's, then a Drive `files.update` for
`--parent`. Without `--file`, the default slide is what the user gets — an empty
deck with a title, matching `gdrive docs create <title>`.

This is `docs create`'s and `forms create`'s shape
([0028](0028-forms-write.md) §7) plus one reconciliation the other two do not
need, recorded here so it is not mistaken for a stray delete.

## Out of scope (deferred)

- **Writing `elements`.** `insertText` works on any shape with text, so writing
  a hand-placed text box is mechanically possible; it is excluded because
  [0029](0029-slides-document.md) §3 does not model those shapes well enough to
  write them safely. This is the most likely next extension, and §3's error is
  what will tell us whether anyone wants it.
- **Preserving inline formatting across a text change.** It would need a
  run-level diff and `updateTextStyle` replay. §2 is the honest floor until
  someone needs more.
- **Images, tables, charts, transitions, per-slide backgrounds.** All are the
  geometry line [0029](0029-slides-document.md) §2 draws.
- **Moving a placeholder's content between slides.** Slides match by id; text
  moved between them reads as two independent edits, which is correct but not
  clever.

## Consequences

- `write` costs one `presentations.get` before its `batchUpdate`, for the same
  reason [0028](0028-forms-write.md) does: ids and the deletion list.
- A deck built without templates is readable
  ([0029](0029-slides-document.md) §3) and almost entirely unwritable. §3 turns
  that from a puzzle into an error message.
- Rewriting a placeholder loses its formatting. Recorded in the decision, warned
  in the plan, and documented in `docs/` — three places, because it is the one
  thing about this command that will surprise someone.
- Between this record and [0029](0029-slides-document.md), every Workspace file
  type the CLI names now has a read path and a write path. What is uneven is
  fidelity, not coverage.
