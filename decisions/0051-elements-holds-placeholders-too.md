# 0051: `elements` holds placeholders too, and says which ones

Date: 2026-08-06
Status: accepted — revises [0029](0029-slides-document.md) §3

## Context

[0029](0029-slides-document.md) §3 defines `elements` as "anything that is not a
layout placeholder". Building task 0031 against the Slides API showed that
definition is not reachable: the document gives a slide one `body`, and Google's
own `TITLE_AND_TWO_COLUMNS` layout gives it two `BODY` placeholders. The second
one has nowhere to go.

A deck built for the task 0031 manual pass — one slide per predefined layout,
plus a hand-placed text box and a table on a blank slide — reads back with that
second placeholder listed among the elements:

```
  - id: s_two
    layout: TITLE_AND_TWO_COLUMNS
    title: A title
    body: Body text 2
    elements:
      - id: SLIDES_API1087468714_6
        kind: shape
        text: Body text 3
```

That entry is indistinguishable from the hand-placed text box on the next slide,
and the two are not the same thing at all. The text box is outside the layout and
the API offers no way to put it back under one; the `BODY` is a placeholder the
API would rewrite as readily as the `body` above it. Under
[0030](0030-slides-write.md) §3 both are refused with `INVALID_ARGS`, so a
two-column deck — an ordinary deck, not an exotic one — has half its text
permanently unwritable, and the error says the text "cannot be written from
here" when in fact it can.

Three things were wrong at once: the definition, the claim it licensed, and the
message a user would eventually read.

## Decision

### 1. `elements` is what the document has no field for

Not "what is not a placeholder". A shape lands there when the document offers it
no home — because its kind is unmodelled, or because the field its kind maps to
is already taken by an earlier placeholder on the same slide. Layout membership
is not the test and never was; the test is whether this document can name it.

0029 §3's reasoning is untouched by this. It chose to list unmodelled content
rather than bury it in an opaque blob, because text outside a placeholder is how
a large share of real decks are built and hiding it would make the common deck
read as empty. That argument covers a displaced placeholder at least as well as
it covers a text box.

### 2. An `elements` entry says whether it is a placeholder

The two kinds of entry have different futures — one is writable by an API this
CLI has not asked yet, the other is not writable at all — so a caller has to be
able to tell them apart without inferring it from an id. The document marks
which entries are placeholders. How it is spelled belongs to `docs/` and the
code, as [0032](0032-decisions-are-append-only.md) §3 requires; what this record
fixes is that the distinction is visible rather than derivable.

### 3. `elements` stays read-only, and the reason is now narrower

[0030](0030-slides-write.md) §3 stands: editing an entry is `INVALID_ARGS`, not
a silent no-op. But its justification — that there is no way to honour the
change — is only true of the non-placeholder entries. For a displaced
placeholder the honest message is that this CLI has not implemented the write,
not that the API cannot do it, and §3's error must say so.

Refusing both is deliberate and temporary. Writing a displaced placeholder needs
the document to address it unambiguously, which is a schema question
[0029](0029-slides-document.md) §2 answered for one placeholder per field and
would have to answer again for two. That work is not folded into 0032, where it
would arrive as an unreviewed schema change inside a write task.

## Consequences

- Task 0032 implements [0030](0030-slides-write.md) §3 as written, with the
  message §3 above corrects. It does not gain scope from this record.
- Anyone reading a two-column deck sees all of its text and can tell which parts
  a write will refuse. That is worse than writing them and better than silently
  dropping them, which is what 0029 §3's definition would have produced.
- The schema question — how a document addresses two placeholders of one kind on
  one slide — is deferred, and a deck whose second column is edited stays
  unwritable until it is answered.

## Out of scope (deferred)

- **Writing a displaced placeholder.** Tracked as
  [issue #28](https://github.com/ncukondo/gdrive-cli/issues/28). It needs the
  schema decision above before it needs any code.
