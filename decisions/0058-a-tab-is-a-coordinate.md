# 0058: A tab is a coordinate, and its default is never inherited

Date: 2026-08-08
Status: accepted — revises [0046](0046-replace-as-text-keeps-its-reach.md),
extends [0009](0009-docs-commands.md) and [0055](0055-a-name-has-to-be-addressable.md)

## Context

A Google Doc can hold a tree of tabs. Nothing in this repository had ever
mentioned them, and the Docs port was written as though a document has one body,
so every `docs` command silently addressed the first tab. What that costs was
measured on 2026-08-08 against a real document with four tabs — three at the
root and one nested — each seeded with a distinguishable line:

- `read` returned the first tab and said nothing about the other three. Neither
  format carried a signal that they existed.
- `insert --before` answered *No such marker in the document* for a marker that
  was in the document, two tabs away.
- `replace` in its default Markdown mode reported one occurrence changed, with
  three others standing.
- **`replace --as text` changed all three**, including the nested one — content
  no command here can display.

The last one is not an oversight in this repository so much as a trap in the
API, and it is the finding worth keeping: **Docs v1's default for an omitted tab
differs by request type.** An omitted `tabId` on a `Location` or a `Range` means
the first tab; an omitted `tabsCriteria` on `replaceAllText` means *every* tab.
Code that omits both — which is what this repository did — is scoped two
different ways depending on which request it happened to build.

Two more measurements shape what follows. `includeTabsContent=true` does not add
`tabs` alongside `body`; it *replaces* it, and `body` comes back absent. And
`download --export-as md` already carries every tab, each under a heading of its
title, so one path here has been reading whole documents all along — the Drive
export, which never went through the Docs port.

## Decision

### 1. Every tab coordinate is stated

No request this CLI builds omits its tab. A `Location` and a `Range` carry a
`tabId`; `replaceAllText` carries a `tabsCriteria`. The API's defaults are not
used anywhere, not even where one happens to be what we want, because agreeing
with a default is indistinguishable from not having thought about it — and the
defaults disagree with each other. This is decidable from the source, so it is a
check and not a sentence ([0047](0047-rules-are-executed.md) §1).

### 2. A tab is a coordinate, not a second document model

[0029](0029-slides-document.md) separates a stream from a list from a canvas. A
tab does not move a Doc out of the stream column: a tab *is* a stream, and a
multi-tab Doc is a forest of them. So the positional verbs keep their shape and
gain one coordinate, rather than being replaced by the whole-document projection
a form ([0027](0027-forms-document.md)) or a deck
([0029](0029-slides-document.md)) gets.

### 3. Reading is the whole document

A tab is easy to miss — that is the property that decides this. A read that
returns one tab of four, with nothing to say so, is wrong in the way silence is
always wrong here: the caller cannot tell it happened. So a read covers every
tab in document order, and each tab's content is preceded by a marker.

The marker anchors on the tab's **id**, not its title, because a title is
arbitrary text that can contain whatever would otherwise terminate the marker,
and it is emitted for a single-tab document too, so a consumer never has two
shapes to handle. Its spelling belongs to `docs/` and the code.

What is *not* copied is the export's way of doing this. `--export-as md` spells
each tab as a top-level heading, which lands the tab's name at the same level as
the headings inside it; the two become indistinguishable. A marker that is not a
heading has no level to collide with.

### 4. A write with no coordinate is refused where it would have to guess

One tab, and a write needs no coordinate. More than one, and a write without one
is refused, listing the tabs. The alternative — write to the first tab — buys a
shorter command line by making read and write disagree about what "the document"
means, and by putting the guess where its consequence is a modified file rather
than an error. This is [0052](0052-rename.md)'s reasoning about `mv`: where the
target is ambiguous, the answer is a new argument, never a rule for picking.

### 5. A tab title is addressable or it is refused

A coordinate may be given as a tab id or as a title, and a title that does not
resolve to exactly one tab is refused with the ids listed
([0008](0008-drive-commands.md)'s shape).

Tab ids are `t.`-prefixed, so a value spelled that way is read as an id — which
makes a *title* spelled that way unaddressable. This CLI therefore does not hand
a tab such a title, which is [0055](0055-a-name-has-to-be-addressable.md)'s rule
arriving in a second place: this CLI never gives something a name it cannot
afterwards use to find it. Reading a title someone else set is unaffected; the
id is what addressing rests on.

### 6. Tab structure is its own surface

Listing, creating, deleting, renaming and reordering tabs is about the
document's shape rather than its content, so it lives apart from the content
verbs. Deleting a tab takes its descendants with it, so it says what it will
remove before it does, for [0031](0031-recursive-copy.md) §3's reason.

## Consequences

- **[0046](0046-replace-as-text-keeps-its-reach.md) had a dimension it could not
  see.** It weighed `replace --as text`'s reach — headers, footers, footnotes —
  against the Markdown path's, and chose to keep the wider one. That reasoning
  survives *within* a tab and is unchanged there. Across tabs the same reach was
  not a feature but an unbounded edit, and §1 bounds it. The exception 0046
  documents is about style; there was a second, undocumented one about scope,
  and its two halves now agree.
- **The port's unit of work stops being a document and becomes a tab.** Because
  `includeTabsContent` removes `body` rather than adding to it, every function
  in `lib/docs-api.ts` that reads a body is affected at once. It is mechanical
  and it is wide, and it cannot be done a command at a time.
- `insert --before` stops reporting that a marker is absent from a document that
  contains it.
- A `docs` read and a `--export-as md` export now agree on how much of the
  document they cover, having disagreed since tabs shipped.
- **Both defects here were reachable by measurement and by nothing else.** A
  fake client answers whatever its author believed about an omitted field, and a
  single-tab fixture cannot distinguish "first tab" from "every tab" — the two
  defaults are the same document. This is [0012](0012-testing-strategy.md)'s
  point arriving through a new door: the fixture has to contain the distinction
  before a test can hold it.

## Out of scope (deferred)

- **Headers, footers and footnotes** stay where
  [0046](0046-replace-as-text-keeps-its-reach.md) left them —
  [issue #21](https://github.com/ncukondo/gdrive-cli/issues/21). §1 makes every
  request name its tab, which does not make any of them reach a segment they do
  not reach today.
- **A tab's own emoji icon** (`TabProperties.iconEmoji`) will not be done. It is
  decoration with no bearing on addressing or content, and no caller has asked.
