# 0063: An element is addressed by its own id

Date: 2026-09-02
Status: accepted — revises [0030](0030-slides-write.md) §3, extends [0051](0051-elements-holds-placeholders-too.md) §3

## Context

[0051](0051-elements-holds-placeholders-too.md) §3 defers one question and says
what has to be answered before any code: **how a document addresses a second
placeholder of one kind on one slide**. [0029](0029-slides-document.md) §2
answered it for one placeholder per field — `title`, `subtitle`, `body`, `notes`
— and a slide on Google's own `TITLE_AND_TWO_COLUMNS` layout has two `BODY`
placeholders, so the second lands under `elements` and `slides write` refuses
it. An ordinary two-column deck has half its text unwritable (issue #28).

The answer turns out to be sitting in the document already. Every `elements`
entry carries the API's own object id:

```yaml
  - id: SLIDES_API1087468714_6
    kind: shape
    placeholder: BODY
    text: Body text 3
```

`insertText` and `deleteText` address a shape by exactly that id. Nothing has to
be invented, and no field has to be added — which is why this record is short
and why 0051 §3 was right to hold the write until somebody looked.

## Decision

### 1. An entry's `text` is writable, addressed by the entry's `id`

`slides write` applies a changed `text` on an `elements` entry the same way it
applies a changed `body`: delete the shape's text, insert the new text, both
addressed by `objectId`. The id is what makes it unambiguous, and it is already
in the document because `read` put it there.

### 2. The rule is what the API can carry, not what kind of shape it is

A **placeholder** displaced into `elements` and a **hand-placed** text box are
both shapes with text, and `insertText` does not distinguish them. Writing one
and refusing the other would be a line this CLI drew rather than one the API
draws, and [0051](0051-elements-holds-placeholders-too.md) §1 already rejected
layout membership as a test for the same reason.

So: an entry that reports `text` accepts a change to it. An entry that does not
— a table, an image, a group — has nothing here to change.

`kind`, `placeholder` and `id` stay read-only, and adding or removing an entry
stays refused. What the document still cannot express is *where* an element is,
which is [0029](0029-slides-document.md) §1's position and is untouched: this
writes into an element that exists, and creates none.

### 3. A rewrite loses the element's inline formatting, and says so

[0030](0030-slides-write.md) §4's rule, unchanged and now reaching further.
Delete-and-insert drops the bold inside a paragraph, so only a *changed* entry
is rewritten and the plan warns. A hand-placed box is more likely to be styled
than a placeholder is, so the warning matters more here than where it was
written.

### 4. `create` still refuses them

`slides create --file` builds a deck the document has never seen, so no id in it
names anything. An `elements` entry has no other handle, and this record adds
none — it is reported through the skipped channel, as it is today.

## Consequences

- A `TITLE_AND_TWO_COLUMNS` deck round-trips: `slides read` then `slides write`
  can change either column. That is the case issue #28 names.
- `slides write`'s refusal in [0030](0030-slides-write.md) §3 narrows to what it
  should always have covered: a *structural* edit to `elements` — a new entry, a
  removed one, a changed `kind` or `id`. 0051 §3 said the message was wrong
  about placeholders; it was wrong about `text` in general.
- The deck a caller reads is now, for text, the deck they can write. The
  asymmetry that is left is geometry, and that one is deliberate.
