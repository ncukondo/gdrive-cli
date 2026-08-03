# 0036: The default output is the machine one, and text stops aligning

Date: 2026-08-03
Status: accepted — revises [0007](0007-output-and-errors.md)

## Context

[0007](0007-output-and-errors.md) opens by saying what this CLI is for:

> **The primary consumer is an AI agent.** JSON (`-f json`) is a first-class,
> stable interface … Text output is the convenience layer.

Eleven lines later it makes the convenience layer the default. Every defect
found in this project's output has been in that layer, and it runs unless the
caller asks for something else.

The layer is defective because it aligns. Tasks 0034 and 0036 measured six:
a width literal equal to the longest label, so `shortcut` ran into the timestamp;
`padEnd` counting UTF-16 units, so any full-width character drifted every column
to its right; a name meeting the column width exactly, so the id abutted it and
the boundary could not be recovered; 214 assigned code points measured at the
wrong width; `❤️` and `👍🏽` off by one and two; and a newline in a name — which
Drive accepts, confirmed by creating one — splitting a row in half.

Five of the six are the same defect, and it has no fixable form. Alignment needs
to know how wide a string draws, and nothing knows. Unicode Annex #11 says
U+4DC0 is two columns; `Bun.stringWidth` and `string-width@5` both say one.
Terminals disagree with each other and with all three. `eastasianwidth`, the
package the ecosystem reaches for, is stale in exactly the places a hand-written
table was stale. Every answer is a snapshot of a moving target, and a wrong
answer is a table whose columns do not line up — which for a machine reader is
not cosmetic, because the id is what the next command takes.

The alternative is not to solve it better. It is to stop paying for it.

## Decision

### 1. The default output is the machine one

A command that is not told otherwise emits its machine representation. `-f text`
asks for the convenience layer, and `default_format` in the config still moves
the default per user ([0006](0006-configuration.md)). This is 0007's own first
paragraph, applied to the flag it never reached.

The machine representation is the one each command already has: the JSON
envelope for a command that returns records, and the document's own format for a
command whose output *is* a document — Markdown for `docs read`, YAML for a form
or a deck ([0027](0027-forms-document.md) §5, [0029](0029-slides-document.md)).
Those are already exact and already parseable; nothing about them changes.

### 2. Text output never aligns

The convenience layer separates columns by a single tab and pads nothing. No
width is computed, so no width can be wrong, and the whole class of defect above
becomes unreachable rather than fixed. A reader who wants columns pipes it
through something that aligns, with a font and a terminal in front of it — which
is where that knowledge actually lives.

Text remains lossy on purpose: a name containing a tab or a newline is not
representable in a line-oriented format, and text mode may mangle it. That is
what §1 makes the fallback rather than the default, and `-f json` is the exact
channel for anyone who cares.

### 3. This is the last decision that treats alignment as a goal

No renderer computes a display width, and none should be added. If a future
command wants a table a person can scan, the answer is a formatter outside this
CLI, not a width table inside it.

## Out of scope (deferred)

- **Which commands render records and which render documents.** That is a
  `what`, and [0034](0034-form-is-a-file-type.md)'s lesson applies: the call
  sites and `docs/commands.md` hold the membership, and restating it here would
  create a copy to keep true.
- **Removing `-f text`.** It stays. A person at a terminal is a real user of this
  CLI even when they are not the primary one.
- **Column alignment in `docs/` examples.** Those are illustrations
  ([0035](0035-docs-are-downstream.md) §2) and follow whatever the code emits.

## Consequences

- This is a breaking change to every command's default output, and the largest
  this project has made. [0014](0014-pre-1.0-compatibility.md) permits it before
  1.0 with a release note, and the note has to be blunt: a caller that parsed
  text without passing `-f text` gets JSON now.
- Five renderers lose their width constants, and one loses a 123-range Unicode
  table it had just acquired. Pull request #14 built that table, and its review
  is what established that no correct version of it exists; it is closed
  unmerged rather than merged and then deleted.
- The tests that go with them are the ones worth keeping in mind: they asserted
  that columns line up. Their replacement asserts that a row round-trips — split
  it on tabs and get back the fields — which is a property text output can
  actually promise.
- An agent reading `gdrive ls` pays more tokens for JSON than for a table. That
  is the cost being accepted, and it buys an id that is never ambiguous.
