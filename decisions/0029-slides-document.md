# 0029: A deck is one YAML document of placeholders; `slides read`

Date: 2026-08-03
Status: accepted

## Context

Slides is the last Workspace type the CLI cannot read. `download --export-as
pdf` produces a file, and `ls` reports `type: slides`, but nothing reaches the
words on a slide.

Modelling a deck is harder than modelling a document or a form, and the reason
is structural. A Doc is a **stream**, which is why Markdown fits it
([0021](0021-markdown-writes.md)). A form is a **list of typed items**, which is
why YAML fits it ([0027](0027-forms-document.md)). A slide is a **two-dimensional
canvas**: every `pageElement` carries a `transform` and a `size` in EMU, and the
`pageElements` array is z-order, not reading order. There is no inherent
sequence to render.

Two facts make a useful design possible anyway.

**The API's own authoring path has no coordinates in it.** `createSlide` takes a
`slideLayoutReference` — one of eleven predefined layouts — and
`placeholderIdMappings`; `insertText` then fills the placeholders by id. A deck
built that way is fully specified by its layouts and its text.

**No new OAuth scope is needed.** `presentations.get` and
`presentations.batchUpdate` both accept `auth/drive`, as
[0005](0005-auth-and-scopes.md) records for Forms.

## Decision

### 1. A deck is a YAML document, as a form is

`gdrive slides read <file>` emits a YAML document for the whole deck, and
[0030](0030-slides-write.md) accepts it back. The reasoning, the round-trip
contract, and the `yaml` dependency are [0027](0027-forms-document.md)'s; this
record does not re-argue them. What differs is what the document contains.

### 2. Geometry never appears; a slide is a layout and its placeholders

```yaml
title: Q3 review
revision_id: "abc123"
slides:
  - id: g2a1b3c
    layout: TITLE_AND_BODY
    title: The quarter in one slide
    body: |
      - Revenue up 12%
      - Churn flat
    notes: Take questions here

  - id: g5d6e7f
    layout: SECTION_HEADER
    title: What we do next
```

No `transform`, no `size`, no EMU, in either direction. The document describes
what a deck *says*; the template describes what it looks like.

This is a real limit and it is the right one. Modelling geometry would mean
re-implementing Slides — and an agent asked to build a deck does not want to
compute a text box's position, it wants a layout that already knows. Because the
API's creation path is placeholder-shaped (Context), the subset that is easy to
express is also the subset that produces a deck a human would accept.

`notes` is a first-class field rather than another placeholder: speaker notes
live on a separate notes page, in its `BODY` placeholder identified by
`speakerNotesObjectId`, and nothing is gained by making a caller know that.
`layout` is reported by name from the slide's layout (`TITLE_AND_BODY`,
`SECTION_HEADER`, …), falling back to the layout's object id for a deck built on
a custom layout.

### 3. Everything else is `elements`, and `elements` is read-only

A shape a user dragged onto a slide, an image, a table, a chart — anything that
is not a layout placeholder — is listed under `elements` with its id, its kind,
and its text where it has any:

```yaml
  - id: g7h8i9j
    layout: BLANK
    elements:                    # read-only
      - id: g1k2l3m
        kind: shape
        text: A heading someone placed by hand
      - id: g4n5o6p
        kind: image
```

Read shows it; [0030](0030-slides-write.md) never writes it.

This deliberately differs from [0027](0027-forms-document.md) §4, which buries
an unmodelled form item in an opaque `raw` blob. The difference is frequency: an
unmodelled *form* item is rare, while text outside a placeholder is how a large
share of real decks are built. Hiding that in `raw` would make the common deck
read as empty, which is the one outcome worse than reading it partially.

The asymmetry — visible but not writable — is a genuine sharp edge, so it is
named in the document itself rather than only in prose. [0030](0030-slides-write.md)
§3 makes editing one an error rather than a silent no-op.

### 4. `slides read` text is the document; `-f json` is the same structure

As [0027](0027-forms-document.md) §5. Text output is the YAML; `-f json` puts
the structure itself in `data.presentation`, so a caller that only reads never
needs a YAML parser.

A slide the deck skips carries `skipped: true`; it is a property of the slide,
writable, and invisible in an export.

## Out of scope (deferred)

- **`--as markdown`** — a flat text rendering of a deck, for the agent that
  wants to know what a deck says rather than to edit it. Cheap to add on top of
  this projection, and worth adding if reading turns out to be the common case.
- **Writing** — [0030](0030-slides-write.md).
- **Thumbnails** (`pages.getThumbnail`), masters, layouts as editable objects,
  and per-run text styling. The first is a different kind of output; the rest
  are the geometry line this record draws.
- **Tables' contents.** A table is an `elements` entry with a kind and no text
  projection. Modelling rows and cells is its own record.

## Consequences

- A deck built entirely without a template reads as `layout: BLANK` slides full
  of `elements`. That is accurate rather than empty, and it is also the signal
  that [0030](0030-slides-write.md) will be able to change almost nothing in it.
- `lib/slides-api.ts` joins the other client ports, params checked against
  `slides_v1` ([0015](0015-no-type-assertions.md)).
- The document cannot express a deck's visual design at all. Anyone who reads
  this record wanting to fix that should start by asking whether the answer is a
  template in Drive rather than a schema here.
