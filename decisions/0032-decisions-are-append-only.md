# 0032: The code is the truth; a decision records why and is never rewritten

Date: 2026-08-03
Status: accepted — revises [0001](0001-development-process.md)

## Context

[0001](0001-development-process.md) keeps no living SPEC because one document
that everybody edits drifts away from the code. It then left a door open: when
work reveals a needed change, record a new decision "or supersede an old one".
[`README.md`](README.md) widened the gap by offering `Status: superseded by NNNN`
as a per-file field, which can only be written by editing the file it supersedes.

The door has been used. 0016 carries a Revision section appended after review,
0021 §5 was corrected in place to match what shipped, and 0011's Status line was
amended to point forward at 0018. Three planned tasks would add more: task 0029
would list `yaml` in 0002 and annotate 0005 about the Forms scope, and task 0033
would edit 0007's Decision section and 0008's command table.

Every one of those edits is small, and every one is right at the moment it is
made. The cost is not in any single edit. It is that a record which *may* be
edited *must* be edited to stay true, and each place needing an edit is a place
the edit can be missed. A stale sentence in a decision reads as current, which
makes it worse than no sentence. That is the drift 0001 rejected a living SPEC to
avoid, arriving by a slower road.

The way out is to stop asking any document to be current except the one that
cannot avoid it.

## Decision

### 1. The code is the source of truth

What the CLI does is what the code does. `docs/` describes it for a user, and a
decision explains why it is that way, but neither one settles a question about
behavior. When a document and the code disagree, the code is right and the
document is out of date.

This is what makes the rest of this record affordable. Nothing else has to be
kept true, so nothing else has to be edited.

### 2. A decision explains what the code cannot show

Code shows what was built. It does not show what was considered and rejected,
what constraint forced a shape, or what a later reader would otherwise undo out
of ignorance. That is what `decisions/` holds, one file per topic, in the order
the decisions were made.

A decision is dated and therefore historical. It is true of the moment it was
written and makes no claim about today. When the code has moved past it, the code
wins and the file stays as it is. A new record is written only when the *reason*
for moving is itself worth keeping.

### 3. A committed decision file is not edited again

Not its `Decision`, not its `Context`, not its `Status` line, and not a table or
a list inside it. This holds even when the edit is a pure addition, such as a new
dependency in 0002's stack list or a new flag in 0008's command table. An
inventory that has to be maintained is a living SPEC in a smaller box.

Typos and broken links are the only exceptions, and only while they change
nothing a reader would act on.

What a change costs instead is a new file, stating its own position in full so
that it reads without the one it replaces. Its `Status` line names the
relationship, in the wording already in use:

```
Status: accepted — revises [0007](0007-output-and-errors.md) §4
Status: accepted — extends [0021](0021-markdown-writes.md)
```

`revises` narrows or contradicts; `extends` adds without contradicting. The new
file carries the pointer because the new file is the one being written. The old
file gains nothing, including a back-pointer.

### 4. The record is read from the newest number down

A reader who wants the current position on a topic starts at the highest number
and stops at the first record that answers, then checks the code. Nothing in the
directory needs to be true in isolation, which is what makes §3 affordable.

[`README.md`](README.md)'s index is the map for that walk. It gains one row per
decision, and the row's `(revises NNNN)` / `(extends NNNN)` note is where a
relationship is visible without opening either file.

### 5. A task expires when its code exists

A task file decides what code to write while there is no code to read. That is
its whole purpose, and it ends the moment the code lands: from then on the task
describes an intention that the code has already settled, and every day it stays
in `tasks/` it is a second answer to a question the code answers better.

So a merged task is archived at once, in the commit that follows its merge
([0033](0033-implementation-lands-through-review.md) §4), not at the end of a
batch and not at the next release. Archiving is not bookkeeping deferred until
convenient; it is what stops the file from being read as current.

A task may be corrected once, at the moment it is archived, to note where the
implementation went differently and why. After that it is history like any
decision. If the divergence has a reason worth keeping, the reason belongs in a
new decision, never back in an old one.

### 6. What is not a record

`docs/`, `README.md` at the repo root, `tasks/README.md`, `CLAUDE.md` and
[`README.md`](README.md) here are navigation and description. They are expected
to match the code and are edited freely to keep matching it; that is their job.
The line is whether the file is dated. A decision and a task are; these are not.

## Out of scope (deferred)

- **Rewriting the three files already edited in place.** 0011, 0016 and 0021 stay
  as they are. Correcting them would be the first violation of the rule being
  adopted, and their text is not wrong, only edited.
- **A `superseded` status on old files.** §4 removes the need: a reader walking
  down from the top never depends on an old file announcing its own obsolescence.
- **Reconciling old decisions with the code that shipped.** Where the two differ,
  §1 already says which one to believe. Auditing for the differences is work with
  no reader.

## Consequences

- Task files 0029 and 0033 lose the steps that would have edited 0002, 0005, 0007
  and 0008. Nothing is lost with them: 0027 already records the `yaml` dependency
  and that Forms needs no new scope, and 0031 already records both the `cp -r`
  behavior and the envelope's new `data`.
- Forward-looking sentences written before this rule stay where they are. 0027
  says 0002 "is updated to list it"; that sentence is now overridden by number
  order rather than by an edit, which is the rule working rather than failing.
- The index in [`README.md`](README.md) becomes load-bearing. It is the only
  place a relationship between two decisions is visible at a glance, so a new
  decision is not finished until its row is there.
- `tasks/` stays short enough to read in one pass, which is the property that
  makes `tasks/README.md`'s plan table worth trusting.
- Reading the whole current position on a broad topic can mean opening several
  files, and then the code. That is the price of never having to trust that an
  edit was made everywhere it was due.
