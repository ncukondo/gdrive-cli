# 0034: The type vocabulary tracks what the CLI can act on

Date: 2026-08-03
Status: accepted — revises [0008](0008-drive-commands.md)

## Context

[0008](0008-drive-commands.md) introduced a friendly `type` label derived from
the MIME type, and named its members. It never said what governs membership, so
each later addition has been argued from scratch: [0025](0025-shortcuts.md) §2
added `shortcut` because a shortcut had to be distinguishable from the file it
points at, and nothing generalised from it.

The gap surfaced when task 0029 shipped `forms read`. Running it against a real
account showed `info` reporting a form as `type: file`, a shortcut to one
reporting `target_type: file`, and `ls --type` offering no way to find a form at
all. An agent told that the CLI reads forms cannot locate one, and name is no
substitute: the same run found a form whose Drive name (`Untitled form`) and
Forms API title (`gdrive-cli verification form`) genuinely differ.

The question this raises is not whether to add one member. It is what the label
is *for*, because without an answer the next Workspace type restarts the
argument.

## Decision

### 1. A type exists when a command can act on it

The vocabulary describes what this CLI can do, not what Drive can store. A MIME
type earns a label at the moment a command takes it as a subject, and not
before. `file` is not "unknown to Drive" — it is "nothing here acts on this
specifically", which is a statement about the CLI and stays true as Drive grows.

That is why `folder`, `doc`, `sheet` and `slides` were there from
[0008](0008-drive-commands.md), why `shortcut` arrived with
[0025](0025-shortcuts.md), and why Drawings, Sites, Jamboards and Apps Script
remain `file` — no command names them. It is also why a form earns one now:
`forms read` and `forms responses` exist.

### 2. A label is not a capability

Adding a member says a command can act on that type. It does not say every
command can. `download` exporting a form, `cp` copying one meaningfully, or a
`--type` value the CLI cannot filter on are all separate questions, and this rule
answers none of them.

### 3. Growing the vocabulary is a break, and worth it

A file that reported `type: file` reports something else from the release that
adds its label. [0014](0014-pre-1.0-compatibility.md) permits that before 1.0
with a release note, and §1 makes the trade explicit: the alternative is a label
that stays stable by staying wrong about what the CLI does.

## Out of scope (deferred)

- **Which MIME types are labelled today.** That is a `what`: it lives in
  `MIME_TYPE_MAP`, in the `FileType` union, and in `docs/commands.md`, which are
  the three places a reader should look. Restating the membership here would
  create a fourth copy to keep true, which [0032](0032-decisions-are-append-only.md)
  §3 exists to prevent — and [0008](0008-drive-commands.md) already shows the
  failure, its `Commands` table still offering `--type <folder|doc|sheet|file>`
  while its `Output` section lists all six.
- **A `--type` value spanning several MIME types.** `file` stays the residue, not
  an enumeration.

## Consequences

- The next Workspace type does not need a decision. It needs a command; the label
  follows from §1, and the release note from §3.
- `--type` becomes a reliable way to find the files a given command can take,
  which is the question an agent actually has.
- A consumer switching exhaustively on the type gains a member per capability
  added. [0014](0014-pre-1.0-compatibility.md) §2 already frames that as the cost
  of the label existing.
