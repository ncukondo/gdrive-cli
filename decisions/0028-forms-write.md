# 0028: `forms write` applies a form document by item id

Date: 2026-08-03
Status: accepted

Extends [0027](0027-forms-document.md).

## Context

[0027](0027-forms-document.md) defines the form document and the read side. This
record is the other half: getting an edited document back into Drive.

`forms.batchUpdate` takes a list of requests — `updateFormInfo`,
`updateSettings`, `createItem`, `updateItem`, `moveItem`, `deleteItem` — against
a form identified by id. There is no "replace the form with this" request. So
something has to turn *a document* into *a list of edits*, and the shape of that
translation is the whole decision.

Getting it wrong is expensive in a way the rest of this CLI is not. Deleting a
Docs paragraph loses a paragraph; deleting a form question loses the question
*and* severs its responses, which are keyed by `questionId`
([0027](0027-forms-document.md) §3). Recreating a question that could have been
updated does the same damage while looking like a successful edit.

## Decision

### 1. `id` is the match key; no diffing is attempted

```
gdrive forms write <form> [--file <path>|-] [--prune]
gdrive forms create <title> [--file <path>|-] [--parent <folder>]
```

`write` compares the document's items to the form's *by `id` alone*:

| in the document | in the form | request |
|---|---|---|
| `id` present, matches | yes | `updateItem` |
| no `id` | — | `createItem` at its position |
| — | `id` not in the document | `deleteItem`, and only with `--prune` (§3) |
| order differs | — | `moveItem` |

Nothing compares titles, or guesses that a renamed question is "the same"
question. The document that `forms read` produced already carries every id
([0027](0027-forms-document.md) §3), so an agent that edits a node in place
keeps the id, and one that adds a question simply omits it. That makes the
common edit — change a title, add a question — exactly expressible, and it means
a question's `questionId` survives any edit that was not a deletion.

A heuristic diff would be strictly worse here: it would have to guess, and a
wrong guess silently orphans a column of responses.

An `id` in the document that the form does not have is an error, not a create.
It means the document was written against a different form, and creating the
item would half-apply that mistake.

### 2. `type: unsupported` items produce no request

An item the schema could not model round-trips as `type: unsupported` with its
`raw` payload ([0027](0027-forms-document.md) §4). `write` emits no request for
it: not an update (the raw payload is the API's shape, not the document's, and
re-sending it invites a mismatch), and not a delete.

They still hold their position, so a `moveItem` may name one. That is the point
— an unmodelled video item stays where it was in a form whose questions changed
around it.

### 3. Deleting requires `--prune`

An item present in the form but absent from the document is **not** deleted by
default. `write` fails, naming the items it would have removed, and `--prune`
performs the deletion.

This breaks declarative purity on purpose. The usual argument for implicit
deletion — the document is the desired state, so absence means absence — assumes
the cost of a wrong deletion is a re-apply. Here it is a permanently severed set
of responses, with no trash to recover from; Drive's own `rm` is recoverable
([0008](0008-drive-commands.md)) and this is not. The failure mode being
prevented is also the likely one: an agent that assembles a document
programmatically and drops an item it did not understand.

`--prune` is the same shape of decision as `rm --permanent`: the destructive
reading of an ordinary command is available, spelled out, and never the default.

### 4. `revision_id` makes a concurrent edit fail instead of clobber

When the document carries the `revision_id` that `read` emitted, `write` sends
it as `writeControl.requiredRevisionId`. A form edited in the browser between
the read and the write fails with a clear error rather than overwriting that
edit.

Omitting the field writes unconditionally, which is what a hand-authored
document does. So the safe behavior is what the round trip gives for free, and
the unsafe one takes deleting a line.

### 5. Read-only fields are ignored, not rejected

`question_id`, `responder_uri`, `linked_sheet_id` and the form's own `id` are
output-only. `write` ignores them.

`forms read` → edit → `forms write` has to work without a stripping step, or the
round trip 0027 §1 promises is not a round trip. Rejecting the fields that
`read` itself emitted would make the two commands disagree about their own
document.

### 6. `forms create` creates, then fills, then moves

`forms.create` accepts a title and nothing else — no description, no items, no
parent folder. So `create` is three calls: `forms.create`, then a
`forms.batchUpdate` carrying the document, then a Drive `files.update` to move
the form when `--parent` is given.

This is the shape `docs create` already has, for the same reason and with the
same comment in the code (*the Docs API cannot create a document inside a
folder*). Following it means `forms create --parent` behaves like every other
`create` in this CLI rather than inventing a second answer.

Without `--file`, `create` makes an empty form with that title, which is the
`gdrive docs create <title>` case.

## Out of scope (deferred)

- **Moving a question between sections** beyond what `moveItem` expresses by
  index. Sections are page-break items in the same flat list, so this falls out
  of §1 without a separate rule; if it turns out not to, it needs its own record.
- **Publish settings** (`forms.setPublishSettings`) and response destination
  (linking a spreadsheet). Both are form *lifecycle*, not content.
- **Partial writes** (`--only-items`, patch-style input). The whole point of §1
  is that a whole document is cheap to write when ids do the matching.

## Consequences

- `write` costs one `forms.get` before its `batchUpdate`: it cannot classify an
  item without knowing which ids the form currently has, and §3's error message
  has to name what would be deleted.
- A user who edits a form in the browser between `read` and `write` gets a
  failure, not a merge. §4 makes that a clear error; there is no three-way
  merge and this record does not plan one.
- An agent can now damage a form in one command. `--prune` and `revision_id`
  are the two guards, and both are stated in terms of what they cost when
  absent, so a later change that weakens either has to argue against this
  paragraph.
- `forms create --parent` is two round trips more than it looks. That is the
  API's constraint, recorded here so it is not mistaken for an implementation
  slip.
